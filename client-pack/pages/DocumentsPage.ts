import type { Locator } from '@playwright/test';
import { BasePage } from '../../core/ui/base-page';
import { DataGrid } from '../../core/ui/grid';
import '../support/tenant-switcher';

export class DocumentsPage extends BasePage {
  readonly route = '/documents';
  readonly screen = 'documents';

  readonly grid = new DataGrid(this.page, {
    table: 'documents-table',
    rowPrefix: 'documents-row-',
    cellPrefix: (c) => `documents-cell-${c}-`,
    empty: 'documents-empty',
  });

  protected readyLocator(): Locator {
    return this.qa('documents-table');
  }

  get searchInput() {
    return this.qa('documents-search-input');
  }
  get searchButton() {
    return this.qa('documents-search-button');
  }
  get total() {
    return this.qa('documents-total');
  }
}
