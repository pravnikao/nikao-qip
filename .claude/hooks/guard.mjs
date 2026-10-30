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

  if (tool === 'Bash') {
    const cmd = String(ti.command ?? '');
    if (/\bgit\s+(commit|push|merge|rebase|tag|cherry-pick|am)\b|\bgit\s+reset\s+--hard\b|\bgit\s+add\b|\bgh\s+pr\s+(create|merge)\b/.test(cmd)) {
      return deny('Git changes are the QA lead\'s job. Leave your changes in the working tree and list the files in your report.');
    }
    if (/(cat|less|more|head|tail|type|grep|sed|awk)\b[^|;&]*\.env(\b|\.)|\.auth\//.test(cmd) || /\b(printenv|env)\s*($|[|;&])/.test(cmd) || /echo\s+[^|;&]*\$\{?QIP_[A-Z_]*(PASS|SECRET|TOKEN|KEY)/.test(cmd)) {
      return deny('Secrets stay unread: no .env, saved sessions or secret variables. Use the framework, which masks secrets to 4 characters.');
    }
    if (/\brm\b[^|;&]*\.qip-session\.lock/.test(cmd)) {
      return deny('Do not delete the session lock by hand. Run `npm run qip -- lock status`; if it names you, `npm run qip -- lock release --as <you>`. If it names someone else, leave it.');
    }
    if (/\bplaywright\s+test\b/.test(cmd)) {
      const envName = (cmd.match(/QIP_ENV=(\S+)/) ?? [])[1] ?? env.QIP_ENV ?? 'demo';
      const excludesWrites = /--grep-invert[ =]+['"]?[^'"]*@creates-data/.test(cmd) || /QIP_SCHEDULED=1/.test(cmd);
      if (envName !== 'demo' && !excludesWrites && !/--project[ =]unit|playwright\.unit\.config/.test(cmd)) {
        return ask(`This run may create data on "${envName}" (tests tagged @creates-data). Approve, or re-run with --grep-invert @creates-data.`);
      }
    }
    if (/\bcurl\b[^|;&]*(-X|--request)\s*(POST|PUT|PATCH|DELETE)\b/i.test(cmd)) {
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
