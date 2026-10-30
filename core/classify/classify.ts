import { ANNOTATION, SKIP_PREFIX } from '../defects/annotations';
import { OUTCOME, Outcome } from './outcomes';

/**
 * Pure classification of one test result. No Playwright imports here, so it is
 * unit-testable and reusable by the report builder.
 */

export interface Annotation {
  type: string;
  description?: string;
}

export interface RawResult {
  /** Final status after retries. */
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  /** True when an earlier attempt failed and a later one passed. */
  passedOnRetry?: boolean;
  annotations: Annotation[];
  /** First error message of the final attempt. */
  error?: string;
  /** Skip reason (from test.skip(cond, reason) / annotations of type "skip"). */
  skipReason?: string;
  /** Set by the reporter: an earlier test in the same serial describe failed. */
  cascadeCause?: string;
  /** Test never started (run aborted, max failures). */
  didNotRun?: boolean;
}

/**
 * Error text that means the environment, not the product, failed.
 * Order matters only for readability; any match classifies as infrastructure.
 */
export const INFRA_PATTERNS: RegExp[] = [
  /GATEWAY-TIMEOUT/,
  /READ-MODEL-LAG/,
  /AUTH-EXPIRED/,
  /ENV-UNAVAILABLE/,
  /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND)\b/,
  /socket hang up/i,
  /net::ERR_(CONNECTION|NAME|TIMED_OUT|NETWORK)/,
  /\b(502 Bad Gateway|503 Service Unavailable|504 Gateway Time-?out)\b/i,
];

export const SETUP_PATTERNS: RegExp[] = [/SETUP-FAILED —/, /^beforeAll failed/i, /"beforeAll" hook/i, /"beforeEach" hook timeout/i];

export function hasAnnotation(annotations: Annotation[], type: string): boolean {
  return annotations.some((a) => a.type === type);
}

/** Defect references attached with bug(). */
export function defectRefs(annotations: Annotation[]): string[] {
  const refs = new Set<string>();
  for (const a of annotations) {
    if (a.type === ANNOTATION.bug && a.description) {
      try {
        refs.add(JSON.parse(a.description).ref);
      } catch {
        /* ignore malformed */
      }
    }
    if (a.type === ANNOTATION.blockedBy && a.description) refs.add(a.description);
  }
  return [...refs].sort();
}

export function bugPriority(annotations: Annotation[]): string | undefined {
  const order = ['High', 'Medium', 'Low'];
  let best: string | undefined;
  for (const a of annotations) {
    if (a.type !== ANNOTATION.bug || !a.description) continue;
    try {
      const p = JSON.parse(a.description).priority as string;
      if (!best || order.indexOf(p) < order.indexOf(best)) best = p;
    } catch {
      /* ignore */
    }
  }
  return best;
}

export function rowsCheckedOf(annotations: Annotation[]): number | undefined {
  const a = [...annotations].reverse().find((x) => x.type === ANNOTATION.rowsChecked);
  return a?.description !== undefined ? Number(a.description) : undefined;
}

export function classifySkip(reason: string | undefined, cascadeCause?: string): Outcome {
  const r = (reason ?? '').trim();
  if (!r) return cascadeCause ? OUTCOME.skipCascade : OUTCOME.skipNoReason;
  const starts = (p: string) => r.startsWith(p);
  if (starts(SKIP_PREFIX.cascade)) return OUTCOME.skipCascade;
  if (starts(SKIP_PREFIX.blockedByDefect)) return OUTCOME.skipBlockedByDefect;
  if (starts(SKIP_PREFIX.dataAbsent)) return OUTCOME.skipDataAbsent;
  if (starts(SKIP_PREFIX.blockedEnv)) return OUTCOME.skipBlockedEnv;
  if (starts(SKIP_PREFIX.notDeployed)) return OUTCOME.skipNotDeployed;
  if (starts(SKIP_PREFIX.notApplicable)) return OUTCOME.skipNotApplicable;
  if (starts(SKIP_PREFIX.notAutomated)) return OUTCOME.skipNotAutomated;
  if (starts(SKIP_PREFIX.deferred)) return OUTCOME.skipDeferred;
  return OUTCOME.skipOther;
}

export function buildCascadeReason(causeTitle: string): string {
  const id = causeTitle.match(/\b(TC-\d+|FR-[A-Z0-9-]+)\b/)?.[1] ?? causeTitle.slice(0, 60);
  return `${SKIP_PREFIX.cascade} — depends on ${id}'s result; ${id} failed`;
}

export function classify(r: RawResult): Outcome {
  if (r.didNotRun) return OUTCOME.didNotRun;
  if (r.status === 'skipped') return classifySkip(r.skipReason, r.cascadeCause);

  const annotated = defectRefs(r.annotations).length > 0;
  const question = hasAnnotation(r.annotations, ANNOTATION.productQuestion);

  if (r.status === 'passed') {
    if (r.passedOnRetry) return OUTCOME.flaky;
    return annotated ? OUTCOME.passAnnotated : OUTCOME.pass;
  }

  const err = r.error ?? '';
  if (INFRA_PATTERNS.some((p) => p.test(err))) return OUTCOME.failInfra;
  if (annotated) return OUTCOME.failKnown;
  if (question) return OUTCOME.failQuestion;
  if (SETUP_PATTERNS.some((p) => p.test(err))) return OUTCOME.failSetup;
  return OUTCOME.failUnlinked;
}
