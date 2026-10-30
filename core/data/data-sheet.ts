import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { activeEnvironmentName } from '../config/client-config';
import { envOptional, QipConfigError } from '../config/env';
import { resolveTokens } from './dates';

/**
 * The environment data sheet: per environment, per screen, where the test data is
 * (its anchor: dates, ids, search text) and what state it is in. It is the
 * automation's copy of the business team's data matrix, kept in the repo.
 *
 *   status: data            - the anchor has data; tests run
 *           data-absent     - nothing loaded yet; row tests skip DATA-ABSENT
 *           product-issue   - data cannot exist because of a defect (set blockedBy)
 *           not-applicable  - the screen is not on this environment
 */

const AnchorValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(AnchorValue), z.record(z.string(), AnchorValue)]),
);

export const ScreenDataSchema = z.object({
  anchor: z.record(z.string(), AnchorValue).default({}),
  tenant: z.string().optional(),
  status: z.enum(['data', 'data-absent', 'product-issue', 'not-applicable']).default('data'),
  blockedBy: z.string().optional(),
  /** Free text: source of the anchor (e.g. "business matrix 29-Oct"), counts seen, caveats. */
  notes: z.string().optional(),
  /** Minimum rows a data-sensitive check needs (paging, sort): fewer = DATA-ABSENT for those checks. */
  minRows: z.number().int().optional(),
});

export const DataSheetSchema = z.object({
  version: z.literal(1),
  /** ISO dates that are not business days (bank holidays), per environment calendar. */
  holidays: z.array(z.string()).default([]),
  environments: z.record(z.string(), z.record(z.string(), ScreenDataSchema)),
});

export type ScreenData = z.infer<typeof ScreenDataSchema>;
export type DataSheet = z.infer<typeof DataSheetSchema>;

let cached: DataSheet | undefined;

export function dataSheetPath(): string {
  return envOptional('QIP_DATA_SHEET', path.resolve(process.cwd(), 'client-pack/data/data-sheet.json'))!;
}

export function loadDataSheet(file = dataSheetPath()): DataSheet {
  if (cached && file === dataSheetPath()) return cached;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const parsed = DataSheetSchema.safeParse(raw);
  if (!parsed.success) {
    throw new QipConfigError(
      `data sheet ${file} is invalid:\n` + parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n'),
    );
  }
  cached = parsed.data;
  return cached;
}

export function resetDataSheetCache(): void {
  cached = undefined;
}

function resolveDeep(v: unknown, now: Date | undefined, holidays: Set<string>): unknown {
  if (typeof v === 'string') return resolveTokens(v, now, holidays);
  if (Array.isArray(v)) return v.map((x) => resolveDeep(x, now, holidays));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveDeep(x, now, holidays)]));
  }
  return v;
}

export interface ResolvedScreenData<A = Record<string, unknown>> extends Omit<ScreenData, 'anchor'> {
  screen: string;
  environment: string;
  anchor: A;
  /** One-line anchor for skip reasons and reports: key=value pairs. */
  anchorLabel: string;
}

/** The resolved data entry for a screen on the active environment. */
export function screenData<A = Record<string, unknown>>(
  screen: string,
  opts: { environment?: string; now?: Date; sheet?: DataSheet } = {},
): ResolvedScreenData<A> {
  const sheet = opts.sheet ?? loadDataSheet();
  const environment = opts.environment ?? activeEnvironmentName();
  const envSheet = sheet.environments[environment];
  if (!envSheet) throw new QipConfigError(`data sheet has no environment "${environment}"`);
  const entry = envSheet[screen];
  if (!entry) throw new QipConfigError(`data sheet has no entry for screen "${screen}" on "${environment}"`);
  const holidays = new Set(sheet.holidays);
  const anchor = resolveDeep(entry.anchor, opts.now, holidays) as A;
  const anchorLabel = Object.entries(anchor as Record<string, unknown>)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(', ');
  return { ...entry, screen, environment, anchor, anchorLabel: anchorLabel || '(no anchor)' };
}
