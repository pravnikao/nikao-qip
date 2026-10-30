import { test } from '@playwright/test';
import { activeEnvironmentName } from '../config/client-config';

/**
 * Test-side defect and metadata API.
 *
 * The single most important rule: annotate, don't guard.
 * A confirmed defect gets bug() and the test is left to fail naturally.
 * test.skip is only for real data absence or a known environment gap, and it
 * always carries a categorised reason (see skip* helpers below).
 */

export type Priority = 'High' | 'Medium' | 'Low';

export const ANNOTATION = {
  meta: 'qip:meta',
  bug: 'qip:bug',
  productQuestion: 'qip:product-question',
  rowsChecked: 'qip:rows-checked',
  blockedBy: 'qip:blocked-by',
} as const;

export const DEFECT_REF = /^(BUG-(UI|API|E2E)-\d{3,})$/;

export interface TestMeta {
  /** Screen key from client.config.ts screens (or its title). */
  screen: string;
  /** Functional requirement id(s), e.g. FR-PS-14. */
  fr?: string | string[];
  /** Plain-English purpose, shown in the workbook's "What it tests" column. */
  what?: string;
  how?: string;
  expected?: string;
}

function push(type: string, description: string): void {
  test.info().annotations.push({ type, description });
}

/** Tags the running test with its screen, FR and intent. Call first in the test body. */
export function meta(m: TestMeta): void {
  push(ANNOTATION.meta, JSON.stringify(m));
}

export interface BugOptions {
  priority: Priority;
  /** One line: what is wrong. */
  summary?: string;
  /** The defect does not reproduce every run; closure needs dev confirmation, not two clean runs. */
  intermittent?: boolean;
}

/**
 * Links the running test to a known defect. The test keeps its assertions and
 * is reported as "Fail – known defect" while it fails, "Pass – defect annotated" when it passes.
 */
export function bug(ref: string, opts: BugOptions): void {
  if (!DEFECT_REF.test(ref)) throw new Error(`bug(): "${ref}" is not a defect reference (BUG-UI-001 / BUG-API-001)`);
  push(ANNOTATION.bug, JSON.stringify({ ref, ...opts }));
}

/** Alias kept for teams used to the longer name. */
export const annotateBug = bug;

/**
 * The expected behaviour is unclear, so a business owner must answer.
 * The assertion stays; the failure reports as "Fail – product question", not as a defect.
 */
export function productQuestion(question: string, opts: { ref?: string } = {}): void {
  push(ANNOTATION.productQuestion, JSON.stringify({ question, ...opts }));
}

/**
 * Records how many rows/items the test actually asserted on.
 * A pass with 0 rows checked never counts towards closing a defect (no vacuous closures).
 */
export function rowsChecked(count: number): void {
  push(ANNOTATION.rowsChecked, String(count));
}

/* ------------------------------------------------------------------ skips */

/** Skip prefixes. The classifier maps each to a skip category; anything else fails the build check. */
export const SKIP_PREFIX = {
  dataAbsent: 'DATA-ABSENT',
  blockedByDefect: 'BLOCKED-BY-DEFECT',
  blockedEnv: 'BLOCKED-ENV',
  notDeployed: 'NOT-DEPLOYED',
  notApplicable: 'NOT-APPLICABLE',
  notAutomated: 'NOT-AUTOMATED',
  deferred: 'DEFERRED',
  cascade: 'CASCADE-SKIP',
} as const;

export interface DataAbsentInfo {
  screen: string;
  /** The data anchor that was probed, e.g. "tradeDate=2026-10-27". */
  anchor: string;
  rows: number;
}

export function dataAbsentReason(i: DataAbsentInfo): string {
  return `${SKIP_PREFIX.dataAbsent} — ${i.screen} @ ${i.anchor} — ${safeEnvName()} — ${i.rows} rows`;
}

/** Skips the running test because the probed data is genuinely absent. */
export function skipDataAbsent(i: DataAbsentInfo): void {
  test.skip(true, dataAbsentReason(i));
}

/**
 * The data a test needs cannot exist because of a known defect (e.g. saving fails).
 * The defect is reported once, by its canary test; dependants skip with this reason.
 */
export function skipBlockedByDefect(ref: string, note: string): void {
  push(ANNOTATION.blockedBy, ref);
  test.skip(true, `${SKIP_PREFIX.blockedByDefect} — ${ref} (${note})`);
}

export function skipBlockedEnv(detail: string): void {
  test.skip(true, `${SKIP_PREFIX.blockedEnv} — ${detail}`);
}

export function skipNotDeployed(detail: string): void {
  test.skip(true, `${SKIP_PREFIX.notDeployed} — ${detail}`);
}

export function skipNotApplicable(detail: string): void {
  test.skip(true, `${SKIP_PREFIX.notApplicable} — ${detail}`);
}

export function skipNotAutomated(detail: string): void {
  test.skip(true, `${SKIP_PREFIX.notAutomated} — ${detail}`);
}

export function skipDeferred(detail: string): void {
  test.skip(true, `${SKIP_PREFIX.deferred} — ${detail}`);
}

function safeEnvName(): string {
  try {
    return activeEnvironmentName();
  } catch {
    return 'unknown-env';
  }
}

/**
 * Wraps a beforeAll/beforeEach body so a failure is reported as a setup failure
 * with a readable name, instead of the first test's anonymous error.
 */
export async function setupStep<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const err = e as Error;
    err.message = `SETUP-FAILED — ${name}: ${err.message}`;
    throw err;
  }
}
