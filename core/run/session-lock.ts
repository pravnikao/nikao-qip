import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * One test run at a time per working copy and environment. Several agents or people
 * share one checkout; two runs at once corrupt each other's sessions and data.
 *
 * Rule: read the lock before deleting it. Only its holder may release it.
 */

export interface LockInfo {
  holder: string;
  purpose: string;
  pid: number;
  host: string;
  startedAt: string;
}

export const DEFAULT_LOCK_FILE = '.qip-session.lock';
/** A lock older than this is treated as abandoned (process crashed). */
export const STALE_AFTER_MS = 4 * 60 * 60 * 1000;

export class LockHeldError extends Error {
  constructor(public readonly info: LockInfo) {
    super(
      `Session lock held by "${info.holder}" since ${info.startedAt} (${info.purpose}, pid ${info.pid} on ${info.host}). ` +
        `Wait for it to finish. Do not delete a lock you do not hold.`,
    );
    this.name = 'LockHeldError';
  }
}

function lockPath(file?: string): string {
  return path.resolve(process.cwd(), file ?? DEFAULT_LOCK_FILE);
}

export function readLock(file?: string): LockInfo | undefined {
  const p = lockPath(file);
  if (!fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as LockInfo;
  } catch {
    return { holder: '(unreadable)', purpose: '', pid: 0, host: '', startedAt: new Date(0).toISOString() };
  }
}

export function isStale(info: LockInfo, now = Date.now()): boolean {
  return now - Date.parse(info.startedAt) > STALE_AFTER_MS;
}

/** Takes the lock, or throws LockHeldError if another holder has a live lock. Re-entrant for the same holder. */
export function acquireLock(holder: string, purpose: string, file?: string): LockInfo {
  const current = readLock(file);
  if (current && current.holder !== holder && !isStale(current)) throw new LockHeldError(current);
  const info: LockInfo = { holder, purpose, pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString() };
  const tmp = lockPath(file) + `.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(info, null, 2));
  fs.renameSync(tmp, lockPath(file));
  return info;
}

/** Releases only if `holder` holds it. Returns false (and leaves the file) otherwise. */
export function releaseLock(holder: string, file?: string): boolean {
  const current = readLock(file);
  if (!current) return true;
  if (current.holder !== holder) return false;
  fs.rmSync(lockPath(file), { force: true });
  return true;
}
