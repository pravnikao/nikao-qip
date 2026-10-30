#!/usr/bin/env -S npx tsx
/**
 * qip — the Nikao QIP command line.
 *
 *   qip report [--baseline <runId|label|date>]   build the run workbook from reports/qip/results-*.json
 *   qip history add [--label <name>]             save this run's snapshot under history/<env>/
 *   qip history list
 *   qip bau-pack [--baseline <ref>]              build the business review pack
 *   qip probes                                   run every registered data probe against the data sheet
 *   qip sentinel [--update-baseline]             environment and change watch (exit 2 when RED)
 *   qip lock status|acquire|release [--as <name>] [--purpose <text>]
 *   qip drift                                    list locator drift suggestions from the last run
 *   qip leak-scan [--terms <file>]               fail if client-identifying terms appear in shared files
 *   qip demo                                     run the full loop against the bundled demo app
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { activeEnvironmentName, clientConfig } from '../core/config/client-config';
import { loadDotEnv } from '../core/config/env';
import { loadRun } from '../core/report/load';
import { loadRegistry } from '../core/report/registry';
import { findBaseline, loadSnapshots, saveSnapshot, snapshotOf } from '../core/report/history';
import { computeDefectRows } from '../core/report/defect-state';
import { buildRunWorkbook } from '../core/report/workbook';
import { buildBauPack } from '../core/report/bau-pack';
import { summarise } from '../core/report/summary';
import { registeredProbes, runProbe } from '../core/data/probes';
import { runSentinel, sentinelMarkdown } from '../core/sentinel/sentinel';
import { acquireLock, readLock, releaseLock } from '../core/run/session-lock';

loadDotEnv();
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const has = (name: string) => rest.includes(`--${name}`);
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

async function report(): Promise<number> {
  const run = loadRun();
  const cfg = clientConfig();
  const history = loadSnapshots(run.environment);
  const baselineRef = flag('baseline') ?? cfg.trendBaseline[run.environment];
  const baseline = baselineRef ? findBaseline(history, baselineRef) : undefined;
  const defects = computeDefectRows(run.records, loadRegistry(), history, { ...cfg.closure, baseline, currentRunId: run.runId });
  const out = path.resolve('reports', `QIP-Run-Report-${run.environment}-${stamp()}.xlsx`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const { check } = await buildRunWorkbook({ run, defects, history, baseline, clientName: cfg.displayName, trackerName: cfg.defectTracker.name, out });
  const s = summarise(run.records).total;
  console.log(`Report: ${out}`);
  console.log(`Tests ${s.total} · executed ${s.executed} · pass rate ${(s.passRate * 100).toFixed(1)}% (known defects expected: ${(s.passRateExpected * 100).toFixed(1)}%)`);
  console.log(`Defects: ${defects.filter((d) => d.state !== 'Closed').length} open · ${defects.filter((d) => d.closure.ready).length} ready to close`);
  for (const w of check.warnings) console.log(`Warning: ${w}`);
  if (!check.ok) {
    console.error(`BUILD CHECK FAILED: ${check.problems.join(' | ')}`);
    return 1;
  }
  return 0;
}

async function bauPack(): Promise<number> {
  const run = loadRun();
  const cfg = clientConfig();
  const history = loadSnapshots(run.environment);
  const baselineRef = flag('baseline') ?? cfg.trendBaseline[run.environment];
  const baseline = baselineRef ? findBaseline(history, baselineRef) : undefined;
  if (baselineRef && !baseline) console.warn(`Baseline "${baselineRef}" not found in history/${run.environment}; regressions will not be marked`);
  const registry = loadRegistry();
  const defects = computeDefectRows(run.records, registry, history, { ...cfg.closure, baseline, currentRunId: run.runId });
  const out = path.resolve('reports', `QIP-BAU-Review-${run.environment}-${stamp()}.xlsx`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await buildBauPack({ run, defects, registry, baseline, clientName: cfg.displayName, trackerName: cfg.defectTracker.name, out });
  console.log(`BAU pack: ${out}`);
  return 0;
}

async function history(): Promise<number> {
  const sub = rest[0];
  if (sub === 'add') {
    const file = saveSnapshot(snapshotOf(loadRun(), flag('label')));
    console.log(`Saved ${file}`);
    return 0;
  }
  const snaps = loadSnapshots(activeEnvironmentName());
  for (const s of snaps) console.log(`${s.startedAt.slice(0, 16)}  ${s.runId}  ${s.label ?? ''}  ${Object.keys(s.outcomes).length} tests`);
  return 0;
}

async function probes(): Promise<number> {
  const file = path.resolve('client-pack/data/probes.ts');
  if (fs.existsSync(file)) require(file);
  let errors = 0;
  const rows: string[] = [];
  for (const p of registeredProbes()) {
    try {
      const r = await runProbe(p);
      rows.push(`${r.sheetStale ? '!' : ' '} ${r.screen.padEnd(28)} ${String(r.rows).padStart(6)}  ${r.sheetStatus.padEnd(15)} ${r.anchor}`);
    } catch (e) {
      errors++;
      rows.push(`E ${p.screen.padEnd(28)} ${'ERROR'.padStart(6)}  ${(e as Error).message.split('\n')[0]}`);
    }
  }
  console.log(`Probes on ${activeEnvironmentName()} (! = sheet disagrees with the data, E = API error)\n`);
  console.log(rows.join('\n'));
  return errors ? 1 : 0;
}

async function sentinel(): Promise<number> {
  const file = path.resolve('client-pack/sentinel.config.ts');
  const checks = fs.existsSync(file) ? require(file).sentinelChecks ?? {} : {};
  const r = await runSentinel(checks, { updateBaseline: has('update-baseline') });
  fs.mkdirSync('reports/qip', { recursive: true });
  fs.writeFileSync(`reports/qip/sentinel-${r.environment}.json`, JSON.stringify(r, null, 2));
  const md = sentinelMarkdown(r);
  fs.writeFileSync(`reports/qip/sentinel-${r.environment}.md`, md);
  console.log(md);
  return r.verdict === 'RED' ? 2 : 0;
}

async function lock(): Promise<number> {
  const sub = rest[0] ?? 'status';
  const holder = flag('as') ?? process.env.QIP_INSTANCE ?? 'local';
  if (sub === 'status') {
    const l = readLock();
    console.log(l ? JSON.stringify(l, null, 2) : 'No lock held');
    return 0;
  }
  if (sub === 'acquire') {
    acquireLock(holder, flag('purpose') ?? 'manual');
    console.log(`Lock held by ${holder}`);
    return 0;
  }
  if (sub === 'release') {
    if (!releaseLock(holder)) {
      console.error(`Refused: the lock is held by "${readLock()?.holder}", not "${holder}". Leave it.`);
      return 1;
    }
    console.log('Released');
    return 0;
  }
  return 1;
}

async function drift(): Promise<number> {
  const run = loadRun();
  const items = run.records.flatMap((r) => r.driftSuggestions.map((s) => ({ test: `${r.spec} › ${r.title}`, ...s })));
  if (!items.length) console.log('No locator drift suggestions in the last run.');
  for (const i of items) console.log(`${i.test}\n   wanted ${i.wanted}  →  closest present: ${i.closest} (distance ${i.distance})`);
  return 0;
}

/** Shared material must not name a client. Terms come from a private file kept out of git. */
async function leakScan(): Promise<number> {
  const termsFile = flag('terms') ?? '.qip-leak-terms';
  if (!fs.existsSync(termsFile)) {
    console.error(`No terms file ${termsFile}. Put one forbidden term per line (client names, ids, hostnames). Keep it out of git.`);
    return 1;
  }
  const terms = fs.readFileSync(termsFile, 'utf8').split(/\r?\n/).map((t) => t.trim()).filter((t) => t && !t.startsWith('#'));
  const skip = new Set(['node_modules', '.git', 'reports', 'test-results', 'playwright-report', '.auth', 'package-lock.json']);
  const patterns = terms.map((t) => ({ t, re: new RegExp(`(^|[^A-Za-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9])`, 'i') }));
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name) || e.name === path.basename(termsFile)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (fs.statSync(p).size < 2_000_000) {
        const text = fs.readFileSync(p, 'utf8');
        for (const { t, re } of patterns) if (re.test(text)) hits.push(`${p}: "${t}"`);
      }
    }
  };
  walk('.');
  if (hits.length) {
    console.error(`Leak scan FAILED (${hits.length}):\n` + hits.join('\n'));
    return 1;
  }
  console.log(`Leak scan clean: ${terms.length} terms, no matches.`);
  return 0;
}

/**
 * The full loop against the bundled demo app:
 *   1. a clean "pre-migration" run, saved as the baseline
 *   2. the same suite after "migration" (planted defects on)
 *   3. the run report and the BAU pack, with regressions marked against the baseline
 */
async function demo(): Promise<number> {
  const envBase = { ...process.env, QIP_ENV: 'demo', QIP_INSTANCE: process.env.QIP_INSTANCE ?? 'demo' };
  // Run the CLIs through this Node binary directly: no npx, no shell, same on Windows, macOS and Linux.
  const run = (label: string, args: string[], extra: Record<string, string> = {}) => {
    const r = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...envBase, ...extra } });
    if (r.error) {
      console.error(`[demo] could not start ${label}: ${r.error.message}`);
      process.exit(1);
    }
    return r.status ?? 1;
  };
  const playwrightCli = require.resolve('@playwright/test/cli');
  const tsxCli = require.resolve('tsx/cli');
  const pw = (extra: Record<string, string>) => run('playwright', [playwrightCli, 'test', '--project=api', '--project=ui', '--project=e2e'], extra);
  const qip = (args: string[]) => {
    const status = run(`qip ${args[0]}`, [tsxCli, 'bin/qip.ts', ...args]);
    if (status !== 0) console.error(`[demo] qip ${args.join(' ')} exited with ${status}`);
  };

  console.log('\n=== 1/3 Baseline run: the platform before migration (no planted defects) ===\n');
  pw({ DEMO_DEFECTS: 'off' });
  qip(['history', 'add', '--label', 'pre-migration']);
  console.log('\n=== 2/3 After migration: the same suite (planted defects on) ===\n');
  pw({ DEMO_DEFECTS: 'on' });
  qip(['history', 'add', '--label', 'post-migration']);
  console.log('\n=== 3/3 Reports ===\n');
  qip(['report', '--baseline', 'pre-migration']);
  qip(['bau-pack', '--baseline', 'pre-migration']);
  return 0;
}

const commands: Record<string, () => Promise<number>> = { report, history, 'bau-pack': bauPack, probes, sentinel, lock, drift, 'leak-scan': leakScan, demo };

(async () => {
  const fn = commands[cmd ?? ''];
  if (!fn) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace('#!/usr/bin/env -S npx tsx\n/**', '').replace(/^ \* ?/gm, ''));
    process.exit(cmd ? 1 : 0);
  }
  try {
    process.exit(await fn());
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
})();
