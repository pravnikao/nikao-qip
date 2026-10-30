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

const ps = (command, agent_type) => decide({ tool_name: 'PowerShell', tool_input: { command }, agent_type }, ownership, env);

test('PowerShell gets the same rules as Bash', () => {
  for (const c of ['git commit --allow-empty -m "hook test"', 'git -C .\\nikao-qip commit -m x', 'git -C "C:\\a b\\repo" push -u origin main', 'git.exe add .', 'git -c user.email=x commit -m y']) {
    assert.equal(decision(ps(c)), 'deny', c);
  }
  assert.equal(decision(bash('git -C ./repo push')), 'deny', 'bash with -C');
  for (const c of ['git status', 'git -C .\\nikao-qip log --oneline -1', 'git diff']) assert.equal(ps(c), undefined, c);
  assert.equal(decision(ps('Get-Content .env')), 'deny');
  assert.equal(decision(ps('gc .\\.env.local')), 'deny');
  assert.equal(ps('Get-Content .env.example'), undefined);
  assert.equal(decision(ps('Get-ChildItem env:')), 'deny');
  assert.equal(decision(ps('Write-Output $env:QIP_ADMIN_PASS')), 'deny');
  assert.equal(decision(ps('Remove-Item .qip-session.lock -Force')), 'deny');
  assert.equal(decision(ps('$env:QIP_ENV="test"; npx playwright test')), 'ask');
  assert.equal(ps('$env:QIP_ENV="demo"; npx playwright test'), undefined);
  assert.equal(decision(ps('Invoke-RestMethod -Uri https://api.example/x -Method Delete')), 'ask');
});
