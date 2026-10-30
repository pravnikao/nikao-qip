import * as fs from 'fs';
import * as path from 'path';
import { chromium } from '@playwright/test';
import { activeEnvironment } from '../config/client-config';
import { checkHealth } from '../run/health';
import { GraphQLClient, IntrospectedType } from '../api/graphql-client';
import { RestClient } from '../api/rest-client';
import { diffOpenApi } from '../api/openapi';
import { storageStatePath } from '../auth/ui-auth';
import { drainOutsideTests } from '../perf/perf';

/**
 * The Sentinel: environment and change watch, run before a test run and on a schedule.
 *
 *   RED    the environment is down or our credentials fail: do not run the suite
 *   AMBER  something changed since the last snapshot (schema, API spec, screen hooks)
 *          or calls are much slower: re-capture the changed screens before trusting results
 *   GREEN  nothing changed
 *
 * It is read-only and never edits tests. It tells the Architect what to re-capture.
 */

export interface SentinelChecks {
  latency?: ({ name: string; kind: 'graphql'; document: string; variables?: Record<string, unknown>; budgetMs?: number } | { name: string; kind: 'rest'; path: string; budgetMs?: number })[];
  keyScreens?: { name: string; route: string; readySelector?: string; role?: string }[];
}

export interface SentinelReport {
  environment: string;
  at: string;
  verdict: 'GREEN' | 'AMBER' | 'RED';
  findings: { level: 'RED' | 'AMBER' | 'INFO'; area: string; message: string }[];
  latency: { name: string; ms: number; budgetMs?: number; ok: boolean }[];
}

function snapDir(env: string): string {
  return path.resolve(process.cwd(), 'history', 'sentinel', env);
}

function readSnap<T>(env: string, name: string): T | undefined {
  const f = path.join(snapDir(env), name);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as T) : undefined;
}

function writeSnap(env: string, name: string, v: unknown): void {
  fs.mkdirSync(snapDir(env), { recursive: true });
  fs.writeFileSync(path.join(snapDir(env), name), JSON.stringify(v, null, 2));
}

export function diffSchemas(before: IntrospectedType[], after: IntrospectedType[]): { added: string[]; removed: string[]; changed: string[] } {
  const flat = (ts: IntrospectedType[]) => {
    const m = new Map<string, string>();
    for (const t of ts) {
      m.set(`type ${t.name}`, t.kind);
      for (const [f, sig] of Object.entries(t.fields)) m.set(`${t.name}.${f}`, sig);
      if (t.enumValues) m.set(`enum ${t.name}`, t.enumValues.slice().sort().join('|'));
    }
    return m;
  };
  const a = flat(before);
  const b = flat(after);
  return {
    added: [...b.keys()].filter((k) => !a.has(k)).sort(),
    removed: [...a.keys()].filter((k) => !b.has(k)).sort(),
    changed: [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k)).map((k) => `${k}: ${a.get(k)} → ${b.get(k)}`).sort(),
  };
}

export function diffHooks(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const a = new Set(before);
  const b = new Set(after);
  return { added: [...b].filter((x) => !a.has(x)).sort(), removed: [...a].filter((x) => !b.has(x)).sort() };
}

const stem = (s: string) => s.replace(/[-_][0-9a-f]{6,}$|[-_]\d+$/i, '');

export async function runSentinel(checks: SentinelChecks, opts: { updateBaseline?: boolean } = {}): Promise<SentinelReport> {
  const env = activeEnvironment();
  const report: SentinelReport = { environment: env.name, at: new Date().toISOString(), verdict: 'GREEN', findings: [], latency: [] };
  const add = (level: 'RED' | 'AMBER' | 'INFO', area: string, message: string) => report.findings.push({ level, area, message });

  // 1. Health and auth
  try {
    const h = await checkHealth();
    if (h) add('INFO', 'health', `${h.url} answered ${h.status} in ${h.ms} ms`);
  } catch (e) {
    add('RED', 'health', (e as Error).message);
    report.verdict = 'RED';
    return report;
  }

  // 2. Latency against budgets and the previous run
  const prevLatency = readSnap<Record<string, number>>(env.name, 'latency.json') ?? {};
  const latencyNow: Record<string, number> = {};
  for (const c of checks.latency ?? []) {
    const start = Date.now();
    let ok = true;
    try {
      if (c.kind === 'graphql') {
        const g = await GraphQLClient.create();
        await g.data(c.document, c.variables ?? {});
        await g.dispose();
      } else {
        const r = await RestClient.create();
        await r.get(c.path);
        await r.dispose();
      }
    } catch (e) {
      ok = false;
      add(/GATEWAY-TIMEOUT|ENV-UNAVAILABLE/.test((e as Error).message) ? 'RED' : 'AMBER', 'latency', `${c.name}: ${(e as Error).message.split('\n')[0]}`);
    }
    const ms = Date.now() - start;
    latencyNow[c.name] = ms;
    report.latency.push({ name: c.name, ms, budgetMs: c.budgetMs, ok });
    if (c.budgetMs && ms > c.budgetMs) add('AMBER', 'latency', `${c.name} took ${ms} ms (budget ${c.budgetMs} ms)`);
    const prev = prevLatency[c.name];
    if (prev && ms > prev * 3 && ms > 2_000) add('AMBER', 'latency', `${c.name} is ${(ms / prev).toFixed(1)}× slower than the last snapshot (${prev} → ${ms} ms)`);
  }
  drainOutsideTests();

  // 3. GraphQL schema
  if (env.graphqlUrl) {
    try {
      const g = await GraphQLClient.create();
      const schema = await g.introspect();
      await g.dispose();
      const prev = readSnap<IntrospectedType[]>(env.name, 'graphql-schema.json');
      if (prev) {
        const d = diffSchemas(prev, schema);
        if (d.removed.length || d.changed.length) add('AMBER', 'graphql', `Schema changed: ${d.removed.length} removed, ${d.changed.length} changed, ${d.added.length} added. Removed: ${d.removed.slice(0, 8).join(', ')}${d.changed.length ? ` · Changed: ${d.changed.slice(0, 5).join(', ')}` : ''}`);
        else if (d.added.length) add('INFO', 'graphql', `${d.added.length} schema additions: ${d.added.slice(0, 8).join(', ')}`);
      } else add('INFO', 'graphql', 'No schema snapshot yet; run with --update-baseline');
      if (opts.updateBaseline) writeSnap(env.name, 'graphql-schema.json', schema);
    } catch (e) {
      add('AMBER', 'graphql', `Introspection failed: ${(e as Error).message.split('\n')[0]} (introspection may be disabled on this environment)`);
    }
  }

  // 4. OpenAPI document
  if (env.openApi) {
    try {
      const doc = /^https?:/.test(env.openApi) ? await (await fetch(env.openApi)).json() : JSON.parse(fs.readFileSync(env.openApi, 'utf8'));
      const prev = readSnap<Record<string, unknown>>(env.name, 'openapi.json');
      if (prev) {
        const d = diffOpenApi(prev, doc as Record<string, unknown>);
        if (d.removed.length || d.changed.length) add('AMBER', 'openapi', `API spec changed: ${d.removed.length} removed, ${d.changed.length} changed. ${[...d.removed, ...d.changed].slice(0, 8).join(' · ')}`);
        else if (d.added.length) add('INFO', 'openapi', `${d.added.length} additions: ${d.added.slice(0, 8).join(', ')}`);
      } else add('INFO', 'openapi', 'No OpenAPI snapshot yet; run with --update-baseline');
      if (opts.updateBaseline) writeSnap(env.name, 'openapi.json', doc);
    } catch (e) {
      add('AMBER', 'openapi', `Could not read the OpenAPI document: ${(e as Error).message}`);
    }
  }

  // 5. Screen hooks (data-qa) on key screens
  if (checks.keyScreens?.length) {
    const browser = await chromium.launch();
    try {
      const prevHooks = readSnap<Record<string, string[]>>(env.name, 'screen-hooks.json') ?? {};
      const nowHooks: Record<string, string[]> = {};
      for (const s of checks.keyScreens) {
        const state = s.role ? storageStatePath(s.role) : undefined;
        const ctx = await browser.newContext({ baseURL: env.baseUrl, storageState: state && fs.existsSync(state) ? state : undefined });
        const page = await ctx.newPage();
        try {
          await page.goto(s.route);
          if (s.readySelector) await page.locator(s.readySelector).first().waitFor({ timeout: 20_000 });
          else await page.waitForLoadState('networkidle');
          const ids = await page.$$eval('[data-qa]', (els) => els.map((e) => e.getAttribute('data-qa') ?? ''));
          nowHooks[s.name] = [...new Set(ids.map(stem))].sort();
          const prev = prevHooks[s.name];
          if (prev) {
            const d = diffHooks(prev, nowHooks[s.name]);
            if (d.removed.length) add('AMBER', 'screen', `${s.name}: ${d.removed.length} data-qa hook(s) gone (${d.removed.slice(0, 6).join(', ')})${d.added.length ? `; ${d.added.length} new (${d.added.slice(0, 6).join(', ')})` : ''}. Re-capture this screen.`);
            else if (d.added.length) add('INFO', 'screen', `${s.name}: ${d.added.length} new hook(s): ${d.added.slice(0, 6).join(', ')}`);
          }
        } catch (e) {
          add('AMBER', 'screen', `${s.name} (${s.route}) did not render: ${(e as Error).message.split('\n')[0]}`);
        } finally {
          await ctx.close();
        }
      }
      if (opts.updateBaseline) writeSnap(env.name, 'screen-hooks.json', { ...prevHooks, ...nowHooks });
    } finally {
      await browser.close();
    }
  }

  if (opts.updateBaseline) writeSnap(env.name, 'latency.json', latencyNow);
  report.verdict = report.findings.some((f) => f.level === 'RED') ? 'RED' : report.findings.some((f) => f.level === 'AMBER') ? 'AMBER' : 'GREEN';
  return report;
}

export function sentinelMarkdown(r: SentinelReport): string {
  const lines = [`# Sentinel: ${r.verdict} on ${r.environment}`, '', `Checked ${r.at}.`, ''];
  if (r.findings.length) {
    lines.push('| Level | Area | Finding |', '| --- | --- | --- |');
    for (const f of r.findings) lines.push(`| ${f.level} | ${f.area} | ${f.message.replace(/\|/g, '\\|')} |`);
    lines.push('');
  }
  if (r.latency.length) {
    lines.push('| Call | ms | Budget | OK |', '| --- | --- | --- | --- |');
    for (const l of r.latency) lines.push(`| ${l.name} | ${l.ms} | ${l.budgetMs ?? ''} | ${l.ok ? 'yes' : 'no'} |`);
  }
  return lines.join('\n') + '\n';
}
