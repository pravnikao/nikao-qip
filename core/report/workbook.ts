import ExcelJS from 'exceljs';
import { OUTCOME } from '../classify/outcomes';
import { summarisePerf } from '../perf/perf';
import { clusterUnlinked } from './clusters';
import { DefectRow } from './defect-state';
import { COLORS, fillCell, outcomeFill, pct, table, title } from './excel';
import type { MergedRun } from './load';
import type { RunSnapshot } from './history';
import { buildCheck, skipBreakdown, summarise } from './summary';

/**
 * The run report: one workbook a QA lead, a developer and a business reviewer can all read.
 * Sheets: Dashboard, Results, Defects, Triage, Performance, Locator drift, Trend, Read Me.
 */
export async function buildRunWorkbook(input: {
  run: MergedRun;
  defects: DefectRow[];
  history: RunSnapshot[];
  baseline?: RunSnapshot;
  clientName: string;
  trackerName: string;
  out: string;
}): Promise<{ file: string; check: ReturnType<typeof buildCheck> }> {
  const { run, defects } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Nikao QIP';
  const runLine = `Environment: ${run.environment} · Branch: ${run.branch ?? 'local'} · Run: ${run.runId} · ` + run.projects.map((p) => `${p.project} ${p.startedAt.slice(0, 16).replace('T', ' ')}`).join('; ');
  const s = summarise(run.records);
  const check = buildCheck(run.records);
  const clusters = clusterUnlinked(run.records, input.baseline);

  // Dashboard
  const d = wb.addWorksheet('Dashboard');
  title(d, `${input.clientName}: test run report`, runLine);
  const outcomeCols = [OUTCOME.pass, OUTCOME.passAnnotated, OUTCOME.failKnown, OUTCOME.failQuestion, OUTCOME.failUnlinked, OUTCOME.failInfra, OUTCOME.failSetup, OUTCOME.flaky];
  let row = table(
    d,
    4,
    [{ header: 'Layer', width: 14 }, { header: 'Tests', width: 8 }, ...outcomeCols.map((o) => ({ header: o, width: 13, wrap: true })), { header: 'Skipped', width: 9 }, { header: 'Pass rate (executed)', width: 12 }, { header: 'Pass rate (known defects expected)', width: 14, wrap: true }],
    [...s.layers, s.total].map((l) => [
      l.layer,
      l.total,
      ...outcomeCols.map((o) => l.counts[o] ?? 0),
      Object.entries(l.counts).filter(([k]) => k.startsWith('Skip')).reduce((a, [, v]) => a + v, 0),
      pct(l.passed, l.executed),
      pct(Math.round(l.passRateExpected * l.executed), l.executed),
    ]),
  );
  d.getRow(4).height = 45;
  d.getCell(`A${row}`).value = 'Build check';
  d.getCell(`A${row}`).font = { name: 'Arial', bold: true };
  d.getCell(`B${row}`).value = check.ok ? 'PASS: every skip has a categorised reason' : `FAIL: ${check.problems.join(' | ')}`;
  fillCell(d, row, 2, check.ok ? COLORS.pass : COLORS.fail);
  row++;
  for (const w of check.warnings) {
    d.getCell(`B${row}`).value = `Warning: ${w}`;
    fillCell(d, row, 2, COLORS.warn);
    row++;
  }
  row++;
  row = table(d, row, [{ header: 'Why tests were skipped', width: 40 }, { header: 'Tests', width: 8 }], skipBreakdown(run.records).map((x) => [x.category, x.count]));
  const states = ['Active', 'Active – Unlinked', 'New', 'Closed'].map((st) => [st, defects.filter((x) => x.state === st).length]);
  row = table(d, row, [{ header: 'Defect state', width: 40 }, { header: 'Defects', width: 8 }], [...states, ['Ready to close', defects.filter((x) => x.closure.ready).length], ['Closed but failing (reopen?)', defects.filter((x) => x.check === 'Closed but failing: reopen?').length]]);
  table(d, row, [{ header: 'Largest groups of unlinked failures', width: 40 }, { header: 'Tests', width: 8 }, { header: 'Group', width: 14 }, { header: 'Error', width: 70, wrap: true }], clusters.slice().sort((a, b) => b.tests.length - a.tests.length).slice(0, 10).map((c) => [`${c.screen} · ${c.spec}`, c.tests.length, c.group, c.signature]));

  // Results
  const r = wb.addWorksheet('Results');
  title(r, 'Every test, classified', runLine);
  table(
    r,
    4,
    [
      { header: 'Key', width: 13 }, { header: 'Layer', width: 7 }, { header: 'Screen', width: 26 }, { header: 'Spec', width: 30 }, { header: 'FR', width: 14 },
      { header: 'Test', width: 60, wrap: true }, { header: 'Outcome', width: 22 }, { header: 'Defect ref(s)', width: 16 }, { header: 'Priority', width: 9 },
      { header: 'Failure / skip detail', width: 60, wrap: true }, { header: 'Rows checked', width: 8 }, { header: 'Duration (s)', width: 9 }, { header: 'Attempts', width: 8 },
      { header: 'What it tests', width: 40, wrap: true }, { header: 'Tags', width: 20 }, { header: 'Describe', width: 30 },
    ],
    run.records.map((x) => [x.key, x.layer, x.screen, x.spec, x.fr.join(', '), x.title, x.outcome, x.refs.join(', '), x.priority ?? '', x.detail.split('\n').slice(0, 6).join('\n'), x.rowsChecked ?? '', +(x.durationMs / 1000).toFixed(1), x.attempts, x.what ?? '', x.tags.join(' '), x.describe]),
    { freeze: true, filter: true },
  );
  run.records.forEach((x, i) => fillCell(r, 5 + i, 7, outcomeFill(x.outcome)));

  // Defects
  const df = wb.addWorksheet('Defects');
  title(df, 'Defects and their state', `State rules and the closure rule are on Read Me. Tickets: ${input.trackerName}.`);
  table(
    df,
    4,
    [
      { header: 'Defect', width: 13 }, { header: 'State', width: 17 }, { header: 'Ticket(s)', width: 16 }, { header: 'Priority', width: 9 }, { header: 'Type', width: 12 }, { header: 'Screen', width: 26 },
      { header: 'Summary', width: 60, wrap: true }, { header: 'Tests linked', width: 8 }, { header: 'Failing now', width: 8 }, { header: 'Passing now', width: 8 }, { header: 'Skipped now', width: 8 },
      { header: 'Ready to close?', width: 10 }, { header: 'Closure note', width: 40, wrap: true }, { header: 'Check', width: 28 }, { header: 'Regressed tests', width: 9 }, { header: 'BAU verdict', width: 14 },
    ],
    defects.map((x) => [x.ref, x.state, x.tickets.join(', '), x.priority, x.type, x.screen, x.summary, x.testsLinked, x.failingNow, x.passingNow, x.skippedNow, x.closure.ready ? 'Yes' : 'No', x.closure.reason, x.check ?? '', x.regressedTests || '', x.verdict ?? '']),
    { freeze: true, filter: true },
  );
  defects.forEach((x, i) => fillCell(df, 5 + i, 2, x.state === 'Closed' ? COLORS.pass : x.state === 'Active' ? COLORS.fail : x.state === 'New' ? COLORS.info : COLORS.warn));

  // Triage
  const t = wb.addWorksheet('Triage');
  title(t, 'What needs a decision', runLine);
  let tr = 4;
  const section = (name: string) => {
    t.getCell(`A${tr}`).value = name;
    t.getCell(`A${tr}`).font = { name: 'Arial', bold: true, size: 12 };
    tr++;
  };
  section('Ready to close (clean runs with data)');
  tr = table(t, tr, [{ header: 'Defect', width: 14 }, { header: 'Ticket(s)', width: 16 }, { header: 'Screen', width: 26 }, { header: 'Why', width: 50, wrap: true }, { header: 'Decision', width: 14 }], defects.filter((x) => x.closure.ready).map((x) => [x.ref, x.tickets.join(', '), x.screen, x.closure.reason, '']));
  section('Closed, but failing again (reopen?)');
  tr = table(t, tr, [{ header: 'Defect', width: 14 }, { header: 'Verdict', width: 16 }, { header: 'Screen', width: 26 }, { header: 'Failing tests', width: 10 }], defects.filter((x) => x.check === 'Closed but failing: reopen?').map((x) => [x.ref, x.verdict ?? '', x.screen, x.failingNow]));
  section('Active, but no test exercised it this run (retest by hand or wait for data)');
  tr = table(t, tr, [{ header: 'Defect', width: 14 }, { header: 'State', width: 16 }, { header: 'Screen', width: 26 }, { header: 'Why', width: 50, wrap: true }], defects.filter((x) => x.state !== 'Closed' && (x.check === 'Not exercised this run' || x.check === 'No linked test' || x.check === 'Environment failed: retest')).map((x) => [x.ref, x.state, x.screen, x.check ?? '']));
  section('Product questions (a business owner must answer)');
  tr = table(t, tr, [{ header: 'Screen', width: 26 }, { header: 'Test', width: 50, wrap: true }, { header: 'Question', width: 70, wrap: true }, { header: 'Answer', width: 30 }], run.records.filter((x) => x.outcome === OUTCOME.failQuestion).map((x) => [x.screen, x.title, x.question ?? '', '']));
  section('Failures with no defect reference, grouped');
  table(
    t,
    tr,
    [{ header: 'Group id', width: 9 }, { header: 'Group', width: 14 }, { header: 'Screen', width: 26 }, { header: 'Spec', width: 30 }, { header: 'Outcome', width: 20 }, { header: 'Tests', width: 7 }, { header: 'Passed in baseline', width: 9 }, { header: 'Error signature', width: 70, wrap: true }, { header: 'Example test', width: 50, wrap: true }],
    clusters.map((c) => [c.id, c.group, c.screen, c.spec, c.outcome, c.tests.length, c.regressed || '', c.signature, c.tests[0].title]),
  );

  // Performance
  const p = wb.addWorksheet('Performance');
  title(p, 'API timings by operation (slowest p95 first)', 'Recorded by the GraphQL and REST adapters during this run.');
  table(p, 4, [{ header: 'Kind', width: 9 }, { header: 'Operation', width: 40 }, { header: 'Calls', width: 8 }, { header: 'Failures', width: 9 }, { header: 'p50 (ms)', width: 10 }, { header: 'p95 (ms)', width: 10 }, { header: 'Max (ms)', width: 10 }], summarisePerf(run.records.flatMap((x) => x.perf)).map((x) => [x.kind, x.name, x.calls, x.failures, x.p50, x.p95, x.max]), { freeze: true });

  // Drift
  const dr = wb.addWorksheet('Locator drift');
  title(dr, 'Locator drift suggestions (suggest, do not heal)', 'A failing test asked for a data-qa id that is not on the page; these are the closest ids present. Confirm before changing a page object.');
  table(dr, 4, [{ header: 'Test', width: 50, wrap: true }, { header: 'Wanted', width: 34 }, { header: 'Closest present', width: 34 }, { header: 'Distance', width: 9 }, { header: 'Page', width: 40 }], run.records.flatMap((x) => x.driftSuggestions.map((s) => [x.title, s.wanted, s.closest, s.distance, s.url ?? ''])));

  // Trend
  const tw = wb.addWorksheet('Trend');
  title(tw, 'Run history', 'One row per saved run (history/<env>/). Save a run with: npm run qip -- history add');
  table(tw, 4, [{ header: 'Run', width: 30 }, { header: 'Started', width: 18 }, { header: 'Label', width: 16 }, { header: 'Tests', width: 8 }, { header: 'Pass', width: 8 }, { header: 'Fail', width: 8 }, { header: 'Skip', width: 8 }, { header: 'Pass rate (executed)', width: 12 }],
    input.history.map((h) => {
      const o = Object.values(h.outcomes);
      const pass = o.filter((x) => x.startsWith('Pass') || x === 'Flaky').length;
      const fail = o.filter((x) => x.startsWith('Fail')).length;
      const skip = o.filter((x) => x.startsWith('Skip')).length;
      return [h.runId, h.startedAt.slice(0, 16).replace('T', ' '), h.label ?? '', o.length, pass, fail, skip, pct(pass, pass + fail)];
    }));

  // Read me
  const rm = wb.addWorksheet('Read Me');
  title(rm, 'How to read this report');
  const lines = [
    ['Pass', 'Passed.'],
    ['Pass – defect annotated', 'Passed while linked to a defect: evidence towards closing it.'],
    ['Fail – known defect', 'Failed on a defect already recorded. Expected until the fix lands.'],
    ['Fail – product question', 'Expected behaviour is unclear; a business owner must answer.'],
    ['Fail – unlinked', 'Failed with no defect reference: triage it (raise a defect, or fix the test).'],
    ['Fail – infrastructure', 'Gateway timeout, read-model lag, expired session, network: the environment failed, not the product.'],
    ['Fail – setup', 'A beforeAll/setup step failed, so the tests could not start.'],
    ['Flaky', 'Failed, then passed on retry. Never counts towards closing a defect.'],
    ['Skip – <category>', 'Every skip carries a categorised reason; an uncategorised skip fails the build check.'],
    ['Defect states', 'Closed (business verdict) · Active (has a ticket) · New (no ticket, recent) · Active – Unlinked (no ticket, older).'],
    ['Closure rule', 'Ready to close only after consecutive clean runs that exercised the defect with real data (rows checked > 0). Intermittent defects close on dev confirmation.'],
    ['Regression', 'Passed in the baseline run, fails now for a product reason.'],
  ];
  table(rm, 3, [{ header: 'Term', width: 28 }, { header: 'Meaning', width: 100, wrap: true }], lines);

  await wb.xlsx.writeFile(input.out);
  return { file: input.out, check };
}
