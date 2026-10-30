import type { Locator } from '@playwright/test';
import { BasePage } from '../../core/ui/base-page';
import { DataGrid } from '../../core/ui/grid';
import '../support/tenant-switcher';

export class PositionsPage extends BasePage {
  readonly route = '/positions';
  readonly screen = 'positions';

  readonly grid = new DataGrid(this.page, {
    table: 'positions-table',
    rowPrefix: 'positions-row-',
    cellPrefix: (c) => `positions-cell-${c}-`,
    empty: 'positions-empty',
    pagination: { next: 'positions-page-next', previous: 'positions-page-prev', pageSize: 'positions-page-size', summary: 'positions-page-summary' },
  });

  protected readyLocator(): Locator {
    return this.qa('positions-table');
  }

  get searchInput() {
    return this.qa('positions-search-input');
  }
  get searchButton() {
    return this.qa('positions-search-button');
  }
  get exportButton() {
    return this.qa('positions-export-button');
  }
  get sortSelect() {
    return this.qa('positions-sort');
  }
  get emptyState() {
    return this.qa('positions-empty');
  }
  get pageSummary() {
    return this.qa('positions-page-summary');
  }

  async search(text: string, window?: { from: string; to: string }): Promise<void> {
    await this.searchInput.fill(text);
    if (window) {
      await this.qa('positions-from').fill(window.from);
      await this.qa('positions-to').fill(window.to);
    }
    await this.searchButton.click();
  }
}
