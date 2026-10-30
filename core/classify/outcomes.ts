/** Every outcome the reporter can assign. The workbook, trends and BAU packs key off these strings. */
export const OUTCOME = {
  pass: 'Pass',
  passAnnotated: 'Pass – defect annotated',
  flaky: 'Flaky',
  failKnown: 'Fail – known defect',
  failQuestion: 'Fail – product question',
  failUnlinked: 'Fail – unlinked',
  failInfra: 'Fail – infrastructure',
  failSetup: 'Fail – setup',
  skipDataAbsent: 'Skip – Data absent',
  skipBlockedByDefect: 'Skip – Blocked by defect',
  skipBlockedEnv: 'Skip – Blocked (env / access)',
  skipNotDeployed: 'Skip – Not deployed / out of scope',
  skipNotApplicable: 'Skip – Not applicable here',
  skipNotAutomated: 'Skip – Not automated',
  skipDeferred: 'Skip – Deferred',
  skipCascade: 'Skip – Blocked by earlier failure',
  skipNoReason: 'Skip – No reason recorded',
  skipOther: 'Skip – Other',
  didNotRun: 'Did not run',
} as const;

export type Outcome = (typeof OUTCOME)[keyof typeof OUTCOME];

/** The categorised skips. "No reason recorded" and "Other" fail the build check. */
export const SKIP_CATEGORIES: Outcome[] = [
  OUTCOME.skipDataAbsent,
  OUTCOME.skipBlockedByDefect,
  OUTCOME.skipBlockedEnv,
  OUTCOME.skipNotDeployed,
  OUTCOME.skipNotApplicable,
  OUTCOME.skipNotAutomated,
  OUTCOME.skipDeferred,
  OUTCOME.skipCascade,
];

export const UNCATEGORISED_SKIPS: Outcome[] = [OUTCOME.skipNoReason, OUTCOME.skipOther];

export function isPass(o: string): boolean {
  return o === OUTCOME.pass || o === OUTCOME.passAnnotated;
}
export function isFail(o: string): boolean {
  return o.startsWith('Fail');
}
export function isSkip(o: string): boolean {
  return o.startsWith('Skip');
}
/** Failures that say nothing about the product: environment, setup. */
export function isNonProductFail(o: string): boolean {
  return o === OUTCOME.failInfra || o === OUTCOME.failSetup;
}
