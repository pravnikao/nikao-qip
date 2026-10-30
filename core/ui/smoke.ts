import { expect, Page } from '@playwright/test';
import { assertNotOnLogin } from '../auth/ui-auth';

/**
 * Keyed-screen smoke: the screen opens at its route, shows its heading, and renders
 * exactly one of its content states (a table with rows, or its empty state; never
 * both, never neither). Cheap, runs on every screen, catches broken routes and
 * blank screens after a deployment.
 */
export async function keyedScreenSmoke(page: Page, s: { route: string; heading: string | RegExp; content: string; empty?: string }): Promise<void> {
  await page.goto(s.route);
  assertNotOnLogin(page);
  await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText(s.heading);
  const content = page.locator(`[data-qa="${s.content}"]`);
  const empty = s.empty ? page.locator(`[data-qa="${s.empty}"]`) : undefined;
  await expect
    .poll(
      async () => {
        const c = await content.isVisible().catch(() => false);
        const e = empty ? await empty.isVisible().catch(() => false) : false;
        return c !== e ? 'one' : c && e ? 'both' : 'neither';
      },
      { message: `${s.route} should render exactly one of ${s.content}${s.empty ? ` / ${s.empty}` : ''}`, timeout: 20_000 },
    )
    .toBe('one');
}
