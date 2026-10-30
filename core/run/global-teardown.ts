import { envOptional } from '../config/env';
import { releaseLock } from './session-lock';

export default async function globalTeardown(): Promise<void> {
  const holder = envOptional('QIP_INSTANCE', 'local')!;
  if (!releaseLock(holder)) {
    console.warn(`[qip] session lock is held by someone else; left in place (we are "${holder}")`);
  }
}
