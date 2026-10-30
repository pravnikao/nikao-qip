import { test, TestInfo } from '@playwright/test';
import type { PerfEntry } from '../report/types';

/**
 * Every API call records its timing. The report turns them into p50/p95 per
 * operation, and the Sentinel compares them with the previous run, so a slow
 * gateway shows up as a number before it shows up as timeouts.
 */
const perTest = new WeakMap<TestInfo, PerfEntry[]>();
const outsideTests: PerfEntry[] = [];

function currentTestInfo(): TestInfo | undefined {
  try {
    return test.info();
  } catch {
    return undefined;
  }
}

export function recordPerf(entry: PerfEntry): void {
  const info = currentTestInfo();
  if (!info) {
    outsideTests.push(entry);
    return;
  }
  if (!perTest.has(info)) perTest.set(info, []);
  perTest.get(info)!.push(entry);
}

/** Called by the fixtures after each test: attaches that test's timings for the reporter. */
export async function flushPerf(info: TestInfo): Promise<void> {
  const entries = perTest.get(info);
  if (!entries?.length) return;
  await info.attach('qip-perf', { body: JSON.stringify(entries), contentType: 'application/json' });
}

/** Timings recorded outside tests (probes, Sentinel). */
export function drainOutsideTests(): PerfEntry[] {
  return outsideTests.splice(0, outsideTests.length);
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

export interface PerfSummary {
  kind: string;
  name: string;
  calls: number;
  failures: number;
  p50: number;
  p95: number;
  max: number;
}

export function summarisePerf(entries: PerfEntry[]): PerfSummary[] {
  const groups = new Map<string, PerfEntry[]>();
  for (const e of entries) {
    const k = `${e.kind}|${e.name}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }
  return [...groups.entries()]
    .map(([k, es]) => {
      const [kind, name] = k.split('|');
      const ms = es.map((e) => e.ms);
      return { kind, name, calls: es.length, failures: es.filter((e) => !e.ok).length, p50: percentile(ms, 50), p95: percentile(ms, 95), max: Math.max(...ms) };
    })
    .sort((a, b) => b.p95 - a.p95);
}
