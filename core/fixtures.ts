import { test as base, expect } from '@playwright/test';
import { GraphQLClient } from './api/graphql-client';
import { RestClient } from './api/rest-client';
import { clearExchanges, recentExchanges } from './api/http-common';
import { attachDriftSuggestions } from './ui/drift';
import { flushPerf } from './perf/perf';
import { activeEnvironment } from './config/client-config';
import { storageStatePath, basicCredentials } from './auth/ui-auth';

/**
 * The test object every client-pack spec imports:
 *   import { test, expect } from '@core/fixtures';
 *
 * Adds API clients, per-role pages, and after-test evidence:
 *  - API timings (for p50/p95 and the Sentinel)
 *  - on failure: the last request/response pairs, redacted
 *  - on failure: locator drift suggestions
 */
interface QipFixtures {
  gql: GraphQLClient;
  rest: RestClient;
  /** A page signed in as another role (separate context, its own saved session). */
  pageAs: (role: string) => Promise<import('@playwright/test').Page>;
  qipEvidence: void;
}

export const test = base.extend<QipFixtures>({
  // Wraps the built-in page: on failure, record locator drift while the page is still open.
  page: async ({ page }, use, testInfo) => {
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus) await attachDriftSuggestions(testInfo);
  },
  gql: async ({}, use) => {
    const c = await GraphQLClient.create();
    await use(c);
    await c.dispose();
  },
  rest: async ({}, use) => {
    const c = await RestClient.create();
    await use(c);
    await c.dispose();
  },
  pageAs: async ({ browser }, use) => {
    const contexts: import('@playwright/test').BrowserContext[] = [];
    await use(async (role: string) => {
      const ctx = await browser.newContext({
        baseURL: activeEnvironment().baseUrl,
        storageState: storageStatePath(role),
        httpCredentials: basicCredentials(role),
      });
      contexts.push(ctx);
      return ctx.newPage();
    });
    for (const c of contexts) await c.close();
  },
  qipEvidence: [
    async ({}, use, testInfo) => {
      clearExchanges();
      await use();
      await flushPerf(testInfo);
      if (testInfo.status !== testInfo.expectedStatus) {
        const ex = recentExchanges();
        if (ex.length) await testInfo.attach('api-exchanges (redacted)', { body: JSON.stringify(ex.slice(-5), null, 2), contentType: 'application/json' });
      }
    },
    { auto: true },
  ],
});

export { expect };
