import type { Locator } from '@playwright/test';
import { BasePage } from '../../core/ui/base-page';
import '../support/tenant-switcher';

export class CommentsPage extends BasePage {
  readonly route = '/comments';
  readonly screen = 'comments';

  protected readyLocator(): Locator {
    return this.qa('comment-add');
  }

  get positionInput() {
    return this.qa('comment-position-id');
  }
  get commentInput() {
    return this.qa('comment-input');
  }
  get addButton() {
    return this.qa('comment-add');
  }
  get status() {
    return this.qa('comment-status');
  }
  items(): Locator {
    return this.qaPrefix('comment-item-');
  }

  async add(positionId: number, text: string): Promise<void> {
    await this.positionInput.fill(String(positionId));
    await this.commentInput.fill(text);
    await this.addButton.click();
  }
}
