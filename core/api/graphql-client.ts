import type { APIRequestContext } from '@playwright/test';
import { activeEnvironment, clientConfig } from '../config/client-config';
import { apiAuthHeaders, invalidateApiToken } from '../auth/api-auth';
import { applyTenant } from '../tenancy/tenant';
import { recordPerf } from '../perf/perf';
import { isTimeoutError, logExchange, newApiContext, redactHeaders } from './http-common';

export interface GraphQLErrorItem {
  message: string;
  path?: (string | number)[];
  extensions?: Record<string, unknown>;
}

export interface GraphQLResult<T> {
  status: number;
  data: T | null;
  errors: GraphQLErrorItem[];
  ms: number;
  operationName: string;
}

export class GraphQLRequestError extends Error {
  constructor(public readonly result: GraphQLResult<unknown>) {
    super(
      `GraphQL ${result.operationName} returned ${result.errors.length} error(s): ` +
        result.errors.map((e) => `${e.message}${e.extensions?.code ? ` [${e.extensions.code}]` : ''}${e.path ? ` at ${e.path.join('.')}` : ''}`).join('; '),
    );
    this.name = 'GraphQLRequestError';
  }
}

export function operationNameOf(document: string): string {
  return document.match(/\b(?:query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1] ?? 'anonymous';
}

/** True when a gateway answers 200 but the subgraph says unauthenticated (a common federation pattern). */
export function isUnauthorised(r: GraphQLResult<unknown>): boolean {
  return (
    r.status === 401 ||
    r.errors.some((e) => {
      const ext = e.extensions ?? {};
      return ext.code === 'UNAUTHENTICATED' || ext.statusCode === 401 || (ext as { response?: { status?: number } }).response?.status === 401;
    })
  );
}

export interface GraphQLCallOptions {
  operationName?: string;
  timeoutMs?: number;
  tenant?: string;
  /** Skip auth headers (for 401 tests). */
  anonymous?: boolean;
}

/**
 * GraphQL adapter. Labels timeouts GATEWAY-TIMEOUT (classified as infrastructure),
 * retries once with a fresh token after a 401, records timings, and keeps a
 * redacted request log for evidence.
 */
export class GraphQLClient {
  private constructor(
    private readonly ctx: APIRequestContext,
    private readonly url: string,
    private readonly ownsContext: boolean,
  ) {}

  static async create(opts: { url?: string; request?: APIRequestContext; role?: string } = {}): Promise<GraphQLClient> {
    const url = opts.url ?? activeEnvironment().graphqlUrl;
    if (!url) throw new Error('No graphqlUrl configured for this environment');
    const ctx = opts.request ?? (await newApiContext({ role: opts.role, baseURL: url }));
    return new GraphQLClient(ctx, url, !opts.request);
  }

  async dispose(): Promise<void> {
    if (this.ownsContext) await this.ctx.dispose();
  }

  async execute<T = unknown>(document: string, variables: Record<string, unknown> = {}, opts: GraphQLCallOptions = {}): Promise<GraphQLResult<T>> {
    const operationName = opts.operationName ?? operationNameOf(document);
    const timeoutMs = opts.timeoutMs ?? clientConfig().timeouts.apiMs;
    const attempt = async (): Promise<GraphQLResult<T>> => {
      const req = applyTenant({ headers: { 'content-type': 'application/json', ...(opts.anonymous ? {} : await apiAuthHeaders()) }, variables }, opts.tenant);
      const body = { query: document, variables: req.variables, operationName: operationName === 'anonymous' ? undefined : operationName };
      const start = Date.now();
      try {
        const res = await this.ctx.post(this.url, { data: body, headers: req.headers, timeout: timeoutMs });
        const ms = Date.now() - start;
        const text = await res.text();
        let json: { data?: T; errors?: GraphQLErrorItem[] } = {};
        try {
          json = JSON.parse(text);
        } catch {
          json = { errors: [{ message: `Non-JSON response (HTTP ${res.status()} ${res.statusText()}): ${text.slice(0, 200)}` }] };
        }
        const result: GraphQLResult<T> = { status: res.status(), data: json.data ?? null, errors: json.errors ?? [], ms, operationName };
        recordPerf({ kind: 'graphql', name: operationName, ms, status: res.status(), ok: res.ok() && !result.errors.length });
        logExchange({ at: new Date().toISOString(), method: 'POST', url: `${this.url}#${operationName}`, status: res.status(), ms, requestHeaders: redactHeaders(req.headers), requestBody: { operationName, variables: req.variables }, responseBody: text.slice(0, 4000) });
        if (res.status() >= 502 && res.status() <= 504) throw new Error(`${res.status()} ${res.statusText()} from ${this.url} (${operationName})`);
        return result;
      } catch (e) {
        const ms = Date.now() - start;
        if (isTimeoutError(e)) {
          recordPerf({ kind: 'graphql', name: operationName, ms, ok: false });
          throw new Error(`GATEWAY-TIMEOUT — ${operationName} after ${Math.round(timeoutMs / 1000)} s (${this.url})`);
        }
        throw e;
      }
    };
    let result = await attempt();
    if (!opts.anonymous && isUnauthorised(result)) {
      invalidateApiToken();
      result = await attempt();
    }
    return result;
  }

  /** Returns data, or throws GraphQLRequestError when the response carries errors. */
  async data<T = unknown>(document: string, variables: Record<string, unknown> = {}, opts: GraphQLCallOptions = {}): Promise<T> {
    const r = await this.execute<T>(document, variables, opts);
    if (r.errors.length || r.data === null) throw new GraphQLRequestError(r);
    return r.data;
  }

  /** Full introspection (types, fields, args), for contract checks and the Sentinel's schema diff. */
  async introspect(): Promise<IntrospectedType[]> {
    const q = `query QipIntrospection { __schema { types { name kind fields { name args { name type { ...T } } type { ...T } } inputFields { name type { ...T } } enumValues { name } } } }
      fragment T on __Type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }`;
    const d = await this.data<{ __schema: { types: RawType[] } }>(q);
    return d.__schema.types.filter((t) => !t.name.startsWith('__')).map(simplifyType);
  }
}

interface RawTypeRef {
  kind: string;
  name: string | null;
  ofType?: RawTypeRef | null;
}
interface RawType {
  name: string;
  kind: string;
  fields?: { name: string; args?: { name: string; type: RawTypeRef }[]; type: RawTypeRef }[] | null;
  inputFields?: { name: string; type: RawTypeRef }[] | null;
  enumValues?: { name: string }[] | null;
}
export interface IntrospectedType {
  name: string;
  kind: string;
  fields: Record<string, string>;
  enumValues?: string[];
}

export function typeRefString(t: RawTypeRef | null | undefined): string {
  if (!t) return '?';
  if (t.kind === 'NON_NULL') return `${typeRefString(t.ofType)}!`;
  if (t.kind === 'LIST') return `[${typeRefString(t.ofType)}]`;
  return t.name ?? '?';
}

function simplifyType(t: RawType): IntrospectedType {
  const fields: Record<string, string> = {};
  for (const f of t.fields ?? []) {
    const args = f.args?.length ? `(${f.args.map((a) => `${a.name}: ${typeRefString(a.type)}`).join(', ')})` : '';
    fields[f.name] = `${typeRefString(f.type)}${args}`;
  }
  for (const f of t.inputFields ?? []) fields[f.name] = typeRefString(f.type);
  return { name: t.name, kind: t.kind, fields, enumValues: t.enumValues?.map((e) => e.name) };
}
