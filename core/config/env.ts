/**
 * Lazy environment access.
 *
 * Rule: never read process.env at module top level. A top-level read breaks unit
 * tests and CI steps that import a module without the variable set. Call env()
 * inside the function that needs the value. tests/unit/env-scan.spec.ts enforces it.
 */
export class QipConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QipConfigError';
  }
}

let dotenvLoaded = false;

/** Loads .env once, on first use. Existing process.env values always win. */
export function loadDotEnv(file = '.env'): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Shows the first 4 characters only. Use it for any secret that reaches a log. */
export function maskSecret(value: string | undefined): string {
  if (!value) return '(empty)';
  return value.length <= 4 ? '****' : `${value.slice(0, 4)}…(${value.length})`;
}

export interface EnvOptions {
  /** Masks the value in error messages and debug output. */
  secret?: boolean;
}

/** Required variable. Throws a clear error naming the variable when it is missing. */
export function env(name: string, _opts: EnvOptions = {}): string {
  loadDotEnv();
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new QipConfigError(`Missing required environment variable ${name}. Set it in .env or the CI secrets.`);
  }
  return value;
}

/** Optional variable with a fallback. */
export function envOptional(name: string, fallback?: string): string | undefined {
  loadDotEnv();
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export function envFlag(name: string, fallback = false): boolean {
  const v = envOptional(name);
  if (v === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}
