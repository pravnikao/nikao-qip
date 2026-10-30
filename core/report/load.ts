import * as fs from 'fs';
import * as path from 'path';
import type { RunFile, TestRecord } from './types';

export interface MergedRun {
  runId: string;
  environment: string;
  branch?: string;
  startedAt: string;
  projects: { project: string; startedAt: string; finishedAt: string; workers: number; count: number }[];
  records: TestRecord[];
}

/** Merges reports/qip/results-*.json (one per project) into one run. */
export function loadRun(dir = 'reports/qip'): MergedRun {
  if (!fs.existsSync(dir)) throw new Error(`No results in ${dir}. Run the tests first.`);
  const files = fs.readdirSync(dir).filter((f) => /^results-.+\.json$/.test(f));
  if (!files.length) throw new Error(`No results-*.json in ${dir}. Run the tests first.`);
  const runs: RunFile[] = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  runs.sort((a, b) => a.project.localeCompare(b.project));
  return {
    runId: runs[0].runId,
    environment: runs[0].environment,
    branch: runs[0].branch,
    startedAt: runs.map((r) => r.startedAt).sort()[0],
    projects: runs.map((r) => ({ project: r.project, startedAt: r.startedAt, finishedAt: r.finishedAt, workers: r.workers, count: r.records.length })),
    records: runs.flatMap((r) => r.records),
  };
}
