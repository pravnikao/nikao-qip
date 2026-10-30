import { test, expect } from '@playwright/test';
import { computeDefectRows, regressions } from '../../core/report/defect-state';
import { clusterUnlinked, errorSignature } from '../../core/report/clusters';
import { buildCheck, summarise } from '../../core/report/summary';
import type { TestRecord } from '../../core/report/types';
import type { RunSnapshot } from '../../core/report/history';

function rec(key: string, outcome: string, extra: Partial<TestRecord> = {}): TestRecord {
  return { key, project: 'ui', layer: 'ui', screen: 'Positions', spec: 'positions.spec.ts', fr: [], title: key, describe: '', status: 'passed', outcome, refs: [], detail: '', durationMs: 1, attempts: 1, tags: [], perf: [], driftSuggestions: [], ...extra };
}
function snap(outcomes: Record<string, string>, rows: Record<string, number> = {}, at = '2026-10-20T00:00:00Z'): RunSnapshot {
  return { runId: at, environment: 'test', startedAt: at, outcomes, rowsChecked: rows, refs: {}, screens: {}, titles: {} };
}
const opts = { cleanRunsRequired: 2, newDefectDays: 7, today: new Date('2026-10-30') };
const reg = (defects: Record<string, object>, verdicts: Record<string, object> = {}) => ({ defects, verdicts } as never);

test.describe('defect states', () => {
  test('ticket = Active; no ticket recent = New; older = Active – Unlinked; verdict = Closed', () => {
    const rows = computeDefectRows([], reg({
      'BUG-UI-001': { summary: '', screen: 'S', priority: 'High', tickets: ['J-1'] },
      'BUG-UI-002': { summary: '', screen: 'S', priority: 'High', tickets: [], raised: '2026-10-28' },
      'BUG-UI-003': { summary: '', screen: 'S', priority: 'High', tickets: [], raised: '2026-09-01' },
      'BUG-UI-004': { summary: '', screen: 'S', priority: 'High', tickets: ['J-4'] },
    }, { 'BUG-UI-004': { verdict: 'Retest Pass', date: '2026-10-29' } }), [], opts);
    expect(rows.map((r) => r.state)).toEqual(['Active', 'New', 'Active – Unlinked', 'Closed']);
  });

  test('ready to close only after N clean runs that checked rows', () => {
    const cur = [rec('k1', 'Pass – defect annotated', { refs: ['BUG-UI-001'], rowsChecked: 12 })];
    const r = (history: RunSnapshot[]) => computeDefectRows(cur, reg({ 'BUG-UI-001': { summary: '', screen: 'S', priority: 'High', tickets: ['J-1'] } }), history, opts)[0];
    expect(r([]).closure).toEqual({ ready: false, reason: 'Only 1 of 2 runs in history' });
    expect(r([snap({ k1: 'Fail – known defect' })]).closure.reason).toBe('The previous run: a linked test was Fail – known defect');
    expect(r([snap({ k1: 'Pass – defect annotated' }, { k1: 0 })]).closure.reason).toBe('The previous run: the pass checked 0 rows (needs 1)');
    expect(r([snap({ k1: 'Pass – defect annotated' }, { k1: 5 })]).closure.ready).toBe(true);
  });

  test('data-sensitive defects need enough rows; intermittent ones never auto-close', () => {
    const cur = [rec('k1', 'Pass – defect annotated', { refs: ['BUG-UI-005'], rowsChecked: 40 })];
    const hist = [snap({ k1: 'Pass – defect annotated' }, { k1: 40 })];
    const ds = computeDefectRows(cur, reg({ 'BUG-UI-005': { summary: '', screen: 'S', priority: 'High', tickets: ['J'], dataSensitive: { minRows: 50 } } }), hist, opts)[0];
    expect(ds.closure.reason).toBe('This run: the pass checked 40 rows (needs 50)');
    const im = computeDefectRows([rec('k1', 'Pass – defect annotated', { refs: ['BUG-UI-006'] })], reg({ 'BUG-UI-006': { summary: '', screen: 'S', priority: 'High', tickets: ['J'], intermittent: true } }), hist, opts)[0];
    expect(im.closure.ready).toBe(false);
    expect(im.closure.reason).toMatch(/Intermittent/);
  });

  test('closed but failing is flagged for reopening; BAU verdict still stands', () => {
    const row = computeDefectRows([rec('k1', 'Fail – known defect', { refs: ['BUG-UI-152'] })], reg({ 'BUG-UI-152': { summary: '', screen: 'S', priority: 'Low', tickets: [] } }, { 'BUG-UI-152': { verdict: 'Retest Pass', date: '2026-10-10' } }), [], opts)[0];
    expect(row.state).toBe('Closed');
    expect(row.check).toBe('Closed but failing: reopen?');
  });

  test('an environment-only failure asks for a retest, not a verdict', () => {
    const row = computeDefectRows([rec('k1', 'Fail – infrastructure', { refs: ['BUG-API-007'] })], reg({}), [], opts)[0];
    expect(row.check).toBe('Environment failed: retest');
  });

  test('regressions: passed in baseline, fail now for a product reason', () => {
    const base = snap({ a: 'Pass', b: 'Pass', c: 'Fail – unlinked' });
    const now = [rec('a', 'Fail – unlinked'), rec('b', 'Fail – infrastructure'), rec('c', 'Fail – unlinked')];
    expect(regressions(now, base).map((r) => r.key)).toEqual(['a']);
  });
});

test.describe('clusters and summary', () => {
  test('error signatures collapse ids, numbers, urls and quoted values', () => {
    expect(errorSignature('Error: API has 50 position(s) in the window but https://x/y shows "ACME" for 9d1c2b3a-1111-2222-3333-444455556666')).toBe('Error: API has N position(s) in the window but <url> shows "…" for <id>');
  });

  test('unlinked failures group by spec and signature; infra and setup are labelled', () => {
    const rs = [
      rec('a', 'Fail – unlinked', { detail: 'Expected: 106 Received: 59' }),
      rec('b', 'Fail – unlinked', { detail: 'Expected: 10 Received: 11' }),
      rec('c', 'Fail – setup', { detail: 'SETUP-FAILED — load: GATEWAY-TIMEOUT — X after 30 s' }),
      rec('d', 'Fail – product question', { detail: 'x' }),
      rec('e', 'Fail – known defect', { refs: ['BUG-UI-1'], detail: 'x' }),
    ];
    const c = clusterUnlinked(rs, snap({ a: 'Pass', b: 'Pass' }));
    expect(c).toHaveLength(2);
    expect(c.find((x) => x.outcome === 'Fail – unlinked')?.tests).toHaveLength(2);
    expect(c.find((x) => x.outcome === 'Fail – unlinked')?.group).toBe('Regression');
    expect(c.find((x) => x.outcome === 'Fail – setup')?.group).toBe('Environment');
  });

  test('pass rates and the build check', () => {
    const rs = [rec('a', 'Pass'), rec('b', 'Fail – known defect'), rec('c', 'Skip – Data absent'), rec('d', 'Skip – No reason recorded'), rec('e', 'Pass', { screen: 'UNMAPPED: x' })];
    const s = summarise(rs).total;
    expect(s.executed).toBe(3);
    expect(s.passRate).toBeCloseTo(2 / 3);
    expect(s.passRateExpected).toBe(1);
    const chk = buildCheck(rs);
    expect(chk.ok).toBe(false);
    expect(chk.problems[0]).toMatch(/1 skip\(s\) without a categorised reason/);
    expect(chk.warnings[0]).toMatch(/1 unmapped screen/);
  });
});
