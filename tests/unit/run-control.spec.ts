import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { acquireLock, LockHeldError, readLock, releaseLock } from '../../core/run/session-lock';
import { eventually } from '../../core/run/eventually';
import { stableKey } from '../../core/reporter/stable-key';
import { resolveScreen } from '../../core/reporter/screen-resolver';
import { suggest, levenshtein } from '../../core/ui/drift';

test.describe('session lock', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qip-lock-')), 'lock');

  test('one holder at a time; only the holder may release', () => {
    acquireLock('instance-D', 'api run', file);
    expect(readLock(file)?.holder).toBe('instance-D');
    expect(() => acquireLock('instance-E', 'ui run', file)).toThrow(LockHeldError);
    expect(releaseLock('instance-E', file)).toBe(false);
    expect(fs.existsSync(file)).toBe(true);
    acquireLock('instance-D', 'api run again', file); // re-entrant
    expect(releaseLock('instance-D', file)).toBe(true);
    expect(readLock(file)).toBeUndefined();
  });

  test('a lock older than four hours counts as abandoned', () => {
    fs.writeFileSync(file, JSON.stringify({ holder: 'crashed', purpose: 'x', pid: 1, host: 'h', startedAt: new Date(Date.now() - 5 * 3600_000).toISOString() }));
    expect(acquireLock('instance-E', 'ui run', file).holder).toBe('instance-E');
    releaseLock('instance-E', file);
  });
});

test.describe('eventually', () => {
  test('returns once the read side catches up', async () => {
    let n = 0;
    expect(await eventually('row', async () => (++n >= 3 ? 'found' : undefined), { timeoutMs: 5_000, intervalMs: 10 })).toBe('found');
  });

  test('fails with READ-MODEL-LAG after the budget', async () => {
    await expect(eventually('comment 42', async () => undefined, { timeoutMs: 200, intervalMs: 20 })).rejects.toThrow(/READ-MODEL-LAG — comment 42 not visible/);
  });
});

test.describe('identity and screens', () => {
  test('stable key ignores folders and survives a recorded rename', () => {
    const a = stableKey({ layer: 'ui', specFile: 'tests/ui/a/positions.spec.ts', describePath: ['Positions'], title: 'old title' });
    const b = stableKey({ layer: 'ui', specFile: 'other/positions.spec.ts', describePath: ['Positions'], title: 'old title' });
    const c = stableKey({ layer: 'ui', specFile: 'other/positions.spec.ts', describePath: ['Positions'], title: 'new title', renames: { 'new title': 'old title' } });
    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(a).toMatch(/^UI-[0-9a-f]{8}$/);
  });

  test('screen resolution: meta, then describe, then spec name, then UNMAPPED', () => {
    const screens = {
      ps: { title: 'Position Search', aliases: ['Positions'], specPatterns: ['position-search'], isFlow: false },
      docs: { title: 'Documents', aliases: [], specPatterns: [], isFlow: false },
    };
    expect(resolveScreen(screens, { metaScreen: 'ps', describePath: [], specFile: 'x.ts' })).toBe('Position Search');
    expect(resolveScreen(screens, { describePath: ['Documents — GraphQL API'], specFile: 'x.ts' })).toBe('Documents');
    expect(resolveScreen(screens, { describePath: ['Positions'], specFile: 'x.ts' })).toBe('Position Search');
    expect(resolveScreen(screens, { describePath: ['Misc'], specFile: 'position-search.data.ts' })).toBe('Position Search');
    expect(resolveScreen(screens, { describePath: ['Catalogue read model'], specFile: 'misc.ts' })).toBe('UNMAPPED: Catalogue read model');
  });
});

test.describe('locator drift', () => {
  test('suggests the nearest present id, comparing stems of dynamic ids', () => {
    expect(levenshtein('positions-export-button', 'positions-export-btn')).toBe(3);
    const s = suggest(['positions-export-button', 'positions-row-'], ['positions-export-btn', 'positions-row-1001', 'positions-row-1002', 'app-header']);
    expect(s).toEqual([{ wanted: 'positions-export-button', closest: 'positions-export-btn', distance: 3 }]);
  });

  test('does not suggest something unrelated', () => {
    expect(suggest(['mdo-manage-overrides-button'], ['app-header', 'nav-home'])).toEqual([]);
  });
});
