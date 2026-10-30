import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';
import { clientConfig, activeEnvironmentName } from '../config/client-config';
import { envOptional } from '../config/env';
import { ANNOTATION } from '../defects/annotations';
import { Annotation, bugPriority, buildCascadeReason, classify, defectRefs, rowsCheckedOf } from '../classify/classify';
import { resolveScreen } from './screen-resolver';
import { stableKey } from './stable-key';
import type { DriftSuggestion, PerfEntry, RunFile, TestRecord } from '../report/types';

export interface QipReporterOptions {
  outputDir?: string;
  /** Projects that are not product tests (e.g. unit) and are left out of results. */
  ignoreProjects?: string[];
  /** Map project name -> layer label. Defaults to the project name. */
  layers?: Record<string, string>;
}

interface Collected {
  test: TestCase;
  result: TestResult;
  attempts: number;
  passedOnRetry: boolean;
}

/**
 * Writes reports/qip/results-<project>.json: one classified record per test.
 * Everything downstream (workbook, BAU pack, closure, trends) reads these files.
 */
export default class QipReporter implements Reporter {
  private opts: Required<QipReporterOptions>;
  private collected = new Map<string, Collected>();
  private root?: Suite;
  private startedAt = new Date();
  private workers = 1;

  constructor(options: QipReporterOptions = {}) {
    this.opts = {
      outputDir: options.outputDir ?? 'reports/qip',
      ignoreProjects: options.ignoreProjects ?? ['unit'],
      layers: options.layers ?? {},
    };
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.root = suite;
    this.workers = config.workers;
    this.startedAt = new Date();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const prev = this.collected.get(test.id);
    const failedBefore = !!prev && prev.result.status !== 'passed' && prev.result.status !== 'skipped';
    this.collected.set(test.id, {
      test,
      result,
      attempts: (prev?.attempts ?? 0) + 1,
      passedOnRetry: (prev?.passedOnRetry ?? false) || (failedBefore && result.status === 'passed'),
    });
  }

  onEnd(_result: FullResult): void {
    if (!this.root) return;
    const renames = loadRenames();
    let screens = {};
    try {
      screens = clientConfig().screens;
    } catch {
      /* unit runs without a client pack */
    }
    const env = safe(() => activeEnvironmentName(), 'unknown');
    const runId = envOptional('GITHUB_RUN_ID') ?? `local-${this.startedAt.toISOString().replace(/[:.]/g, '-')}`;
    const byProject = new Map<string, TestRecord[]>();

    for (const test of this.root.allTests()) {
      const projectName = test.parent.project()?.name ?? 'default';
      if (this.opts.ignoreProjects.includes(projectName)) continue;
      const c = this.collected.get(test.id);
      const annotations: Annotation[] = [
        ...test.annotations,
        ...((c?.result as TestResult & { annotations?: Annotation[] })?.annotations ?? []),
      ].filter((a, i, all) => all.findIndex((b) => b.type === a.type && b.description === a.description) === i);

      const describePath = describeTitles(test);
      const metaRaw = annotations.find((a) => a.type === ANNOTATION.meta)?.description;
      const meta = metaRaw ? safe(() => JSON.parse(metaRaw), {}) : {};
      const layer = this.opts.layers[projectName] ?? projectName;
      const specFile = path.relative(process.cwd(), test.location.file);
      const skipReason = annotations.find((a) => a.type === 'skip' || a.type === 'fixme')?.description;
      const cascadeCause = !skipReason && c?.result.status === 'skipped' ? this.cascadeCause(test) : undefined;
      const error = c ? firstError(c.result) : '';

      const outcome = classify({
        status: (c?.result.status ?? 'skipped') as never,
        passedOnRetry: c?.passedOnRetry,
        annotations,
        error,
        skipReason,
        cascadeCause,
        didNotRun: !c,
      });

      const record: TestRecord = {
        key: stableKey({ layer, specFile, describePath, title: test.title, renames }),
        project: projectName,
        layer,
        screen: resolveScreen(screens, { metaScreen: meta.screen, describePath, specFile }),
        spec: path.basename(specFile),
        fr: toArray(meta.fr ?? test.title.match(/\bFR-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g) ?? []),
        title: test.title,
        describe: describePath.join(' › '),
        status: c?.result.status ?? 'did-not-run',
        outcome,
        refs: defectRefs(annotations),
        priority: bugPriority(annotations),
        detail: c?.result.status === 'skipped' ? skipReason ?? (cascadeCause ? buildCascadeReason(cascadeCause) : '') : error,
        durationMs: c?.result.duration ?? 0,
        attempts: c?.attempts ?? 0,
        tags: test.tags ?? [],
        rowsChecked: rowsCheckedOf(annotations),
        question: questionOf(annotations),
        what: meta.what,
        how: meta.how,
        expected: meta.expected,
        perf: attachmentJson<PerfEntry>(c?.result, 'qip-perf'),
        driftSuggestions: attachmentJson<DriftSuggestion>(c?.result, 'qip-drift'),
      };
      if (!byProject.has(projectName)) byProject.set(projectName, []);
      byProject.get(projectName)!.push(record);
    }

    fs.mkdirSync(this.opts.outputDir, { recursive: true });
    for (const [project, records] of byProject) {
      const file: RunFile = {
        schemaVersion: 1,
        runId,
        project,
        environment: env,
        branch: envOptional('GITHUB_REF_NAME'),
        startedAt: this.startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        workers: this.workers,
        records,
      };
      fs.writeFileSync(path.join(this.opts.outputDir, `results-${project}.json`), JSON.stringify(file, null, 2));
    }
  }

  /** The earlier sibling (same describe) that failed, if any: its failure caused this skip. */
  private cascadeCause(test: TestCase): string | undefined {
    const siblings = test.parent.tests;
    const idx = siblings.indexOf(test);
    for (let i = idx - 1; i >= 0; i--) {
      const s = this.collected.get(siblings[i].id);
      if (s && (s.result.status === 'failed' || s.result.status === 'timedOut')) return siblings[i].title;
    }
    return undefined;
  }
}

function describeTitles(test: TestCase): string[] {
  const out: string[] = [];
  let s: Suite | undefined = test.parent;
  while (s && s.type === 'describe') {
    out.unshift(s.title);
    s = s.parent;
  }
  return out;
}

function firstError(result: TestResult): string {
  const e = result.errors?.[0] ?? result.error;
  if (!e) return '';
  // eslint-disable-next-line no-control-regex
  return (e.message ?? e.value ?? '').replace(/\u001b\[[0-9;]*m/g, '').slice(0, 2000);
}

function attachmentJson<T>(result: TestResult | undefined, name: string): T[] {
  if (!result) return [];
  const out: T[] = [];
  for (const a of result.attachments) {
    if (a.name !== name || !a.body) continue;
    const v = safe(() => JSON.parse(a.body!.toString('utf8')), null);
    if (Array.isArray(v)) out.push(...v);
    else if (v) out.push(v);
  }
  return out;
}

function loadRenames(): Record<string, string> {
  const file = path.resolve(process.cwd(), 'client-pack/data/title-renames.ts');
  if (!fs.existsSync(file)) return {};
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(file);
  return mod.titleRenames ?? mod.default ?? {};
}

function questionOf(annotations: Annotation[]): string | undefined {
  const a = annotations.find((x) => x.type === ANNOTATION.productQuestion)?.description;
  return a ? safe(() => JSON.parse(a).question as string, a) : undefined;
}

function toArray(v: string | string[]): string[] {
  return Array.isArray(v) ? v : [v];
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
