import { test, expect } from '../../../core/fixtures';
import { bug, meta, productQuestion, rowsChecked } from '../../../core/defects/annotations';
import { captureRest } from '../../../core/ui/network';
import { requireRows } from '../../../core/data/probes';
import { positionsProbe } from '../../data/probes';
import { PositionsPage } from '../../pages/PositionsPage';

test.describe('Positions', () => {
  test('FR-PS-01: Search fills the grid with the API rows, field by field', async ({ page, rest }) => {
    meta({ screen: 'positions', fr: 'FR-PS-01', what: 'Screen rows equal the API rows for the default search.' });
    await requireRows(positionsProbe);
    const ps = await new PositionsPage(page).open();
    await ps.grid.settle();
    const api = await rest.get<{ items: { id: number; isin: string; issuer: string; quantity: number; marketValue: number; tradeDate: string }[] }>('/positions', { query: { page: 1, size: 20, sort: 'issuer' }, tenant: 'alpha' });
    await ps.grid.expectMatchesApi(
      api.data.items,
      [
        { column: 'isin', value: (r) => r.isin },
        { column: 'issuer', value: (r) => r.issuer },
        { column: 'quantity', value: (r) => String(r.quantity) },
        { column: 'tradeDate', value: (r) => r.tradeDate },
      ],
      (r) => String(r.id),
    );
  });

  test('FR-PS-02: Rows per page 10 asks for 10 rows and shows at most 10', async ({ page }) => {
    meta({ screen: 'positions', fr: 'FR-PS-02', what: 'Page size control: request and render agree.' });
    await requireRows(positionsProbe);
    const ps = await new PositionsPage(page).open();
    await ps.grid.settle();
    const call = await captureRest(page, 'GET', /\/api\/v1\/positions$/, () => ps.grid.setPageSize(10));
    await ps.grid.settle();
    expect(call.query.size, 'size sent by the screen').toBe('10');
    const rows = await ps.grid.rowCount();
    rowsChecked(rows);
    expect(rows).toBeLessThanOrEqual(10);
  });

  test('FR-PS-03: Export CSV is offered on the results', async ({ page }) => {
    meta({ screen: 'positions', fr: 'FR-PS-03' });
    const ps = await new PositionsPage(page).open();
    await expect(ps.exportButton).toBeVisible({ timeout: 5_000 });
  });

  test('FR-PS-04: a search that matches nothing shows the empty-state message', async ({ page }) => {
    meta({ screen: 'positions', fr: 'FR-PS-04' });
    bug('BUG-UI-004', { priority: 'Low', summary: 'no empty-state message' });
    const ps = await new PositionsPage(page).open();
    await ps.search('zz-no-such-issuer');
    expect(await ps.grid.settle()).toBe('empty');
    await expect(ps.emptyState).toHaveText('No positions match your search.');
  });

  test('FR-PS-05: sorting by issuer orders the whole result set, across pages', async ({ page }) => {
    meta({ screen: 'positions', fr: 'FR-PS-05', what: 'Server-side sort: the last row of page 1 sorts before the first row of page 2.' });
    bug('BUG-UI-005', { priority: 'Medium', summary: 'sort applies to the current page only' });
    await requireRows(positionsProbe, { min: 21 });
    const ps = await new PositionsPage(page).open();
    await ps.grid.settle();
    const page1 = await ps.grid.columnValues('issuer');
    await ps.grid.nextPage();
    await expect(ps.pageSummary).toContainText('Page 2');
    await ps.grid.settle();
    const page2 = await ps.grid.columnValues('issuer');
    rowsChecked(page1.length + page2.length);
    expect(page1[page1.length - 1].localeCompare(page2[0])).toBeLessThanOrEqual(0);
  });

  test('FR-PS-06: Status shows a readable label, not the system code', async ({ page }) => {
    meta({ screen: 'positions', fr: 'FR-PS-06' });
    productQuestion('Should Status read "New / Investigating / Closed" or the system codes NEW / INVESTIGATING / CLOSED?');
    const ps = await new PositionsPage(page).open();
    await ps.grid.settle();
    const statuses = await ps.grid.columnValues('status');
    expect(statuses.every((s) => /^(New|Investigating|Closed)$/.test(s)), statuses.slice(0, 3).join(', ')).toBe(true);
  });

  test('FR-PS-07: the screen acts for the configured tenant', async ({ page }) => {
    meta({ screen: 'positions', fr: 'FR-PS-07', what: 'Fresh sessions can land on another tenant; the suite corrects and checks it.' });
    await new PositionsPage(page).open();
    await expect(page.locator('[data-qa="tenant-switcher"]')).toHaveValue('alpha');
  });
});
