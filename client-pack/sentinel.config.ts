import type { SentinelChecks } from '../core/sentinel/sentinel';

/** What the Sentinel watches on this platform. */
export const sentinelChecks: SentinelChecks = {
  latency: [
    { name: 'positions page 1', kind: 'rest', path: '/positions?page=1&size=20', budgetMs: 2_000 },
    { name: 'DocumentSearch', kind: 'graphql', document: 'query SentinelDocuments { documents(search: "CA", first: 5) { totalCount } }', budgetMs: 2_000 },
  ],
  keyScreens: [
    { name: 'Positions', route: '/positions', readySelector: '[data-qa="positions-table"]', role: 'admin' },
    { name: 'Documents', route: '/documents', readySelector: '[data-qa="documents-table"]', role: 'admin' },
    { name: 'Comments', route: '/comments', readySelector: '[data-qa="comment-add"]', role: 'admin' },
  ],
};
