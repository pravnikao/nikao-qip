import ExcelJS from 'exceljs';
import { clusterUnlinked } from './clusters';
import type { DefectRow } from './defect-state';
import { COLORS, dropdown, fillCell, table, title } from './excel';
import type { MergedRun } from './load';
import type { RunSnapshot } from './history';
import type { Registry } from './registry';

/**
 * The business review pack: what to close, what to raise, what regressed, by screen.
 * Every sheet has a decision drop-down so the pack comes back marked up, and the
 * decisions go into bau-verdicts.ts (people decide; the framework records).
 */

export const GROUPS = [
  'Mapped (ticket raised)',
  'New defect – regression vs baseline',
  'New defect – data issue',
  'New defect – functional',
  'New defect – flaky / environment',
  'Needs triage (no defect yet)',
  'Closed',
] as const;
type Group = (typeof GROUPS)[number];

const GROUP_FILL: Record<Group, string> = {
  'Mapped (ticket raised)': COLORS.info,
  'New defect – regression vs baseline': COLORS.fail,
  'New defect – data issue': COLORS.warn,
  'New defect – functional': 'FFF9ECE7',
  'New defect – flaky / environment': COLORS.infra,
  'Needs triage (no defect yet)': 'FFE5F4E4',
  Closed: COLORS.skip,
};

function defectGroup(d: DefectRow): Group {
  if (d.state === 'Closed') return 'Closed';
  if (d.tickets.length) return 'Mapped (ticket raised)';
  if (d.regressedTests > 0) return 'New defect – regression vs baseline';
  if (d.type === 'data') return 'New defect – data issue';
  if (d.type === 'environment' || d.type === 'performance' || d.intermittent) return 'New defect – flaky / environment';
  return 'New defect – functional';
}

export async function buildBauPack(input: {
  run: MergedRun;
  defects: DefectRow[];
  registry: Registry;
  baseline?: RunSnapshot;
  clientName: string;
  trackerName: string;
  out: string;
}): Promise<string> {
  const { run, defects, registry } = input;
  const wb = new ExcelJS.Workbook();
  const base = input.baseline ? `${input.baseline.label ?? input.baseline.runId} (${input.baseline.startedAt.slice(0, 10)})` : 'none';
  const sub = `Run ${run.runId} on ${run.environment}, ${run.startedAt.slice(0, 10)}. Regression baseline: ${base}.`;
  const clusters = clusterUnlinked(run.records, input.baseline);

  type Item = { screen: string; group: Group; ref: string; tickets: string; state: string; priority: string; summary: string; tests: number; now: string; regressed: number | string; note: string };
  const items: Item[] = defects.map((d) => ({
    screen: d.screen || '(no linked test)',
    group: defectGroup(d),
    ref: d.ref,
    tickets: d.tickets.join(', '),
    state: d.state,
    priority: d.priority,
    summary: d.summary,
    tests: d.testsLinked,
    now: `${d.passingNow} pass / ${d.failingNow} fail / ${d.skippedNow} skip`,
    regressed: d.regressedTests || '',
    note: [d.check, d.closure.ready ? 'Ready to close' : ''].filter(Boolean).join('; '),
  }));
  for (const c of clusters) {
    const group: Group = c.group === 'Regression' ? 'New defect – regression vs baseline' : c.group === 'Environment' || c.group === 'Flaky' ? 'New defect – flaky / environment' : 'Needs triage (no defect yet)';
    items.push({ screen: c.screen, group, ref: c.id, tickets: '', state: 'No defect yet', priority: '', summary: `${c.spec}: ${c.signature}`, tests: c.tests.length, now: `${c.tests.length} ${c.outcome}`, regressed: c.regressed || '', note: c.group });
  }
  items.sort((a, b) => a.screen.localeCompare(b.screen) || GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.ref.localeCompare(b.ref));

  // Summary pivot
  const sm = wb.addWorksheet('Summary');
  title(sm, `${input.clientName}: defect review for the business team`, sub);
  const screens = [...new Set(items.map((i) => i.screen))].sort();
  const totals = GROUPS.map((g) => items.filter((i) => i.group === g).length);
  let row = table(
    sm,
    4,
    [{ header: 'Screen', width: 36 }, ...GROUPS.map((g) => ({ header: g, width: 15, wrap: true })), { header: 'Total', width: 8 }, { header: 'Tests linked', width: 9 }],
    [
      ...screens.map((s) => {
        const rs = items.filter((i) => i.screen === s);
        return [s, ...GROUPS.map((g) => rs.filter((i) => i.group === g).length || ''), rs.length, rs.reduce((a, i) => a + i.tests, 0)];
      }),
      ['Total', ...totals, items.length, items.reduce((a, i) => a + i.tests, 0)],
    ],
    { freeze: true },
  );
  sm.getRow(4).height = 48;
  sm.getRow(4 + screens.length + 1).font = { name: 'Arial', bold: true };
  for (const t of [
    'Mapped = a ticket exists in ' + input.trackerName + '. New defect = no ticket yet, split by type. NEW-xx rows are failures with no defect reference yet.',
    'Regression = at least one linked test passed in the baseline run and fails now for a product reason (environment failures excluded).',
    'Closure needs consecutive clean runs with real data; intermittent defects close on dev confirmation.',
  ]) {
    sm.getCell(`A${row++}`).value = t;
  }

  // Closure list
  const ready = defects.filter((d) => d.state !== 'Closed' && d.failingNow === 0 && d.passingNow > 0);
  const cl = wb.addWorksheet('Closure list');
  title(cl, `Closure list: ${ready.filter((d) => d.closure.ready).length} ready, ${ready.filter((d) => !d.closure.ready).length} passing but not yet provable`, sub);
  table(
    cl,
    4,
    [{ header: 'Defect', width: 13 }, { header: 'Ticket(s)', width: 16 }, { header: 'Screen', width: 26 }, { header: 'Summary', width: 55, wrap: true }, { header: 'Recommendation', width: 22 }, { header: 'Why', width: 45, wrap: true }, { header: 'BAU decision', width: 14 }, { header: 'BAU comment', width: 30, wrap: true }],
    ready
      .sort((a, b) => Number(b.closure.ready) - Number(a.closure.ready) || a.ref.localeCompare(b.ref))
      .map((d) => [d.ref, d.tickets.join(', '), d.screen, d.summary, d.closure.ready ? 'Close' : d.intermittent ? 'Hold: intermittent' : 'Hold: one more clean run', d.closure.reason, '', '']),
    { freeze: true, filter: true },
  );
  ready.forEach((d, i) => fillCell(cl, 5 + i, 5, d.closure.ready ? COLORS.pass : COLORS.warn));
  dropdown(cl, 7, 5, 4 + ready.length, ['Close', 'Hold', 'Reopen', 'Not a defect']);

  // Defects by screen
  const ds = wb.addWorksheet('Defects by screen');
  title(ds, 'Every defect and new failure group, by screen', sub);
  table(
    ds,
    4,
    [{ header: 'Screen', width: 26, wrap: true }, { header: 'Group', width: 24 }, { header: 'Defect / group', width: 13 }, { header: 'Ticket(s)', width: 16 }, { header: 'State', width: 16 }, { header: 'Priority', width: 9 }, { header: 'Summary', width: 55, wrap: true }, { header: 'Tests linked', width: 8 }, { header: 'Now', width: 24 }, { header: 'Regressed tests', width: 9 }, { header: 'Note', width: 30, wrap: true }, { header: 'BAU decision', width: 15 }, { header: 'BAU comment', width: 30, wrap: true }],
    items.map((i) => [i.screen, i.group, i.ref, i.tickets, i.state, i.priority, i.summary, i.tests, i.now, i.regressed, i.note, '', '']),
    { freeze: true, filter: true },
  );
  items.forEach((i, n) => fillCell(ds, 5 + n, 2, GROUP_FILL[i.group]));
  dropdown(ds, 12, 5, 4 + items.length, ['Agree', 'Raise ticket', 'Not a defect', 'Duplicate', 'Close', 'Reopen', 'Test to fix']);

  // To raise
  const toRaise = defects.filter((d) => d.state !== 'Closed' && !d.tickets.length && d.failingNow > 0);
  const tr = wb.addWorksheet('To raise');
  title(tr, `${toRaise.length} defects with no ticket that still fail`, 'Raise each in the tracker and send back the number; the automation links it.');
  table(
    tr,
    4,
    [{ header: 'Defect', width: 13 }, { header: 'Screen', width: 26 }, { header: 'Priority', width: 9 }, { header: 'Summary', width: 70, wrap: true }, { header: 'Evidence', width: 50, wrap: true }, { header: `${input.trackerName} ticket`, width: 16 }],
    toRaise.map((d) => {
      const ev = run.records.find((r) => r.refs.includes(d.ref) && r.outcome.startsWith('Fail'));
      return [d.ref, d.screen, d.priority, d.summary || registry.defects[d.ref]?.summary || '', ev ? `${ev.spec} › ${ev.title}\n${ev.detail.split('\n')[0]}` : '', ''];
    }),
  );

  // Product questions
  const qs = run.records.filter((r) => r.outcome === 'Fail – product question');
  const q = wb.addWorksheet('Questions');
  title(q, `${qs.length} product question(s) for the business`, 'The test keeps its assertion until someone answers; the answer decides: defect, or test update.');
  table(q, 4, [{ header: 'Screen', width: 26 }, { header: 'Test', width: 50, wrap: true }, { header: 'Question', width: 70, wrap: true }, { header: 'What the screen does now', width: 50, wrap: true }, { header: 'Answer', width: 30, wrap: true }], qs.map((r) => [r.screen, r.title, r.question ?? '', r.detail.split('\n')[0], '']));

  await wb.xlsx.writeFile(input.out);
  return input.out;
}
