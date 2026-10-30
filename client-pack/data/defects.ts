import type { DefectEntry } from '../../core/report/registry';

/**
 * The defect registry for this client. One entry per defect the suite references.
 * tickets: the client's tracker ids once raised (empty = not raised yet).
 */
export const defects: Record<string, DefectEntry> = {
  'BUG-API-001': {
    summary: 'GET /positions?sort=quantity sorts quantities as text (100 before 9).',
    screen: 'Positions',
    priority: 'Medium',
    tickets: ['DEMO-101'],
    type: 'functional',
    raised: '2026-09-02',
  },
  'BUG-API-003': {
    summary: 'DocumentSearch returns issuerName null on Failed packages.',
    screen: 'Documents',
    priority: 'High',
    tickets: [],
    type: 'data',
    raised: '2026-10-28',
  },
  'BUG-UI-004': {
    summary: 'No empty-state message when a search matches nothing.',
    screen: 'Positions',
    priority: 'Low',
    tickets: ['DEMO-104'],
    type: 'functional',
    raised: '2026-09-10',
  },
  'BUG-UI-005': {
    summary: 'Sorting by issuer orders the current page only, not the whole result set.',
    screen: 'Positions',
    priority: 'Medium',
    tickets: ['DEMO-105'],
    type: 'functional',
    raised: '2026-09-12',
    dataSensitive: { minRows: 50 },
  },
  'BUG-UI-006': {
    summary: 'Documents grid occasionally stays on "Loading…" after a search.',
    screen: 'Documents',
    priority: 'Medium',
    tickets: ['DEMO-106'],
    type: 'environment',
    raised: '2026-09-20',
    intermittent: true,
  },
  'BUG-API-007': {
    summary: 'Adding a comment is slow to appear in the comments list (read model lag).',
    screen: 'Comments',
    priority: 'Medium',
    tickets: [],
    type: 'performance',
    raised: '2026-10-29',
  },
};
