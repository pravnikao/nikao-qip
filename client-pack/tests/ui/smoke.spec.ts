import { test, expect } from '../../../core/fixtures';
import { meta } from '../../../core/defects/annotations';
import { keyedScreenSmoke } from '../../../core/ui/smoke';
import { signIn } from '../../../core/auth/ui-auth';
import { ensureTenant } from '../../../core/tenancy/tenant';
import '../../support/tenant-switcher';

test.describe('Smoke', () => {
  for (const s of [
    { name: 'Positions', route: '/positions', content: 'positions-table' },
    { name: 'Documents', route: '/documents', content: 'documents-table' },
    { name: 'Comments', route: '/comments', content: 'comments-list', empty: 'comments-empty' },
  ]) {
    test(`${s.name} opens at ${s.route} with its heading and content`, async ({ page }) => {
      meta({ screen: 'platform', what: 'Route, heading and one content state render.' });
      await keyedScreenSmoke(page, { route: s.route, heading: s.name, content: s.content, empty: (s as { empty?: string }).empty });
    });
  }
});

test.describe('Authentication', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a fresh login lands on a tenant and the suite switches to the one it acts for', async ({ page }) => {
    meta({ screen: 'platform', fr: 'FR-AUTH-01', what: 'Fresh-login role only (viewer). Detects tenant scope leaks.' });
    await signIn(page, 'viewer');
    await ensureTenant(page, 'alpha');
    await expect(page.locator('[data-qa="tenant-switcher"]')).toHaveValue('alpha');
  });

  test('a wrong password is refused with a message', async ({ page }) => {
    meta({ screen: 'platform', fr: 'FR-AUTH-02' });
    await page.goto('/positions');
    await page.locator('#username').fill('viewer');
    await page.locator('#password').fill('not-the-password');
    await page.locator('#kc-login').click();
    await expect(page.locator('[data-qa="login-error"]')).toHaveText('Invalid username or password');
  });
});
