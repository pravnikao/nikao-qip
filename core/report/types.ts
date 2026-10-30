/** The per-test record the reporter writes and every report builder reads. Keep it backward compatible. */
export interface TestRecord {
  /** Stable across renames (see core/reporter/stable-key.ts). */
  key: string;
  project: string;
  layer: string;
  screen: string;
  spec: string;
  fr: string[];
  title: string;
  describe: string;
  status: string;
  outcome: string;
  refs: string[];
  priority?: string;
  detail: string;
  durationMs: number;
  attempts: number;
  tags: string[];
  rowsChecked?: number;
  /** Product question text, when the test carries one. */
  question?: string;
  what?: string;
  how?: string;
  expected?: string;
  perf: PerfEntry[];
  driftSuggestions: DriftSuggestion[];
}

export interface PerfEntry {
  kind: 'graphql' | 'rest' | 'ui';
  name: string;
  ms: number;
  status?: number;
  ok: boolean;
}

export interface DriftSuggestion {
  wanted: string;
  closest: string;
  distance: number;
  url?: string;
}

export interface RunFile {
  schemaVersion: 1;
  runId: string;
  project: string;
  environment: string;
  branch?: string;
  startedAt: string;
  finishedAt: string;
  workers: number;
  records: TestRecord[];
}
