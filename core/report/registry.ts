import * as fs from 'fs';
import * as path from 'path';

/**
 * The defect registry (client-pack/data/defects.ts) and the business team's verdicts
 * (client-pack/data/bau-verdicts.ts). The registry is the automation's record;
 * verdicts are decisions people made, and the framework never overrides them.
 */

export type DefectType = 'functional' | 'data' | 'environment' | 'performance' | 'accessibility' | 'security';

export interface DefectEntry {
  summary: string;
  screen: string;
  priority: 'High' | 'Medium' | 'Low';
  /** Tickets in the client's tracker (e.g. JIRA-123). Empty = not raised yet. */
  tickets: string[];
  type?: DefectType;
  /** ISO date first seen. */
  raised?: string;
  /** Does not reproduce every run: never closed by the clean-run rule alone. */
  intermittent?: boolean;
  /** The check needs a minimum amount of data (paging, sorting, counts) to prove a fix. */
  dataSensitive?: { minRows: number };
  notes?: string;
}

export type Verdict = 'Retest Pass' | 'Not a defect' | 'Duplicate' | 'Reopened' | 'Deferred';

export interface BauVerdict {
  verdict: Verdict;
  date: string;
  by?: string;
  note?: string;
  duplicateOf?: string;
}

export interface Registry {
  defects: Record<string, DefectEntry>;
  verdicts: Record<string, BauVerdict>;
}

function loadTs(file: string, exportName: string): any {
  if (!fs.existsSync(file)) return {};
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(file);
  return mod[exportName] ?? mod.default ?? {};
}

export function loadRegistry(root = process.cwd()): Registry {
  return {
    defects: loadTs(path.resolve(root, 'client-pack/data/defects.ts'), 'defects'),
    verdicts: loadTs(path.resolve(root, 'client-pack/data/bau-verdicts.ts'), 'bauVerdicts'),
  };
}
