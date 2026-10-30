/**
 * Event-sourced / CQRS platforms write first and update read models later.
 * After a write, poll the read side until the change appears, or fail with a
 * READ-MODEL-LAG error that the classifier reports as infrastructure.
 *
 * It FAILS rather than skips: lag beyond the budget is a real finding for dev.
 */
export async function eventually<T>(
  what: string,
  fn: () => Promise<T | undefined | null | false>,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  let interval = opts.intervalMs ?? 500;
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const v = await fn();
      if (v !== undefined && v !== null && v !== false) return v as T;
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, interval));
    interval = Math.min(interval * 1.5, 3_000);
  }
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  const tail = lastError ? ` (last error: ${(lastError as Error).message})` : '';
  throw new Error(`READ-MODEL-LAG — ${what} not visible in the read model after ${secs} s${tail}`);
}
