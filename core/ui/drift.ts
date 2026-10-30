import type { Page, TestInfo } from '@playwright/test';
import type { DriftSuggestion } from '../report/types';

/**
 * Locator drift: suggest, don't heal.
 *
 * Page objects ask for elements by data-qa id. When a test fails and an id it asked
 * for is no longer on the page, we list the closest ids that ARE there. The
 * suggestion goes into the report for a person or a Builder to confirm.
 * Nothing is rewritten automatically: a silently healed locator can hide a real change.
 */

const tracked = new WeakMap<TestInfo, { page: Page; ids: Set<string> }>();

export function trackQaId(info: TestInfo | undefined, page: Page, id: string): void {
  if (!info) return;
  const t = tracked.get(info) ?? { page, ids: new Set<string>() };
  t.page = page;
  t.ids.add(id);
  tracked.set(info, t);
}

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** Closest candidates for each wanted id, best first. Ids with a dynamic suffix (row-12) compare on their stem. */
export function suggest(wanted: string[], present: string[], maxDistanceRatio = 0.5): DriftSuggestion[] {
  const stem = (s: string) => s.replace(/[-_][0-9a-f]{6,}$|[-_]\d+$/i, '');
  const presentStems = [...new Set(present.map(stem))];
  const out: DriftSuggestion[] = [];
  for (const w of wanted) {
    const ws = stem(w);
    if (presentStems.includes(ws) || present.some((p) => p.startsWith(w))) continue;
    let best: { s: string; d: number } | undefined;
    for (const p of presentStems) {
      const d = levenshtein(ws, p);
      if (!best || d < best.d) best = { s: p, d };
    }
    if (best && best.d <= Math.max(2, Math.floor(ws.length * maxDistanceRatio))) out.push({ wanted: w, closest: best.s, distance: best.d });
  }
  return out;
}

/** Called after a failed test: attaches drift suggestions for the ids the test asked for. */
export async function attachDriftSuggestions(info: TestInfo): Promise<void> {
  const t = tracked.get(info);
  if (!t || t.page.isClosed()) return;
  let present: string[] = [];
  try {
    present = await t.page.$$eval('[data-qa]', (els) => els.map((e) => e.getAttribute('data-qa') ?? ''));
  } catch {
    return;
  }
  const missing = [...t.ids].filter((id) => !present.includes(id) && !present.some((p) => p.startsWith(id)));
  const s = suggest(missing, present).map((x) => ({ ...x, url: t.page.url() }));
  if (s.length) await info.attach('qip-drift', { body: JSON.stringify(s), contentType: 'application/json' });
}
