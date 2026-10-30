import * as fs from 'fs';
import * as path from 'path';
import type { MergedRun } from './load';

/**
 * Run history: a compact snapshot per run (outcome and rows checked per test key),
 * committed under history/<env>/. Closure needs consecutive clean runs, trends need
 * pass rates over time, regressions need a baseline run to compare with.
 */
export interface RunSnapshot {
  runId: string;
  environment: string;
  startedAt: string;
  label?: string;
  outcomes: Record<string, string>;
  rowsChecked: Record<string, number>;
  refs: Record<string, string[]>;
  screens: Record<string, string>;
  titles: Record<string, string>;
}

export function snapshotOf(run: MergedRun, label?: string): RunSnapshot {
  const s: RunSnapshot = { runId: run.runId, environment: run.environment, startedAt: run.startedAt, label, outcomes: {}, rowsChecked: {}, refs: {}, screens: {}, titles: {} };
  for (const r of run.records) {
    s.outcomes[r.key] = r.outcome;
    if (r.rowsChecked !== undefined) s.rowsChecked[r.key] = r.rowsChecked;
    if (r.refs.length) s.refs[r.key] = r.refs;
    s.screens[r.key] = r.screen;
    s.titles[r.key] = r.title;
  }
  return s;
}

function dirFor(env: string, root: string): string {
  return path.resolve(root, 'history', env);
}

export function saveSnapshot(s: RunSnapshot, root = process.cwd()): string {
  const dir = dirFor(s.environment, root);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${s.startedAt.slice(0, 19).replace(/[:T]/g, '-')}_${s.runId.replace(/[^\w-]/g, '_')}.json`);
  fs.writeFileSync(file, JSON.stringify(s));
  return file;
}

/** Snapshots for an environment, oldest first. */
export function loadSnapshots(env: string, root = process.cwd()): RunSnapshot[] {
  const dir = dirFor(env, root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as RunSnapshot)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** A run picked by id or label ("pre-migration"), or the latest run before a date. */
export function findBaseline(snaps: RunSnapshot[], ref: string): RunSnapshot | undefined {
  const byId = snaps.find((s) => s.runId === ref || s.label === ref);
  if (byId) return byId;
  if (/^\d{4}-\d{2}-\d{2}/.test(ref)) return [...snaps].reverse().find((s) => s.startedAt < ref);
  return undefined;
}
