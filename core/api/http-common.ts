import { request as pwRequest, APIRequestContext } from '@playwright/test';
import { activeEnvironment, clientConfig } from '../config/client-config';
import { storageStatePath } from '../auth/ui-auth';
import * as fs from 'fs';

/** Shared plumbing for the GraphQL and REST adapters. */

export const REDACT_HEADERS = /^(authorization|cookie|set-cookie|x-api-key|proxy-authorization)$/i;

export function redactHeaders(h: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, REDACT_HEADERS.test(k) ? `${v.slice(0, 4)}…` : v]));
}

export function isTimeoutError(e: unknown): boolean {
  const m = (e as Error)?.message ?? '';
  return /timeout|timed out|ETIMEDOUT|aborted/i.test(m);
}

/** A request context with the right session for the configured API auth scheme. */
export async function newApiContext(opts: { role?: string; baseURL?: string } = {}): Promise<APIRequestContext> {
  const cfg = clientConfig();
  const a = cfg.auth.api;
  let storageState: string | undefined;
  if (a.kind === 'session-cookie') {
    const p = storageStatePath(opts.role ?? a.role);
    if (fs.existsSync(p)) storageState = p;
  }
  return pwRequest.newContext({
    baseURL: opts.baseURL ?? activeEnvironment().restBaseUrl ?? activeEnvironment().baseUrl,
    storageState,
    ignoreHTTPSErrors: true,
  });
}

/** Reads a dotted path ("data.items", "meta.total") from an object. */
export function getPath(obj: unknown, p: string | undefined): unknown {
  if (!p) return obj;
  return p.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export interface Exchange {
  at: string;
  method: string;
  url: string;
  status?: number;
  ms: number;
  requestHeaders: Record<string, string>;
  requestBody?: unknown;
  responseBody?: string;
  error?: string;
}

/** The last few request/response pairs, redacted, attached to a failing test for evidence. */
const exchanges: Exchange[] = [];
export function logExchange(e: Exchange): void {
  exchanges.push(e);
  if (exchanges.length > 20) exchanges.shift();
}
export function recentExchanges(): Exchange[] {
  return [...exchanges];
}
export function clearExchanges(): void {
  exchanges.length = 0;
}
