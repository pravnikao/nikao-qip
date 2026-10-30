import { test, expect } from '@playwright/test';
import { addBusinessDays, formatDate, isoDate, parseIso, previousQuarter, resolveDateToken, resolveTokens } from '../../core/data/dates';
import { DataSheetSchema, screenData } from '../../core/data/data-sheet';

const now = new Date(Date.UTC(2026, 9, 28)); // Wednesday 28 Oct 2026

test.describe('date tokens', () => {
  test('relative days, business days and named dates', () => {
    expect(resolveDateToken('today', now)).toBe('2026-10-28');
    expect(resolveDateToken('today-1d', now)).toBe('2026-10-27');
    expect(resolveDateToken('today+5d', now)).toBe('2026-11-02');
    expect(resolveDateToken('today-3bd', now)).toBe('2026-10-23'); // skips the weekend
    expect(resolveDateToken('previousBusinessDay', new Date(Date.UTC(2026, 9, 26)))).toBe('2026-10-23'); // Monday -> Friday
    expect(resolveDateToken('monthStart', now)).toBe('2026-10-01');
    expect(resolveDateToken('quarterStart', now)).toBe('2026-10-01');
    expect(resolveDateToken('quarterEnd', now)).toBe('2026-12-31');
    expect(resolveDateToken('currentQuarter', now)).toBe('2026Q4');
    expect(resolveDateToken('previousQuarter', now)).toBe('2026Q3');
    expect(previousQuarter(new Date(Date.UTC(2026, 1, 1)))).toBe('2025Q4');
  });

  test('holidays are not business days', () => {
    const h = new Set(['2026-10-27']);
    expect(isoDate(addBusinessDays(now, -1, h))).toBe('2026-10-26');
  });

  test('tokens inside strings and display formats', () => {
    expect(resolveTokens('from {{ today-2d }} to {{today}}', now)).toBe('from 2026-10-26 to 2026-10-28');
    expect(formatDate('2026-10-28')).toBe('28/10/2026');
    expect(formatDate('2026-10-28', 'MM/dd/yyyy')).toBe('10/28/2026');
    expect(isoDate(parseIso('2026-02-28'))).toBe('2026-02-28');
    expect(() => resolveDateToken('yesterdayish', now)).toThrow(/Unknown date token/);
  });
});

test.describe('data sheet', () => {
  const sheet = DataSheetSchema.parse({
    version: 1,
    holidays: [],
    environments: {
      test: {
        rawTrades: { anchor: { tradeDate: '{{previousBusinessDay}}', nested: { q: '{{currentQuarter}}' } }, status: 'data' },
        comments: { status: 'product-issue', blockedBy: 'BUG-API-069', notes: 'saving fails' },
      },
    },
  });

  test('resolves anchors deeply and builds a readable label', () => {
    const d = screenData<{ tradeDate: string; nested: { q: string } }>('rawTrades', { environment: 'test', now, sheet });
    expect(d.anchor.tradeDate).toBe('2026-10-27');
    expect(d.anchor.nested.q).toBe('2026Q4');
    expect(d.anchorLabel).toBe('tradeDate=2026-10-27, nested={"q":"2026Q4"}');
  });

  test('keeps the status and the blocking defect', () => {
    const d = screenData('comments', { environment: 'test', now, sheet });
    expect(d.status).toBe('product-issue');
    expect(d.blockedBy).toBe('BUG-API-069');
  });

  test('a missing screen or environment is a clear configuration error', () => {
    expect(() => screenData('nope', { environment: 'test', sheet })).toThrow(/no entry for screen "nope"/);
    expect(() => screenData('rawTrades', { environment: 'prod', sheet })).toThrow(/no environment "prod"/);
  });

  test('the checked-in client sheet is valid', () => {
    const raw = require('../../client-pack/data/data-sheet.json');
    expect(DataSheetSchema.safeParse(raw).success).toBe(true);
  });
});
