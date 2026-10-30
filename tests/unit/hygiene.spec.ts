import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { parseClientConfig } from '../../core/config/client-config';
import { maskSecret } from '../../core/config/env';

const root = path.resolve(__dirname, '../..');

function files(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (/\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

test.describe('hygiene', () => {
  test('no module reads process.env at top level (env access must be lazy)', () => {
    const offenders: string[] = [];
    for (const f of [...files(path.join(root, 'core')), ...files(path.join(root, 'client-pack'))]) {
      if (f.endsWith(path.join('config', 'env.ts'))) continue;
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      let depth = 0;
      lines.forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '').replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '""');
        if (depth === 0 && /process\.env\b|\benv(Optional|Flag)?\(/.test(code) && !/^\s*(export\s+)?(async\s+)?function\b/.test(code)) offenders.push(`${path.relative(root, f)}:${i + 1}: ${line.trim()}`);
        depth += (code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length;
      });
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  test('specs never build selectors: locators live in page objects', () => {
    const offenders: string[] = [];
    for (const f of files(path.join(root, 'client-pack', 'tests'))) {
      const text = fs.readFileSync(f, 'utf8');
      const hits = text.match(/page\.locator\(['"`]\[data-qa(?!="tenant-switcher"|="login-error")/g);
      if (hits) offenders.push(`${path.relative(root, f)}: ${hits.length}`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  test('no test.skip without a categorised helper or prefix', () => {
    const offenders: string[] = [];
    for (const f of files(path.join(root, 'client-pack', 'tests'))) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/test\.skip\(/.test(line) && !/(DATA-ABSENT|BLOCKED-|NOT-DEPLOYED|NOT-APPLICABLE|NOT-AUTOMATED|DEFERRED)/.test(line)) offenders.push(`${path.relative(root, f)}:${i + 1}`);
      });
    }
    expect(offenders, 'use skipDataAbsent/skipBlockedByDefect/... from core/defects/annotations').toEqual([]);
  });

  test('the client config validates and secrets are masked', () => {
    expect(() => parseClientConfig(require('../../client-pack/config/client.config.ts').default)).not.toThrow();
    expect(() => parseClientConfig({ code: 'X Y' })).toThrow(/client.config.ts is invalid/);
    expect(maskSecret('supersecretvalue')).toBe('supe…(16)');
    expect(maskSecret('abc')).toBe('****');
  });
});
