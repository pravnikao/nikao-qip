import type { BauVerdict } from '../../core/report/registry';

/**
 * Decisions made by the client's business team. The framework records them and never overrides them.
 * Example: { 'BUG-UI-004': { verdict: 'Retest Pass', date: '2026-11-02', by: 'BAU', note: 'Confirmed on Test' } }
 */
export const bauVerdicts: Record<string, BauVerdict> = {};
