import { test } from '@playwright/test';
import { dataAbsentReason, skipBlockedByDefect, skipNotApplicable } from '../defects/annotations';
import { screenData, ResolvedScreenData } from './data-sheet';

/**
 * Probes answer one question before a test reads a screen: does the data exist?
 *
 *  - rows > 0          -> the test runs
 *  - rows = 0          -> row-dependent tests skip DATA-ABSENT (layout tests still run)
 *  - the API errors    -> the probe THROWS: an API failure is never mistaken for "no data"
 *  - sheet says product-issue -> dependants skip BLOCKED-BY-DEFECT, naming the defect
 */

export interface Probe<A = Record<string, unknown>> {
  name: string;
  /** Screen key in the data sheet and client config. */
  screen: string;
  /** Returns the row count at the anchor. Must throw on any API error. Ask for 1 row only if that is all you need. */
  count: (data: ResolvedScreenData<A>) => Promise<number>;
}

const registry = new Map<string, Probe<any>>();

export function defineProbe<A = Record<string, unknown>>(p: Probe<A>): Probe<A> {
  registry.set(p.name, p);
  return p;
}

export function registeredProbes(): Probe<any>[] {
  return [...registry.values()];
}

export class ProbeError extends Error {
  constructor(probe: string, cause: unknown) {
    super(`PROBE-ERROR — ${probe}: ${(cause as Error)?.message ?? String(cause)}`);
    this.name = 'ProbeError';
  }
}

export interface ProbeResult {
  probe: string;
  screen: string;
  environment: string;
  anchor: string;
  rows: number;
  sheetStatus: ScreenStatus;
  /** The sheet and the probe disagree (e.g. sheet says data-absent but rows exist). */
  sheetStale: boolean;
  blockedBy?: string;
}

type ScreenStatus = 'data' | 'data-absent' | 'product-issue' | 'not-applicable';

export async function runProbe<A>(p: Probe<A>): Promise<ProbeResult> {
  const data = screenData<A>(p.screen);
  let rows: number;
  try {
    rows = await p.count(data);
  } catch (e) {
    throw new ProbeError(p.name, e);
  }
  const stale = (data.status === 'data' && rows === 0) || (data.status !== 'data' && data.status !== 'not-applicable' && rows > 0);
  return {
    probe: p.name,
    screen: p.screen,
    environment: data.environment,
    anchor: data.anchorLabel,
    rows,
    sheetStatus: data.status,
    sheetStale: stale,
    blockedBy: data.blockedBy,
  };
}

export interface RequireRowsOptions {
  /** Minimum rows the check needs. Default 1. */
  min?: number;
  /** A paging/sorting/count check: needs the sheet's minRows for this screen. */
  dataSensitive?: boolean;
}

/**
 * Use inside a row-dependent test (or beforeAll of a row-dependent describe).
 * Returns the row count, or skips with a categorised reason.
 */
export async function requireRows<A>(p: Probe<A>, opts: RequireRowsOptions = {}): Promise<{ rows: number; data: ResolvedScreenData<A> }> {
  const data = screenData<A>(p.screen);
  if (data.status === 'not-applicable') {
    skipNotApplicable(`${p.screen} is not on ${data.environment}`);
  }
  const result = await runProbe(p);
  const min = opts.min ?? (opts.dataSensitive ? data.minRows ?? 1 : 1);
  if (result.rows >= min) return { rows: result.rows, data };
  if (data.status === 'product-issue' && data.blockedBy) {
    skipBlockedByDefect(data.blockedBy, `${p.screen} has ${result.rows} rows: ${data.notes ?? 'see the data sheet'}`);
  }
  test.skip(true, dataAbsentReason({ screen: p.screen, anchor: data.anchorLabel + (min > 1 ? ` (needs ${min})` : ''), rows: result.rows }));
  return { rows: result.rows, data };
}
