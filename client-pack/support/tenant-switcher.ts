import { registerTenantSwitcher } from '../../core/tenancy/tenant';

/** How this platform's UI shows and changes the tenant. Imported once by the page objects. */
registerTenantSwitcher({
  current: async (page) => (await page.locator('[data-qa="tenant-switcher"]').inputValue().catch(() => undefined)) ?? undefined,
  switchTo: async (page, id) => {
    await Promise.all([page.waitForLoadState('load'), page.locator('[data-qa="tenant-switcher"]').selectOption(id)]);
    await page.waitForLoadState('load');
    await page.locator('[data-qa="app-header"]').waitFor();
  },
});
