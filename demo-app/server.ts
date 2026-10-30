/**
 * Demo platform for showing Nikao QIP end to end, offline.
 *
 * A small holdings app with: a login page (identity-provider style form), two tenants
 * and a tenant switcher, a REST API with an OpenAPI contract and problem+json errors,
 * a GraphQL endpoint (gateway style: auth errors come back as HTTP 200 + errors),
 * and three screens with data-qa hooks.
 *
 * DEMO_DEFECTS=on plants the defects a migration might introduce. off = "before migration".
 */
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { makeDocuments, makePositions, Comment } from './data';
import { openApiDoc } from './openapi';

const PORT = Number(process.env.DEMO_PORT ?? 4310);
const API_KEY = 'demo-api-key';
const USERS: Record<string, string> = { admin: 'demo-pass', viewer: 'demo-pass' };
const defects = () => (process.env.DEMO_DEFECTS ?? 'off') === 'on';

const positions = makePositions();
const documents = makeDocuments();
const comments: Comment[] = [];
let commentId = 1;

/* ---------------------------------------------------------------- helpers */

function cookies(req: http.IncomingMessage): Record<string, string> {
  return Object.fromEntries((req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

function send(res: http.ServerResponse, status: number, body: unknown, type = 'application/json', extra: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': type, ...extra });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function problem(res: http.ServerResponse, status: number, title: string, detail?: string): void {
  send(res, status, { type: 'about:blank', title, status, detail }, 'application/problem+json');
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function user(req: http.IncomingMessage): string | undefined {
  const c = cookies(req);
  if (c.qip_demo_session && USERS[c.qip_demo_session]) return c.qip_demo_session;
  if (req.headers['x-api-key'] === API_KEY) return 'api-client';
  return undefined;
}

function tenantOf(req: http.IncomingMessage): string {
  return String(req.headers['x-tenant'] ?? cookies(req).qip_demo_tenant ?? 'alpha');
}

/* ---------------------------------------------------------------- REST */

function publicPosition(p: (typeof positions)[number]) {
  const { tenant: _t, ...rest } = p;
  // Planted defect: marketValue serialised as a string after "migration" (contract break).
  return defects() ? { ...rest, marketValue: rest.marketValue.toFixed(2) } : rest;
}

function listPositions(req: http.IncomingMessage, url: URL, res: http.ServerResponse): void {
  const page = Number(url.searchParams.get('page') ?? 1);
  const size = Number(url.searchParams.get('size') ?? 20);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(size) || size < 1 || size > 100) {
    return problem(res, 400, 'Invalid paging', 'page must be >= 1 and size between 1 and 100');
  }
  const q = (url.searchParams.get('q') ?? '').toLowerCase();
  const sort = url.searchParams.get('sort') ?? 'issuer';
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  let rows = positions.filter((p) => p.tenant === tenantOf(req));
  if (q) rows = rows.filter((p) => p.issuer.toLowerCase().includes(q) || p.isin.toLowerCase().includes(q));
  if (from) rows = rows.filter((p) => p.tradeDate >= from);
  if (to) rows = rows.filter((p) => p.tradeDate <= to);
  rows = [...rows].sort((a, b) => {
    // Long-standing defect (present before and after migration): quantity sorts as text.
    if (sort === 'quantity') return String(a.quantity).localeCompare(String(b.quantity)) || a.id - b.id;
    if (sort === 'tradeDate') return a.tradeDate.localeCompare(b.tradeDate) || a.id - b.id;
    return a.issuer.localeCompare(b.issuer) || a.id - b.id;
  });
  const items = rows.slice((page - 1) * size, page * size).map(publicPosition);
  send(res, 200, { items, page, size, total: rows.length });
}

/* ---------------------------------------------------------------- GraphQL */

const SCHEMA_TYPES = [
  { name: 'Query', kind: 'OBJECT', fields: [{ name: 'documents', args: [{ name: 'search', type: { kind: 'NON_NULL', name: null, ofType: { kind: 'SCALAR', name: 'String' } } }, { name: 'first', type: { kind: 'SCALAR', name: 'Int' } }], type: { kind: 'NON_NULL', name: null, ofType: { kind: 'OBJECT', name: 'DocumentConnection' } } }] },
  { name: 'DocumentConnection', kind: 'OBJECT', fields: [{ name: 'totalCount', args: [], type: { kind: 'SCALAR', name: 'Int' } }, { name: 'nodes', args: [], type: { kind: 'LIST', name: null, ofType: { kind: 'OBJECT', name: 'DocumentPackage' } } }] },
  {
    name: 'DocumentPackage',
    kind: 'OBJECT',
    fields: ['id', 'fileName', 'formCode', 'issuerName', 'status', 'createdAt'].map((f) => ({ name: f, args: [], type: { kind: 'SCALAR', name: 'String' } })),
  },
];

async function graphql(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let body: { query?: string; variables?: Record<string, unknown>; operationName?: string };
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { errors: [{ message: 'Body must be JSON' }] });
  }
  // Gateway style: unauthenticated calls get HTTP 200 with an UNAUTHENTICATED error.
  if (!user(req)) return send(res, 200, { data: null, errors: [{ message: 'Not authenticated', extensions: { code: 'UNAUTHENTICATED', statusCode: 401 } }] });
  const query = body.query ?? '';
  if (query.includes('__schema')) {
    return send(res, 200, { data: { __schema: { types: SCHEMA_TYPES.map((t) => ({ ...t, inputFields: null, enumValues: null })) } } });
  }
  if (/\bdocuments\s*\(/.test(query)) {
    const search = String(body.variables?.search ?? '').toLowerCase();
    const first = Number(body.variables?.first ?? 20);
    const tenant = tenantOf(req);
    const all = documents.filter((d) => d.tenant === tenant && (!search || d.fileName.toLowerCase().includes(search) || d.formCode.toLowerCase().includes(search)));
    const nodes = all.slice(0, first).map(({ tenant: _t, ...d }) => ({
      ...d,
      // Planted data defect: issuer lost on failed packages after "migration".
      issuerName: defects() && d.status === 'Failed' ? null : d.issuerName,
    }));
    return send(res, 200, { data: { documents: { totalCount: all.length, nodes } } });
  }
  send(res, 200, { errors: [{ message: `Cannot query: ${body.operationName ?? 'unknown operation'}`, extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] });
}

/* ---------------------------------------------------------------- pages */

function layout(req: http.IncomingMessage, title: string, body: string, script: string): string {
  const tenant = tenantOf(req);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} · Demo Holdings</title>
<style>body{font-family:system-ui,sans-serif;margin:0;background:#f6f7f9;color:#1d2433}header{display:flex;gap:16px;align-items:center;padding:10px 20px;background:#1f3a5f;color:#fff}header a{color:#fff;text-decoration:none}main{padding:20px}table{border-collapse:collapse;background:#fff;width:100%}th,td{border:1px solid #d5dbe3;padding:6px 8px;text-align:left;font-size:14px}.bar{display:flex;gap:8px;margin:12px 0;align-items:center}button,select,input,textarea{font:inherit;padding:4px 8px}</style></head>
<body><header data-qa="app-header"><strong>Demo Holdings</strong><nav><a href="/positions">Positions</a> · <a href="/documents">Documents</a> · <a href="/comments">Comments</a></nav>
<label style="margin-left:auto">Acting for <select data-qa="tenant-switcher" id="tenant">${['alpha', 'beta'].map((t) => `<option value="${t}" ${t === tenant ? 'selected' : ''}>${t === 'alpha' ? 'Alpha Capital' : 'Beta Partners'}</option>`).join('')}</select></label>
<span data-qa="user-name">${user(req)}</span></header>
<main>${body}</main>
<script>document.getElementById('tenant').addEventListener('change',e=>{document.cookie='qip_demo_tenant='+e.target.value+';path=/';location.reload();});</script>
<script>window.DEMO_DEFECTS=${defects()};</script><script src="/static/${script}"></script></body></html>`;
}

function positionsPage(req: http.IncomingMessage): string {
  const exportId = defects() ? 'positions-export-btn' : 'positions-export-button';
  return layout(
    req,
    'Positions',
    `<h1>Positions</h1>
<div class="bar"><input data-qa="positions-search-input" placeholder="Issuer or ISIN">
<label>From <input type="date" data-qa="positions-from"></label><label>To <input type="date" data-qa="positions-to"></label>
<select data-qa="positions-sort"><option value="issuer">Issuer</option><option value="quantity">Quantity</option><option value="tradeDate">Trade date</option></select>
<button data-qa="positions-search-button">Search</button><button data-qa="${exportId}">Export CSV</button></div>
<table data-qa="positions-table"><thead><tr><th>ISIN</th><th>Issuer</th><th>Quantity</th><th>Market value</th><th>Trade date</th><th>Status</th></tr></thead><tbody></tbody></table>
<div data-qa="positions-empty" hidden>No positions match your search.</div>
<div class="bar"><button data-qa="positions-page-prev">Previous</button><span data-qa="positions-page-summary"></span><button data-qa="positions-page-next">Next</button>
<label>Rows per page <select data-qa="positions-page-size"><option>10</option><option selected>20</option><option>50</option></select></label></div>`,
    'positions.js',
  );
}

function documentsPage(req: http.IncomingMessage): string {
  return layout(
    req,
    'Documents',
    `<h1>Documents</h1><div class="bar"><input data-qa="documents-search-input" value="CA"><button data-qa="documents-search-button">Search</button><span data-qa="documents-total"></span></div>
<table data-qa="documents-table"><thead><tr><th>File name</th><th>Form code</th><th>Issuer</th><th>Status</th><th>Created</th></tr></thead><tbody></tbody></table>
<div data-qa="documents-empty" hidden>No documents found.</div>`,
    'documents.js',
  );
}

function commentsPage(req: http.IncomingMessage): string {
  return layout(
    req,
    'Comments',
    `<h1>Comments</h1><div class="bar"><input data-qa="comment-position-id" placeholder="Position id"><input data-qa="comment-input" placeholder="Comment"><button data-qa="comment-add">Add</button><span data-qa="comment-status"></span></div>
<ul data-qa="comments-list"></ul><div data-qa="comments-empty" hidden>No comments yet.</div>`,
    'comments.js',
  );
}

function loginPage(next: string, error = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Sign in</title></head><body style="font-family:system-ui;padding:40px">
<h1>Sign in to Demo Holdings</h1>${error ? `<p data-qa="login-error" style="color:#b00">${error}</p>` : ''}
<form method="post" action="/auth/realms/demo/login?next=${encodeURIComponent(next)}"><p><label>Username <input id="username" name="username"></label></p>
<p><label>Password <input id="password" name="password" type="password"></label></p><button id="kc-login" type="submit">Sign in</button></form></body></html>`;
}

/* ---------------------------------------------------------------- router */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const p = url.pathname;
  try {
    if (p.startsWith('/static/')) {
      const file = path.resolve(process.cwd(), 'demo-app', 'public', path.basename(p));
      if (!fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain');
      return send(res, 200, fs.readFileSync(file, 'utf8'), 'application/javascript');
    }
    if (p === '/auth/realms/demo/login') {
      if (req.method === 'POST') {
        const form = new URLSearchParams(await readBody(req));
        const u = form.get('username') ?? '';
        if (USERS[u] && USERS[u] === form.get('password')) {
          // A fresh login lands on the tenant "beta": tests must switch to the tenant they act for.
          return send(res, 302, '', 'text/plain', { location: url.searchParams.get('next') || '/positions', 'set-cookie': [`qip_demo_session=${u}; Path=/; HttpOnly`, 'qip_demo_tenant=beta; Path=/'] as never });
        }
        return send(res, 200, loginPage(url.searchParams.get('next') ?? '/', 'Invalid username or password'), 'text/html');
      }
      return send(res, 200, loginPage(url.searchParams.get('next') ?? '/'), 'text/html');
    }
    if (p === '/api/v1/openapi.json') return send(res, 200, openApiDoc);
    if (p.startsWith('/api/') || p === '/graphql') {
      if (p === '/graphql' && req.method === 'POST') return graphql(req, res);
      if (!user(req)) return problem(res, 401, 'Unauthorized', 'Send x-api-key or sign in');
      if (p === '/api/v1/health') return send(res, 200, { status: 'ok' });
      if (p === '/api/v1/positions' && req.method === 'GET') return listPositions(req, url, res);
      const m = p.match(/^\/api\/v1\/positions\/(\d+)$/);
      if (m && req.method === 'GET') {
        const pos = positions.find((x) => x.id === Number(m[1]) && x.tenant === tenantOf(req));
        return pos ? send(res, 200, publicPosition(pos)) : problem(res, 404, 'Not found', `No position ${m[1]} for this tenant`);
      }
      if (p === '/api/v1/comments' && req.method === 'GET') {
        const pid = url.searchParams.get('positionId');
        const items = comments
          .filter((c) => c.tenant === tenantOf(req) && Date.now() >= c.visibleAt && (!pid || c.positionId === Number(pid)))
          .map(({ tenant: _t, visibleAt: _v, ...c }) => c);
        return send(res, 200, { items });
      }
      if (p === '/api/v1/comments' && req.method === 'POST') {
        let b: { positionId?: number; text?: string } = {};
        try {
          b = JSON.parse(await readBody(req));
        } catch {
          return problem(res, 400, 'Invalid JSON');
        }
        if (!Number.isInteger(b.positionId) || !b.text?.trim()) return problem(res, 400, 'Invalid comment', 'positionId (integer) and text are required');
        if (!positions.some((x) => x.id === b.positionId && x.tenant === tenantOf(req))) return problem(res, 404, 'Not found', `No position ${b.positionId} for this tenant`);
        // Event-sourced write: the read model catches up later. After "migration" it lags 4 s.
        const c: Comment = { id: commentId++, tenant: tenantOf(req), positionId: b.positionId!, text: b.text!, author: user(req)!, createdAt: new Date().toISOString(), visibleAt: Date.now() + (defects() ? 4_000 : 300) };
        comments.push(c);
        const { tenant: _t, visibleAt: _v, ...pub } = c;
        return send(res, 201, pub);
      }
      return problem(res, 404, 'Not found', p);
    }
    // Screens need a signed-in session.
    if (!user(req) || user(req) === 'api-client') {
      return send(res, 302, '', 'text/plain', { location: `/auth/realms/demo/login?next=${encodeURIComponent(p)}` });
    }
    if (p === '/') return send(res, 302, '', 'text/plain', { location: '/positions' });
    if (p === '/positions') return send(res, 200, positionsPage(req), 'text/html');
    if (p === '/documents') return send(res, 200, documentsPage(req), 'text/html');
    if (p === '/comments') return send(res, 200, commentsPage(req), 'text/html');
    send(res, 404, '<h1>Not found</h1>', 'text/html');
  } catch (e) {
    problem(res, 500, 'Server error', (e as Error).message);
  }
});

server.listen(PORT, () => console.log(`Demo Holdings on http://localhost:${PORT} (DEMO_DEFECTS=${defects() ? 'on' : 'off'})`));
