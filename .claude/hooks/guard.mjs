#!/usr/bin/env node
/**
 * Nikao QIP guard: a PreToolUse hook that enforces the rules agents must not be
 * able to forget. Prompts can be ignored; this cannot.
 *
 *  1. git commit / push / merge / rebase / tag / reset --hard: QA lead only
 *  2. secrets: no reading .env, .auth sessions or printing secret variables
 *  3. session lock: never delete it by hand; use `qip lock release --as <you>`
 *  4. owned paths: an agent writes only the files its role owns (.claude/hooks/ownership.json)
 *  5. irreversible writes: a suite run that creates data on a shared environment asks first
 *
 * Input: the hook JSON on stdin (tool_name, tool_input, agent_type, cwd).
 * Output: a PreToolUse permission decision on stdout, or nothing (no opinion).
 */
import { readFileSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export function decide(input, ownership, env = process.env) {
  const tool = input.tool_name ?? '';
  const ti = input.tool_input ?? {};
  const agent = input.agent_type;
  const root = env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();

  // Shell tools: Bash everywhere, PowerShell on Windows. Both get the same rules.
  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = String(ti.command ?? '');
    // git with any global options before the subcommand, e.g. `git -C .\repo commit`.
    const GIT = String.raw`\bgit(?:\.exe)?(?:\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)|-c\s+\S+|--?[\w-]+(?:=\S+)?))*\s+`;
    if (new RegExp(`${GIT}(commit|push|merge|rebase|tag|cherry-pick|am|add)\\b|${GIT}reset\\s+--hard\\b`, 'i').test(cmd) || /\bgh(\.exe)?\s+pr\s+(create|merge)\b/i.test(cmd)) {
      return deny('Git changes are the QA lead\'s job. Leave your changes in the working tree and list the files in your report.');
    }
    const ENV_FILE = String.raw`\.env(?!\.example)(\b|\.)`;
    const readsEnvFile = new RegExp(String.raw`\b(cat|less|more|head|tail|type|grep|sed|awk|Get-Content|gc|Select-String|sls)\b[^|;&]*` + ENV_FILE, 'i').test(cmd);
    const readsAuth = /\.auth[\\/]/i.test(cmd);
    const dumpsEnv = /\b(printenv|env)\s*($|[|;&])/.test(cmd) || /\b(Get-ChildItem|gci|dir|ls)\s+env:/i.test(cmd) || /\[Environment\]::GetEnvironmentVariables?\(/i.test(cmd);
    const printsSecret = /\$\{?(env:)?QIP_[A-Z_]*(PASS|SECRET|TOKEN|KEY)/i.test(cmd);
    if (readsEnvFile || readsAuth || dumpsEnv || printsSecret) {
      return deny('Secrets stay unread: no .env, saved sessions or secret variables. Use the framework, which masks secrets to 4 characters.');
    }
    if (/\b(rm|del|erase|ri|rmdir|Remove-Item)\b[^|;&]*\.qip-session\.lock/i.test(cmd)) {
      return deny('Do not delete the session lock by hand. Run `npm run qip -- lock status`; if it names you, `npm run qip -- lock release --as <you>`. If it names someone else, leave it.');
    }
    if (/\bplaywright\s+test\b/.test(cmd)) {
      const envName = (cmd.match(/QIP_ENV\s*=\s*["']?([\w-]+)/i) ?? [])[1] ?? env.QIP_ENV ?? 'demo';
      const excludesWrites = /--grep-invert[ =]+['"]?[^'"]*@creates-data/.test(cmd) || /QIP_SCHEDULED\s*=\s*["']?1/.test(cmd);
      if (envName !== 'demo' && !excludesWrites && !/--project[ =]unit|playwright\.unit\.config/.test(cmd)) {
        return ask(`This run may create data on "${envName}" (tests tagged @creates-data). Approve, or re-run with --grep-invert @creates-data.`);
      }
    }
    if (/\bcurl(\.exe)?\b[^|;&]*(-X|--request)\s*(POST|PUT|PATCH|DELETE)\b/i.test(cmd) || /\b(Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b[^|;&]*-Method\s+['"]?(Post|Put|Patch|Delete)\b/i.test(cmd)) {
      return ask('This sends a write request to an API. Approve only if the brief names this exact write.');
    }
    return undefined;
  }

  if (tool === 'Read' || tool === 'Grep') {
    const p = String(ti.file_path ?? ti.path ?? '');
    if (/(^|[\\/])\.env(\.(?!example)[^\\/]*)?$/.test(p) || /(^|[\\/])\.auth([\\/]|$)/.test(p)) {
      return deny('Secrets stay unread: .env files and saved sessions are off limits.');
    }
    return undefined;
  }

  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const p = String(ti.file_path ?? ti.notebook_path ?? '');
    if (/(^|[\\/])\.qip-session\.lock$/.test(p)) return deny('The session lock is managed by `npm run qip -- lock`.');
    if (/(^|[\\/])\.env(\.[^\\/]*)?$/.test(p) && !p.endsWith('.env.example')) return deny('Never write secrets files.');
    if (!agent || !ownership || !(agent in ownership)) return undefined;
    const rel = relative(root, isAbsolute(p) ? p : resolve(root, p)).split('\\').join('/');
    const owned = ownership[agent];
    if (!owned.some((prefix) => rel === prefix || rel.startsWith(prefix))) {
      return deny(`As ${agent} you may write only: ${owned.length ? owned.join(', ') : '(nothing; this role is read-only)'}. "${rel}" belongs to another role: say what needs changing in your report.`);
    }
    return undefined;
  }
  return undefined;
}

function deny(reason) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
}
function ask(reason) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } };
}

function main() {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return;
  }
  let ownership = {};
  try {
    const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
    ownership = JSON.parse(readFileSync(join(root, '.claude', 'hooks', 'ownership.json'), 'utf8'));
    delete ownership._comment;
  } catch {
    /* no ownership file: rule 4 off */
  }
  const out = decide(input, ownership);
  if (out) process.stdout.write(JSON.stringify(out));
}

// Run when executed directly (works with Windows and POSIX paths), not when imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
