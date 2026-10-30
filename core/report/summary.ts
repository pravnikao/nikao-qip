import { OUTCOME, SKIP_CATEGORIES, UNCATEGORISED_SKIPS, isSkip } from '../classify/outcomes';
import type { TestRecord } from './types';

export interface LayerSummary {
  layer: string;
  total: number;
  counts: Record<string, number>;
  executed: number;
  passed: number;
  /** Pass rate of executed tests (product view: known defects count as failures). */
  passRate: number;
  /** Pass rate counting known defects and product questions as expected (suite health view). */
  passRateExpected: number;
}

export function summarise(records: TestRecord[]): { layers: LayerSummary[]; total: LayerSummary } {
  const by = new Map<string, TestRecord[]>();
  for (const r of records) (by.get(r.layer) ?? by.set(r.layer, []).get(r.layer)!).push(r);
  const one = (layer: string, rs: TestRecord[]): LayerSummary => {
    const counts: Record<string, number> = {};
    for (const r of rs) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
    const executed = rs.filter((r) => !isSkip(r.outcome) && r.outcome !== OUTCOME.didNotRun).length;
    const passed = (counts[OUTCOME.pass] ?? 0) + (counts[OUTCOME.passAnnotated] ?? 0) + (counts[OUTCOME.flaky] ?? 0);
    const expected = passed + (counts[OUTCOME.failKnown] ?? 0) + (counts[OUTCOME.failQuestion] ?? 0);
    return { layer, total: rs.length, counts, executed, passed, passRate: executed ? passed / executed : 0, passRateExpected: executed ? expected / executed : 0 };
  };
  const layers = [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([l, rs]) => one(l, rs));
  return { layers, total: one('All', records) };
}

export interface BuildCheck {
  ok: boolean;
  problems: string[];
  warnings: string[];
}

/**
 * The report's own quality gate:
 *  - every skip has a categorised reason (fails the build otherwise)
 *  - every test maps to a screen (warning)
 */
export function buildCheck(records: TestRecord[]): BuildCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  const uncategorised = records.filter((r) => UNCATEGORISED_SKIPS.includes(r.outcome as never));
  if (uncategorised.length) {
    problems.push(`${uncategorised.length} skip(s) without a categorised reason: ` + uncategorised.slice(0, 5).map((r) => `${r.spec} › ${r.title}`).join('; '));
  }
  const unmapped = [...new Set(records.filter((r) => r.screen.startsWith('UNMAPPED')).map((r) => r.screen))];
  if (unmapped.length) warnings.push(`${unmapped.length} unmapped screen name(s): ${unmapped.join('; ')}`);
  return { ok: problems.length === 0, problems, warnings };
}

export function skipBreakdown(records: TestRecord[]): { category: string; count: number }[] {
  return [...SKIP_CATEGORIES, ...UNCATEGORISED_SKIPS].map((c) => ({ category: c, count: records.filter((r) => r.outcome === c).length })).filter((x) => x.count > 0);
}
