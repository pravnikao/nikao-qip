/**
 * Date tokens for the data sheet. Data anchors move with time ("yesterday's
 * trade date", "the current quarter"), so the sheet stores tokens, not dates.
 *
 * Supported inside {{ }}:
 *   today | today+3d | today-2d | today-1bd (business days) | previousBusinessDay
 *   monthStart | monthEnd | quarterStart | quarterEnd
 *   currentQuarter | previousQuarter   (format 2026Q4)
 */

export function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseIso(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

export function isBusinessDay(d: Date, holidays: Set<string> = new Set()): boolean {
  const wd = d.getUTCDay();
  return wd !== 0 && wd !== 6 && !holidays.has(isoDate(d));
}

export function addBusinessDays(d: Date, n: number, holidays?: Set<string>): Date {
  let r = new Date(d);
  const step = n < 0 ? -1 : 1;
  let left = Math.abs(n);
  while (left > 0) {
    r = addDays(r, step);
    if (isBusinessDay(r, holidays)) left--;
  }
  return r;
}

export function quarterOf(d: Date): { year: number; q: number } {
  return { year: d.getUTCFullYear(), q: Math.floor(d.getUTCMonth() / 3) + 1 };
}

export function quarterLabel(year: number, q: number): string {
  return `${year}Q${q}`;
}

export function previousQuarter(d: Date): string {
  const { year, q } = quarterOf(d);
  return q === 1 ? quarterLabel(year - 1, 4) : quarterLabel(year, q - 1);
}

export function resolveDateToken(token: string, now: Date = new Date(), holidays?: Set<string>): string {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const t = token.trim();
  const rel = t.match(/^today(?:([+-])(\d+)(bd|d))?$/);
  if (rel) {
    if (!rel[1]) return isoDate(today);
    const n = Number(rel[2]) * (rel[1] === '-' ? -1 : 1);
    return isoDate(rel[3] === 'bd' ? addBusinessDays(today, n, holidays) : addDays(today, n));
  }
  const { year, q } = quarterOf(today);
  switch (t) {
    case 'previousBusinessDay':
      return isoDate(addBusinessDays(today, -1, holidays));
    case 'monthStart':
      return isoDate(new Date(Date.UTC(year, today.getUTCMonth(), 1)));
    case 'monthEnd':
      return isoDate(new Date(Date.UTC(year, today.getUTCMonth() + 1, 0)));
    case 'quarterStart':
      return isoDate(new Date(Date.UTC(year, (q - 1) * 3, 1)));
    case 'quarterEnd':
      return isoDate(new Date(Date.UTC(year, q * 3, 0)));
    case 'currentQuarter':
      return quarterLabel(year, q);
    case 'previousQuarter':
      return previousQuarter(today);
    default:
      throw new Error(`Unknown date token {{${t}}}`);
  }
}

/** Replaces every {{token}} in a string. */
export function resolveTokens(s: string, now?: Date, holidays?: Set<string>): string {
  return s.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, tok) => resolveDateToken(tok, now, holidays));
}

/** ISO yyyy-mm-dd to a display format: dd/MM/yyyy, MM/dd/yyyy or yyyy-MM-dd. */
export function formatDate(iso: string, format: 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd' = 'dd/MM/yyyy'): string {
  const [y, m, d] = iso.split('-');
  if (format === 'dd/MM/yyyy') return `${d}/${m}/${y}`;
  if (format === 'MM/dd/yyyy') return `${m}/${d}/${y}`;
  return iso;
}
