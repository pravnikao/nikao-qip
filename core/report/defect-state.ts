import { isFail, isNonProductFail, isPass, isSkip, OUTCOME } from '../classify/outcomes';
import type { TestRecord } from './types';
import type { Registry } from './registry';
import type { RunSnapshot } from './history';

/**
 * Defect states and the closure rule.
 *
 * States
 *   Closed            BAU verdict "Retest Pass" or "Not a defect" (people decide; never overridden)
 *   Active            has a ticket in the client's tracker
 *   New               no ticket yet, first seen within newDefectDays
 *   Active – Unlinked no ticket, older than that: raise it or close it
 *
 * Closure candidate ("ready to close") only when ALL hold:
 *   - the last N runs (N = cleanRunsRequired) each ran at least one linked test
 *   - every linked test passed in each of those runs
 *   - no pass was vacuous: rows checked > 0 (and >= minRows for data-sensitive defects)
 *   - the defect is not intermittent (those close on dev confirmation)
 */

export type DefectState = 'Closed' | 'Active' | 'New' | 'Active – Unlinked';

export interface DefectRow {
  ref: string;
  state: DefectState;
  tickets: string[];
  priority: string;
  type: string;
  screen: string;
  summary: string;
  testsLinked: number;
  failingNow: number;
  passingNow: number;
  skippedNow: number;
  closure: { ready: boolean; reason: string };
  /** Something for a person to look at. */
  check?: 'Closed but failing: reopen?' | 'Passing but Active: one clean run' | 'No linked test' | 'Not exercised this run' | 'Environment failed: retest';
  regressedTests: number;
  intermittent: boolean;
  verdict?: string;
}

export function computeDefectRows(
  records: TestRecord[],
  registry: Registry,
  history: RunSnapshot[],
  opts: { cleanRunsRequired: number; newDefectDays: number; today?: Date; baseline?: RunSnapshot; currentRunId?: string },
): DefectRow[] {
  const byRef = new Map<string, TestRecord[]>();
  for (const r of records) for (const ref of r.refs) (byRef.get(ref) ?? byRef.set(ref, []).get(ref)!).push(r);
  const refs = new Set([...Object.keys(registry.defects), ...byRef.keys()]);
  const today = opts.today ?? new Date();
  const rows: DefectRow[] = [];

  for (const ref of [...refs].sort()) {
    const d = registry.defects[ref];
    const tests = byRef.get(ref) ?? [];
    const v = registry.verdicts[ref];
    const failingNow = tests.filter((t) => isFail(t.outcome) && !isNonProductFail(t.outcome)).length;
    const passingNow = tests.filter((t) => isPass(t.outcome)).length;
    const skippedNow = tests.filter((t) => isSkip(t.outcome)).length;

    let state: DefectState;
    if (v && (v.verdict === 'Retest Pass' || v.verdict === 'Not a defect' || v.verdict === 'Duplicate')) state = 'Closed';
    else if (d?.tickets?.length) state = 'Active';
    else {
      const raised = d?.raised ? new Date(d.raised) : today;
      state = (today.getTime() - raised.getTime()) / 86_400_000 <= opts.newDefectDays ? 'New' : 'Active – Unlinked';
    }

    const closure = closureCheck(ref, tests, history.filter((h) => h.runId !== opts.currentRunId), opts.cleanRunsRequired, d?.intermittent ?? false, d?.dataSensitive?.minRows);
    const regressedTests = opts.baseline ? tests.filter((t) => isFail(t.outcome) && !isNonProductFail(t.outcome) && isPass(opts.baseline!.outcomes[t.key] ?? '')).length : 0;

    let check: DefectRow['check'];
    if (state === 'Closed' && failingNow > 0) check = 'Closed but failing: reopen?';
    else if (!tests.length) check = 'No linked test';
    else if (failingNow + passingNow === 0) check = tests.some((t) => isNonProductFail(t.outcome)) ? 'Environment failed: retest' : 'Not exercised this run';
    else if (state !== 'Closed' && failingNow === 0 && passingNow > 0 && !closure.ready) check = 'Passing but Active: one clean run';

    rows.push({
      ref,
      state,
      tickets: d?.tickets ?? [],
      priority: d?.priority ?? tests.find((t) => t.priority)?.priority ?? '',
      type: d?.type ?? '',
      screen: d?.screen ?? tests[0]?.screen ?? '',
      summary: d?.summary ?? '',
      testsLinked: tests.length,
      failingNow,
      passingNow,
      skippedNow,
      closure: state === 'Closed' ? { ready: false, reason: `Closed (${v?.verdict})` } : closure,
      check,
      regressedTests,
      intermittent: d?.intermittent ?? false,
      verdict: v?.verdict,
    });
  }
  return rows;
}

function closureCheck(ref: string, current: TestRecord[], history: RunSnapshot[], n: number, intermittent: boolean, minRows?: number): { ready: boolean; reason: string } {
  if (!current.length) return { ready: false, reason: 'No linked test in this run' };
  if (intermittent) return { ready: false, reason: 'Intermittent: close only on dev confirmation of a fix' };
  const keys = new Set(current.map((t) => t.key));
  // Current run first, then earlier runs, newest first (the caller removes the current run from history).
  const window = [
    { outcomes: Object.fromEntries(current.map((t) => [t.key, t.outcome])), rows: Object.fromEntries(current.filter((t) => t.rowsChecked !== undefined).map((t) => [t.key, t.rowsChecked!])) },
    ...[...history].reverse().map((h) => ({ outcomes: h.outcomes, rows: h.rowsChecked })),
  ].slice(0, n);
  if (window.length < n) return { ready: false, reason: `Only ${window.length} of ${n} runs in history` };
  const when = (i: number) => (i === 0 ? 'This run' : i === 1 ? 'The previous run' : `${i} runs back`);
  for (let i = 0; i < window.length; i++) {
    const run = window[i];
    const ran = [...keys].filter((k) => run.outcomes[k] && !isSkip(run.outcomes[k]) && run.outcomes[k] !== OUTCOME.didNotRun);
    if (!ran.length) return { ready: false, reason: `${when(i)} did not exercise ${ref}` };
    const bad = ran.find((k) => !isPass(run.outcomes[k]) && run.outcomes[k] !== OUTCOME.flaky);
    if (bad) return { ready: false, reason: `${when(i)}: a linked test was ${run.outcomes[bad]}` };
    if (ran.some((k) => run.outcomes[k] === OUTCOME.flaky)) return { ready: false, reason: `${when(i)}: a linked test was flaky` };
    const vacuous = ran.find((k) => run.rows[k] !== undefined && run.rows[k] < (minRows ?? 1));
    if (vacuous) return { ready: false, reason: `${when(i)}: the pass checked ${run.rows[vacuous]} rows (needs ${minRows ?? 1})` };
  }
  return { ready: true, reason: `${n} consecutive clean runs with data` };
}

/** Tests that passed in the baseline run and fail now for product reasons. */
export function regressions(records: TestRecord[], baseline: RunSnapshot): TestRecord[] {
  return records.filter((r) => isFail(r.outcome) && !isNonProductFail(r.outcome) && isPass(baseline.outcomes[r.key] ?? ''));
}
