import { expect, Locator, Page, test } from '@playwright/test';
import { clientConfig } from '../config/client-config';
import { assertNotOnLogin } from '../auth/ui-auth';
import { ensureTenant } from '../tenancy/tenant';
import { trackQaId } from './drift';

/**
 * Base for page objects. Page objects hold every locator; specs never build selectors.
 * Locators use data-qa hooks. qa() registers each id so a failing test can suggest
 * the nearest id that exists now (see drift.ts).
 */
export abstract class BasePage {
  /** Route relative to baseURL, e.g. "/positions". */
  abstract readonly route: string;
  /** Screen key in client.config.ts. */
  abstract readonly screen: string;
  /** Element that proves the screen rendered. */
  protected abstract readyLocator(): Locator;

  constructor(readonly page: Page) {}

  private info() {
    try {
      return test.info();
    } catch {
      return undefined;
    }
  }

  /** Element by exact data-qa id. */
  qa(id: string): Locator {
    trackQaId(this.info(), this.page, id);
    return this.page.locator(`[data-qa="${id}"]`);
  }

  /** Elements whose data-qa starts with a prefix (rows, cells with ids). */
  qaPrefix(prefix: string): Locator {
    trackQaId(this.info(), this.page, prefix);
    return this.page.locator(`[data-qa^="${prefix}"]`);
  }

  /** Opens the screen as the configured tenant and waits until it is ready. */
  async open(query: Record<string, string> = {}, opts: { tenant?: string } = {}): Promise<this> {
    const qs = new URLSearchParams(query).toString();
    await this.page.goto(this.route + (qs ? `?${qs}` : ''));
    assertNotOnLogin(this.page);
    await ensureTenant(this.page, opts.tenant);
    await this.waitReady();
    return this;
  }

  async waitReady(): Promise<void> {
    await expect(this.readyLocator(), `${this.screen} did not render`).toBeVisible({ timeout: clientConfig().timeouts.uiMs });
  }

  async heading(): Promise<string> {
    return (await this.page.getByRole('heading', { level: 1 }).first().textContent())?.trim() ?? '';
  }
}
