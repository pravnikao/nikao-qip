import { isFail, OUTCOME } from '../classify/outcomes';
import type { TestRecord } from './types';
import type { RunSnapshot } from './history';

/**
 * Groups failures that carry no defect reference by spec and error signature,
 * so 27 tests failing one way read as one finding, not 27.
 */
export interface Cluster {
  id: string;
  screen: string;
  spec: string;
  outcome: string;
  signature: string;
  tests: TestRecord[];
  group: 'Environment' | 'Setup' | 'Regression' | 'Flaky' | 'Needs triage';
  regressed: number;
}

export function errorSignature(detail: string): string {
  const first = (detail.split('\n').find((l) => l.trim()) ?? '').trim();
  return first
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/"[^"]{0,80}"/g, '"…"')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<id>')
    .replace(/\b\d+(\.\d+)?\b/g, 'N')
    .slice(0, 160);
}

export function clusterUnlinked(records: TestRecord[], baseline?: RunSnapshot): Cluster[] {
  const pick = records.filter((r) => (isFail(r.outcome) && !r.refs.length && r.outcome !== OUTCOME.failQuestion) || r.outcome === OUTCOME.flaky);
  const map = new Map<string, Cluster>();
  for (const r of pick) {
    const sig = r.outcome === OUTCOME.flaky ? 'failed, then passed on retry' : errorSignature(r.detail);
    const k = `${r.screen}|${r.spec}|${r.outcome}|${sig}`;
    if (!map.has(k)) map.set(k, { id: '', screen: r.screen, spec: r.spec, outcome: r.outcome, signature: sig, tests: [], group: 'Needs triage', regressed: 0 });
    map.get(k)!.tests.push(r);
  }
  const clusters = [...map.values()].sort((a, b) => a.screen.localeCompare(b.screen) || b.tests.length - a.tests.length);
  clusters.forEach((c, i) => {
    c.id = `NEW-${String(i + 1).padStart(2, '0')}`;
    c.regressed = baseline ? c.tests.filter((t) => ['Pass', 'Pass – defect annotated'].includes(baseline.outcomes[t.key] ?? '')).length : 0;
    if (c.outcome === OUTCOME.failInfra) c.group = 'Environment';
    else if (c.outcome === OUTCOME.flaky) c.group = 'Flaky';
    else if (c.outcome === OUTCOME.failSetup) c.group = /GATEWAY-TIMEOUT|READ-MODEL-LAG|AUTH-EXPIRED/.test(c.signature) ? 'Environment' : 'Setup';
    else if (c.regressed * 2 >= c.tests.length && c.regressed > 0) c.group = 'Regression';
  });
  return clusters;
}
