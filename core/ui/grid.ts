import { expect, Locator, Page } from '@playwright/test';
import { rowsChecked } from '../defects/annotations';

/**
 * Generic data grid reader. Platforms differ in markup, so the data-qa conventions
 * are passed in; the behaviour (settle, read, page, compare) is shared.
 */
export interface GridConventions {
  /** The table/grid container. */
  table: string;
  /** Prefix of each row's data-qa (row-<id>). */
  rowPrefix: string;
  /** Prefix of a cell's data-qa for a column key: cell-<column>-<rowId>. */
  cellPrefix: (column: string) => string;
  /** The empty-state element, if any. */
  empty?: string;
  /** Text shown while loading (e.g. "Loading…"). */
  loadingText?: string | RegExp;
  pagination?: { next?: string; previous?: string; first?: string; last?: string; pageSize?: string; summary?: string };
}

export class GridUnsettledError extends Error {}

export class DataGrid {
  constructor(
    readonly page: Page,
    readonly c: GridConventions,
  ) {}

  private qa(id: string): Locator {
    return this.page.locator(`[data-qa="${id}"]`);
  }

  rows(): Locator {
    return this.qa(this.c.table).locator(`[data-qa^="${this.c.rowPrefix}"]`);
  }

  /**
   * Waits until the grid shows rows or its empty state. Neither within the timeout
   * is a screen problem, not missing data: it throws GRID-UNSETTLED with what was seen.
   */
  async settle(timeoutMs = 20_000): Promise<'rows' | 'empty'> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await this.rows().count()) > 0) return 'rows';
      if (this.c.empty && (await this.qa(this.c.empty).isVisible().catch(() => false))) return 'empty';
      await this.page.waitForTimeout(250);
    }
    const text = (await this.qa(this.c.table).textContent().catch(() => ''))?.slice(0, 200);
    throw new GridUnsettledError(`GRID-UNSETTLED — ${this.c.table} showed neither rows nor its empty state after ${timeoutMs / 1000} s (screen problem, not data). Saw: "${text}"`);
  }

  async rowCount(): Promise<number> {
    return this.rows().count();
  }

  async rowIds(): Promise<string[]> {
    const ids = await this.rows().evaluateAll((els, prefix) => els.map((e) => (e.getAttribute('data-qa') ?? '').slice(prefix.length)), this.c.rowPrefix);
    return ids;
  }

  async columnValues(column: string): Promise<string[]> {
    const prefix = this.c.cellPrefix(column);
    return this.qa(this.c.table)
      .locator(`[data-qa^="${prefix}"]`)
      .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
  }

  async cell(column: string, rowId: string): Promise<string> {
    return ((await this.qa(`${this.c.cellPrefix(column)}${rowId}`).textContent()) ?? '').trim();
  }

  async headers(): Promise<string[]> {
    return this.qa(this.c.table)
      .locator('th, [role="columnheader"]')
      .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()).filter(Boolean));
  }

  async nextPage(): Promise<void> {
    if (!this.c.pagination?.next) throw new Error('Grid has no next-page control configured');
    await this.qa(this.c.pagination.next).click();
  }

  async setPageSize(n: number): Promise<void> {
    if (!this.c.pagination?.pageSize) throw new Error('Grid has no page-size control configured');
    await this.qa(this.c.pagination.pageSize).selectOption(String(n));
  }

  /**
   * Compares screen rows to API rows field by field, in order, for the first `limit` rows.
   * Records how many rows were checked, so a 0-row pass never closes a defect.
   */
  async expectMatchesApi<R>(apiRows: R[], columns: { column: string; value: (r: R) => string }[], rowId: (r: R) => string, limit = 10): Promise<void> {
    const sample = apiRows.slice(0, limit);
    for (const r of sample) {
      for (const c of columns) {
        await expect(this.qa(`${this.c.cellPrefix(c.column)}${rowId(r)}`), `${c.column} for row ${rowId(r)}`).toHaveText(c.value(r));
      }
    }
    rowsChecked(sample.length);
  }
}
