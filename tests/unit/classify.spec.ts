import { test, expect } from '@playwright/test';
import { buildCascadeReason, classify, classifySkip, defectRefs } from '../../core/classify/classify';
import { OUTCOME } from '../../core/classify/outcomes';
import { ANNOTATION } from '../../core/defects/annotations';

const bugAnn = (ref: string) => ({ type: ANNOTATION.bug, description: JSON.stringify({ ref, priority: 'High' }) });

test.describe('classify', () => {
  test('passes, annotated passes and flaky passes', () => {
    expect(classify({ status: 'passed', annotations: [] })).toBe(OUTCOME.pass);
    expect(classify({ status: 'passed', annotations: [bugAnn('BUG-UI-001')] })).toBe(OUTCOME.passAnnotated);
    expect(classify({ status: 'passed', passedOnRetry: true, annotations: [bugAnn('BUG-UI-001')] })).toBe(OUTCOME.flaky);
  });

  test('infrastructure beats everything, including a defect annotation', () => {
    for (const err of ['GATEWAY-TIMEOUT — DocumentSearch after 30 s (https://x)', 'READ-MODEL-LAG — comment not visible', 'AUTH-EXPIRED — redirected', 'connect ECONNREFUSED 127.0.0.1:443', '504 Gateway Timeout from GET /x']) {
      expect(classify({ status: 'failed', error: err, annotations: [bugAnn('BUG-API-002')] }), err).toBe(OUTCOME.failInfra);
    }
  });

  test('known defect, product question, setup and unlinked failures', () => {
    expect(classify({ status: 'failed', error: 'expect(received).toBe(expected)', annotations: [bugAnn('BUG-API-002')] })).toBe(OUTCOME.failKnown);
    expect(classify({ status: 'failed', error: 'x', annotations: [{ type: ANNOTATION.productQuestion, description: '{"question":"?"}' }] })).toBe(OUTCOME.failQuestion);
    expect(classify({ status: 'failed', error: 'SETUP-FAILED — load grid: 0 rows', annotations: [] })).toBe(OUTCOME.failSetup);
    expect(classify({ status: 'timedOut', error: 'Test timeout of 60000ms exceeded.', annotations: [] })).toBe(OUTCOME.failUnlinked);
  });

  test('every skip prefix maps to its category; anything else is uncategorised', () => {
    expect(classifySkip('DATA-ABSENT — positions @ from=2026-10-27 — test — 0 rows')).toBe(OUTCOME.skipDataAbsent);
    expect(classifySkip('BLOCKED-BY-DEFECT — BUG-API-069 (comment save fails)')).toBe(OUTCOME.skipBlockedByDefect);
    expect(classifySkip('BLOCKED-ENV — needs VPN')).toBe(OUTCOME.skipBlockedEnv);
    expect(classifySkip('NOT-DEPLOYED — not on test')).toBe(OUTCOME.skipNotDeployed);
    expect(classifySkip('NOT-APPLICABLE — prod only')).toBe(OUTCOME.skipNotApplicable);
    expect(classifySkip('NOT-AUTOMATED — manual')).toBe(OUTCOME.skipNotAutomated);
    expect(classifySkip('DEFERRED — after go-live')).toBe(OUTCOME.skipDeferred);
    expect(classifySkip('CASCADE-SKIP — depends on TC-03')).toBe(OUTCOME.skipCascade);
    expect(classifySkip('flaky, skipping for now')).toBe(OUTCOME.skipOther);
    expect(classifySkip(undefined)).toBe(OUTCOME.skipNoReason);
  });

  test('a reasonless skip after a sibling failed is a cascade, with the cause named', () => {
    expect(classify({ status: 'skipped', annotations: [], cascadeCause: 'TC-03: register an override' })).toBe(OUTCOME.skipCascade);
    expect(buildCascadeReason('TC-03: register an override')).toBe("CASCADE-SKIP — depends on TC-03's result; TC-03 failed");
  });

  test('defect refs come from bug() and blocked-by annotations, de-duplicated', () => {
    expect(defectRefs([bugAnn('BUG-UI-002'), bugAnn('BUG-UI-002'), { type: ANNOTATION.blockedBy, description: 'BUG-API-069' }])).toEqual(['BUG-API-069', 'BUG-UI-002']);
  });

  test('a test that never ran is reported as such', () => {
    expect(classify({ status: 'skipped', annotations: [], didNotRun: true })).toBe(OUTCOME.didNotRun);
  });
});
