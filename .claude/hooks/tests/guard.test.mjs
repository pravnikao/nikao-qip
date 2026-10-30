import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../guard.mjs';

const ownership = {
  builder: ['client-pack/pages/', 'client-pack/tests/'],
  verifier: [],
};
const env = { CLAUDE_PROJECT_DIR: '/repo', QIP_ENV: 'demo' };
const bash = (command, agent_type) => decide({ tool_name: 'Bash', tool_input: { command }, agent_type }, ownership, env);
const write = (file_path, agent_type) => decide({ tool_name: 'Write', tool_input: { file_path }, agent_type }, ownership, env);
const decision = (o) => o?.hookSpecificOutput?.permissionDecision;

test('git changes are the QA lead\'s job', () => {
  for (const c of ['git commit -m x', 'git push origin main', 'git add -A', 'git reset --hard HEAD', 'gh pr create --fill', 'git merge main']) {
    assert.equal(decision(bash(c)), 'deny', c);
  }
  for (const c of ['git status', 'git diff', 'git log --oneline -5']) assert.equal(bash(c), undefined, c);
});

test('secrets stay unread', () => {
  assert.equal(decision(bash('cat .env')), 'deny');
  assert.equal(decision(bash('grep PASS .env.local')), 'deny');
  assert.equal(decision(bash('ls .auth/demo')), 'deny');
  assert.equal(decision(bash('printenv')), 'deny');
  assert.equal(decision(bash('echo $QIP_ADMIN_PASS')), 'deny');
  assert.equal(decision(decide({ tool_name: 'Read', tool_input: { file_path: '/repo/.env' } }, ownership, env)), 'deny');
  assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: '/repo/.env.example' } }, ownership, env), undefined);
  assert.equal(decision(write('/repo/.env', undefined)), 'deny');
});

test('the session lock is never deleted by hand', () => {
  assert.equal(decision(bash('rm -f .qip-session.lock')), 'deny');
  assert.equal(bash('npm run qip -- lock release --as builder-1'), undefined);
});

test('agents write only the paths they own', () => {
  assert.equal(write('/repo/client-pack/pages/PositionsPage.ts', 'builder'), undefined);
  assert.equal(write('client-pack/tests/ui/x.spec.ts', 'builder'), undefined);
  assert.equal(decision(write('/repo/core/report/workbook.ts', 'builder')), 'deny');
  assert.equal(decision(write('/repo/docs/x.md', 'verifier')), 'deny');
  assert.equal(write('/repo/core/report/workbook.ts', undefined), undefined, 'main session is not restricted');
  assert.equal(write('/repo/anything.ts', 'some-other-agent'), undefined, 'unlisted agents are not restricted');
});

test('runs that create data on a shared environment ask first', () => {
  assert.equal(bash('QIP_ENV=demo npx playwright test'), undefined);
  assert.equal(decision(bash('QIP_ENV=test npx playwright test --project=e2e')), 'ask');
  assert.equal(bash('QIP_ENV=test npx playwright test --grep-invert @creates-data'), undefined);
  assert.equal(bash('QIP_ENV=test npx playwright test -c playwright.unit.config.ts'), undefined);
  assert.equal(decision(bash('curl -X DELETE https://api.example/positions/1')), 'ask');
});
