import type { Page, Response } from '@playwright/test';

/**
 * Capture what a screen asks the API for. Tests assert on the request the screen
 * sent (variables, filters, page size) as well as what it rendered: that is how
 * "the screen sends order: []" or "first:10 renders 11 rows" defects get proven.
 */

export interface CapturedGraphQL<T = unknown> {
  operationName: string;
  variables: Record<string, unknown>;
  status: number;
  data: T | null;
  errors: unknown[];
  ms: number;
}

function gqlOperation(res: Response): { operationName?: string; variables?: Record<string, unknown> } {
  const post = res.request().postData();
  if (!post) return {};
  try {
    const body = JSON.parse(post);
    const b = Array.isArray(body) ? body[0] : body;
    const fromDoc = typeof b.query === 'string' ? b.query.match(/\b(?:query|mutation)\s+(\w+)/)?.[1] : undefined;
    return { operationName: b.operationName ?? fromDoc, variables: b.variables ?? {} };
  } catch {
    return {};
  }
}

/** Runs `action` and returns the first GraphQL response for `operationName` it triggers. */
export async function captureGraphQL<T = unknown>(page: Page, operationName: string, action: () => Promise<unknown>, timeoutMs = 20_000): Promise<CapturedGraphQL<T>> {
  const start = Date.now();
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && gqlOperation(r).operationName === operationName, { timeout: timeoutMs }),
    action(),
  ]);
  const op = gqlOperation(res);
  let json: { data?: T; errors?: unknown[] } = {};
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { operationName, variables: op.variables ?? {}, status: res.status(), data: json.data ?? null, errors: json.errors ?? [], ms: Date.now() - start };
}

export interface CapturedRest<T = unknown> {
  method: string;
  url: string;
  query: Record<string, string>;
  status: number;
  body: T | null;
  ms: number;
}

/** Runs `action` and returns the first REST response whose path matches. */
export async function captureRest<T = unknown>(page: Page, method: string, path: RegExp, action: () => Promise<unknown>, timeoutMs = 20_000): Promise<CapturedRest<T>> {
  const start = Date.now();
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === method.toUpperCase() && path.test(new URL(r.url()).pathname), { timeout: timeoutMs }),
    action(),
  ]);
  const u = new URL(res.url());
  let body: T | null = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  return { method, url: res.url(), query: Object.fromEntries(u.searchParams.entries()), status: res.status(), body, ms: Date.now() - start };
}

/**
 * Records every call the page makes while `action` runs: used to prove
 * "closing the dialog refetches the grid twice" style defects.
 */
export async function recordCalls(page: Page, action: () => Promise<unknown>, settleMs = 1_500): Promise<{ method: string; path: string; operationName?: string }[]> {
  const calls: { method: string; path: string; operationName?: string }[] = [];
  const onResponse = (r: Response) => {
    const type = r.request().resourceType();
    if (type !== 'fetch' && type !== 'xhr') return;
    calls.push({ method: r.request().method(), path: new URL(r.url()).pathname, operationName: gqlOperation(r).operationName });
  };
  page.on('response', onResponse);
  try {
    await action();
    await page.waitForTimeout(settleMs);
  } finally {
    page.off('response', onResponse);
  }
  return calls;
}
