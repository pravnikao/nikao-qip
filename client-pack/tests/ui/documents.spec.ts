import { test, expect } from '../../../core/fixtures';
import { bug, meta, rowsChecked } from '../../../core/defects/annotations';
import { captureGraphQL } from '../../../core/ui/network';
import { requireRows } from '../../../core/data/probes';
import { documentsProbe } from '../../data/probes';
import { DocumentsPage } from '../../pages/DocumentsPage';

test.describe('Documents', () => {
  test('FR-DOC-01: the grid shows the packages the API returns for the search', async ({ page }) => {
    meta({ screen: 'documents', fr: 'FR-DOC-01' });
    await requireRows(documentsProbe);
    const docs = await new DocumentsPage(page).open();
    const call = await captureGraphQL<{ documents: { totalCount: number; nodes: { id: string }[] } }>(page, 'DocumentSearch', () => docs.searchButton.click());
    await docs.grid.settle();
    const ids = await docs.grid.rowIds();
    rowsChecked(ids.length);
    expect(ids).toEqual(call.data!.documents.nodes.map((n) => n.id));
    await expect(docs.total).toHaveText(`${call.data!.documents.totalCount} documents`);
  });

  test('FR-DOC-02: Search sends the typed text to DocumentSearch', async ({ page }) => {
    meta({ screen: 'documents', fr: 'FR-DOC-02' });
    const docs = await new DocumentsPage(page).open();
    await docs.searchInput.fill('UK');
    const call = await captureGraphQL(page, 'DocumentSearch', () => docs.searchButton.click());
    expect(call.variables.search).toBe('UK');
  });

  test('FR-DOC-03: the grid settles after a search (rows or empty state)', async ({ page }) => {
    meta({ screen: 'documents', fr: 'FR-DOC-03' });
    bug('BUG-UI-006', { priority: 'Medium', summary: 'grid can stay on Loading…', intermittent: true });
    const docs = await new DocumentsPage(page).open();
    await docs.searchInput.fill('DE');
    await docs.searchButton.click();
    expect(['rows', 'empty']).toContain(await docs.grid.settle());
  });

  test('FR-DOC-04: Failed packages show their issuer', async ({ page }) => {
    meta({ screen: 'documents', fr: 'FR-DOC-04' });
    bug('BUG-API-003', { priority: 'High', summary: 'issuer missing on Failed packages' });
    const docs = await new DocumentsPage(page).open();
    await docs.searchInput.fill('');
    await docs.searchButton.click();
    await docs.grid.settle();
    const ids = await docs.grid.rowIds();
    let failed = 0;
    for (const id of ids) {
      if ((await docs.grid.cell('status', id)) !== 'Failed') continue;
      failed++;
      expect(await docs.grid.cell('issuerName', id), `issuer for ${id}`).not.toBe('—');
    }
    rowsChecked(failed);
    expect(failed).toBeGreaterThan(0);
  });
});
