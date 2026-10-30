import type { APIRequestContext, APIResponse } from '@playwright/test';
import type { ZodType } from 'zod';
import { randomUUID } from 'crypto';
import { activeEnvironment, clientConfig } from '../config/client-config';
import { apiAuthHeaders, invalidateApiToken } from '../auth/api-auth';
import { applyTenant } from '../tenancy/tenant';
import { recordPerf } from '../perf/perf';
import { getPath, isTimeoutError, logExchange, newApiContext, redactHeaders } from './http-common';

/** RFC 9457 problem details. */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  [k: string]: unknown;
}

export interface RestResponse<T> {
  method: string;
  url: string;
  status: number;
  headers: Record<string, string>;
  data: T;
  text: string;
  ms: number;
  problem?: ProblemDetails;
}

export class RestError extends Error {
  constructor(
    public readonly response: RestResponse<unknown>,
    expected: number[],
  ) {
    const p = response.problem;
    super(
      `${response.method} ${response.url} returned ${response.status}, expected ${expected.join('/')}` +
        (p ? `: ${p.title ?? ''}${p.detail ? ` — ${p.detail}` : ''}` : response.text ? `: ${response.text.slice(0, 300)}` : ''),
    );
    this.name = 'RestError';
  }
}

export class ContractError extends Error {
  constructor(where: string, issues: string[]) {
    super(`CONTRACT — ${where} response does not match its schema:\n` + issues.map((i) => `  - ${i}`).join('\n'));
    this.name = 'ContractError';
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

export interface RestCallOptions<T> {
  query?: Record<string, string | number | boolean | undefined | null | (string | number)[]>;
  body?: unknown;
  /** Send as multipart (file uploads). Values: string or { name, mimeType, buffer }. */
  multipart?: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>;
  headers?: Record<string, string>;
  /** Status(es) that count as success. Default: any 2xx. */
  expectStatus?: number | number[];
  /** zod schema the body must satisfy (contract check). */
  schema?: ZodType<T>;
  timeoutMs?: number;
  tenant?: string;
  /** Skip auth (for 401/403 tests). */
  anonymous?: boolean;
  /** Retries for transient failures. GET/HEAD retry by default; POST only with an idempotency key. */
  retries?: number;
  /** Sends Idempotency-Key, which makes POST/PATCH safe to retry. true = generate one. */
  idempotencyKey?: string | true;
  /** Short name for timings and logs, e.g. "listPositions". Defaults to METHOD /path/template. */
  name?: string;
}

const TRANSIENT_STATUS = new Set([429, 502, 503, 504]);

export type Pagination =
  | { kind: 'offset'; limitParam?: string; offsetParam?: string; pageSize: number; itemsPath?: string; totalPath?: string }
  | { kind: 'page'; pageParam?: string; sizeParam?: string; pageSize: number; firstPage?: 0 | 1; itemsPath?: string; totalPagesPath?: string }
  | { kind: 'cursor'; cursorParam?: string; nextCursorPath: string; pageSize?: number; sizeParam?: string; itemsPath?: string }
  | { kind: 'link-header'; pageSize?: number; sizeParam?: string; itemsPath?: string };

/**
 * REST adapter: auth for every configured scheme, tenancy, timeouts labelled
 * GATEWAY-TIMEOUT, safe retries with backoff and Retry-After, problem+json errors,
 * zod contract checks, four pagination styles, timings and a redacted request log.
 */
export class RestClient {
  private constructor(
    private readonly ctx: APIRequestContext,
    private readonly baseUrl: string,
    private readonly ownsContext: boolean,
    private readonly defaultHeaders: Record<string, string>,
  ) {}

  static async create(opts: { baseUrl?: string; request?: APIRequestContext; role?: string; headers?: Record<string, string> } = {}): Promise<RestClient> {
    const baseUrl = (opts.baseUrl ?? activeEnvironment().restBaseUrl ?? activeEnvironment().baseUrl).replace(/\/$/, '');
    const ctx = opts.request ?? (await newApiContext({ role: opts.role, baseURL: baseUrl }));
    return new RestClient(ctx, baseUrl, !opts.request, { accept: 'application/json', ...(opts.headers ?? {}) });
  }

  async dispose(): Promise<void> {
    if (this.ownsContext) await this.ctx.dispose();
  }

  get<T = unknown>(path: string, opts: RestCallOptions<T> = {}) {
    return this.request<T>('GET', path, opts);
  }
  post<T = unknown>(path: string, body?: unknown, opts: RestCallOptions<T> = {}) {
    return this.request<T>('POST', path, { ...opts, body });
  }
  put<T = unknown>(path: string, body?: unknown, opts: RestCallOptions<T> = {}) {
    return this.request<T>('PUT', path, { ...opts, body });
  }
  patch<T = unknown>(path: string, body?: unknown, opts: RestCallOptions<T> = {}) {
    return this.request<T>('PATCH', path, { ...opts, body });
  }
  delete<T = unknown>(path: string, opts: RestCallOptions<T> = {}) {
    return this.request<T>('DELETE', path, opts);
  }

  /** Fills {id}-style placeholders and encodes them: path('/positions/{id}', { id }). */
  static path(template: string, params: Record<string, string | number>): string {
    return template.replace(/\{(\w+)\}/g, (_, k) => {
      if (params[k] === undefined) throw new Error(`Missing path parameter ${k} for ${template}`);
      return encodeURIComponent(String(params[k]));
    });
  }

  async request<T = unknown>(method: HttpMethod, path: string, opts: RestCallOptions<T> = {}): Promise<RestResponse<T>> {
    const cfg = clientConfig();
    const timeoutMs = opts.timeoutMs ?? cfg.timeouts.apiMs;
    const expected = opts.expectStatus === undefined ? undefined : Array.isArray(opts.expectStatus) ? opts.expectStatus : [opts.expectStatus];
    const idem = opts.idempotencyKey === true ? randomUUID() : opts.idempotencyKey;
    const retryable = method === 'GET' || method === 'HEAD' || !!idem;
    const maxRetries = opts.retries ?? (retryable ? 2 : 0);
    const name = opts.name ?? `${method} ${path.replace(/\/[0-9a-f-]{8,}|\/\d+/gi, '/{id}').split('?')[0]}`;

    let attempt = 0;
    let refreshedAuth = false;
    for (;;) {
      const req = applyTenant(
        {
          headers: { ...this.defaultHeaders, ...(opts.anonymous ? {} : await apiAuthHeaders()), ...(idem ? { 'idempotency-key': idem } : {}), ...(opts.headers ?? {}) },
          query: stringifyQuery(opts.query),
        },
        opts.tenant,
      );
      const url = this.url(path, req.query);
      const start = Date.now();
      let res: APIResponse;
      try {
        res = await this.ctx.fetch(url, {
          method,
          headers: req.headers,
          data: opts.multipart ? undefined : opts.body,
          multipart: opts.multipart as never,
          timeout: timeoutMs,
          failOnStatusCode: false,
        });
      } catch (e) {
        const ms = Date.now() - start;
        recordPerf({ kind: 'rest', name, ms, ok: false });
        logExchange({ at: new Date().toISOString(), method, url, ms, requestHeaders: redactHeaders(req.headers), requestBody: opts.body, error: (e as Error).message });
        if (attempt < maxRetries && !isTimeoutError(e)) {
          attempt++;
          await sleep(backoff(attempt));
          continue;
        }
        if (isTimeoutError(e)) throw new Error(`GATEWAY-TIMEOUT — ${name} after ${Math.round(timeoutMs / 1000)} s (${url})`);
        throw e;
      }

      const ms = Date.now() - start;
      const text = await res.text();
      const headers = res.headers();
      const ct = headers['content-type'] ?? '';
      let data: unknown = text;
      if (/json/i.test(ct) && text) {
        try {
          data = JSON.parse(text);
        } catch {
          /* leave as text */
        }
      }
      const response: RestResponse<T> = {
        method,
        url,
        status: res.status(),
        headers,
        data: data as T,
        text,
        ms,
        problem: /application\/problem\+json/i.test(ct) && data && typeof data === 'object' ? (data as ProblemDetails) : undefined,
      };
      const ok = expected ? expected.includes(response.status) : response.status >= 200 && response.status < 300;
      recordPerf({ kind: 'rest', name, ms, status: response.status, ok });
      logExchange({ at: new Date().toISOString(), method, url, status: response.status, ms, requestHeaders: redactHeaders(req.headers), requestBody: opts.body, responseBody: text.slice(0, 4000) });

      if (response.status === 401 && !opts.anonymous && !refreshedAuth && !(expected ?? []).includes(401)) {
        invalidateApiToken();
        refreshedAuth = true;
        continue;
      }
      if (TRANSIENT_STATUS.has(response.status) && attempt < maxRetries && !(expected ?? []).includes(response.status)) {
        attempt++;
        await sleep(retryAfterMs(headers['retry-after']) ?? backoff(attempt));
        continue;
      }
      if (!ok) {
        if (response.status >= 502 && response.status <= 504) {
          throw new Error(`${response.status} ${res.statusText() || 'Gateway error'} from ${name} (${url})`);
        }
        throw new RestError(response, expected ?? [200, 201, 202, 204]);
      }
      if (opts.schema) {
        const parsed = opts.schema.safeParse(response.data);
        if (!parsed.success) throw new ContractError(name, parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
        response.data = parsed.data;
      }
      return response;
    }
  }

  /**
   * Walks every page and returns all items. maxPages guards against a paging bug looping forever,
   * and a repeated page (same first item twice) throws: both are real defects worth reporting.
   */
  async collectAll<I = unknown>(path: string, p: Pagination, opts: RestCallOptions<unknown> & { maxPages?: number } = {}): Promise<{ items: I[]; pages: number; total?: number }> {
    const items: I[] = [];
    const maxPages = opts.maxPages ?? 200;
    let pages = 0;
    let total: number | undefined;
    let seenFirst = new Set<string>();
    const pageItems = (body: unknown, itemsPath?: string) => {
      const v = getPath(body, itemsPath);
      if (!Array.isArray(v)) throw new Error(`Pagination: "${itemsPath ?? '(root)'}" is not an array in ${path}`);
      return v as I[];
    };
    const guardRepeat = (batch: I[]) => {
      if (!batch.length) return;
      const k = JSON.stringify(batch[0]);
      if (seenFirst.has(k)) throw new Error(`Pagination: page ${pages} repeats an earlier page in ${path}`);
      seenFirst.add(k);
    };

    if (p.kind === 'offset') {
      for (let offset = 0; pages < maxPages; offset += p.pageSize) {
        const r = await this.get(path, { ...opts, query: { ...opts.query, [p.limitParam ?? 'limit']: p.pageSize, [p.offsetParam ?? 'offset']: offset } } as RestCallOptions<unknown>);
        const batch = pageItems(r.data, p.itemsPath);
        pages++;
        total = p.totalPath ? Number(getPath(r.data, p.totalPath)) : total;
        guardRepeat(batch);
        items.push(...batch);
        if (batch.length < p.pageSize || (total !== undefined && items.length >= total)) break;
      }
    } else if (p.kind === 'page') {
      let page = p.firstPage ?? 1;
      for (; pages < maxPages; page++) {
        const r = await this.get(path, { ...opts, query: { ...opts.query, [p.pageParam ?? 'page']: page, [p.sizeParam ?? 'size']: p.pageSize } } as RestCallOptions<unknown>);
        const batch = pageItems(r.data, p.itemsPath);
        pages++;
        const totalPages = p.totalPagesPath ? Number(getPath(r.data, p.totalPagesPath)) : undefined;
        guardRepeat(batch);
        items.push(...batch);
        if (batch.length < p.pageSize || (totalPages !== undefined && pages >= totalPages)) break;
      }
    } else if (p.kind === 'cursor') {
      let cursor: string | undefined;
      do {
        const q = { ...opts.query, ...(cursor ? { [p.cursorParam ?? 'cursor']: cursor } : {}), ...(p.pageSize ? { [p.sizeParam ?? 'limit']: p.pageSize } : {}) };
        const r = await this.get(path, { ...opts, query: q } as RestCallOptions<unknown>);
        const batch = pageItems(r.data, p.itemsPath);
        pages++;
        guardRepeat(batch);
        items.push(...batch);
        const next = getPath(r.data, p.nextCursorPath);
        cursor = next ? String(next) : undefined;
      } while (cursor && pages < maxPages);
    } else {
      let next: string | undefined = path;
      let first = true;
      while (next && pages < maxPages) {
        const query = first && p.pageSize ? { ...opts.query, [p.sizeParam ?? 'per_page']: p.pageSize } : first ? opts.query : undefined;
        const r: RestResponse<unknown> = await this.get(next, { ...opts, query } as RestCallOptions<unknown>);
        first = false;
        const batch = pageItems(r.data, p.itemsPath);
        pages++;
        guardRepeat(batch);
        items.push(...batch);
        next = parseLinkNext(r.headers['link']);
      }
    }
    if (pages >= maxPages) throw new Error(`Pagination: stopped after ${maxPages} pages in ${path} (paging may not terminate)`);
    seenFirst = new Set();
    return { items, pages, total };
  }

  private url(path: string, query?: Record<string, string>): string {
    const full = /^https?:\/\//.test(path) ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    if (!query || !Object.keys(query).length) return full;
    const u = new URL(full);
    for (const [k, v] of Object.entries(query)) u.searchParams.append(k, v);
    return u.toString();
  }
}

function stringifyQuery(q: RestCallOptions<unknown>['query']): Record<string, string> | undefined {
  if (!q) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null) continue;
    out[k] = Array.isArray(v) ? v.join(',') : String(v);
  }
  return out;
}

export function parseLinkNext(link: string | undefined): string | undefined {
  if (!link) return undefined;
  for (const part of link.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (m) return m[1];
  }
  return undefined;
}

export function retryAfterMs(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const secs = Number(v);
  if (!Number.isNaN(secs)) return Math.min(secs * 1000, 30_000);
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.min(Math.max(at - Date.now(), 0), 30_000);
}

function backoff(attempt: number): number {
  return Math.min(250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100), 5_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
