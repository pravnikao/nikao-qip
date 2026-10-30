import { activeEnvironment, clientConfig } from '../config/client-config';
import { apiAuthHeaders } from '../auth/api-auth';

/**
 * Environment health: is the platform up, and do our API credentials work?
 * Fails with ENV-UNAVAILABLE (infrastructure) so a down environment never shows
 * up as hundreds of product failures.
 */
export interface HealthResult {
  url: string;
  status: number;
  ms: number;
  authOk: boolean;
}

export async function checkHealth(): Promise<HealthResult | undefined> {
  const e = activeEnvironment();
  if (!e.healthUrl) return undefined;
  let headers: Record<string, string> = {};
  try {
    headers = await apiAuthHeaders();
  } catch (err) {
    throw new Error(`ENV-UNAVAILABLE — API auth failed for ${e.name}: ${(err as Error).message}. Check the credentials/secrets for this environment.`);
  }
  const start = Date.now();
  let status = 0;
  try {
    const r = await fetch(e.healthUrl, { headers, signal: AbortSignal.timeout(clientConfig().timeouts.apiMs) });
    status = r.status;
  } catch (err) {
    throw new Error(`ENV-UNAVAILABLE — ${e.healthUrl} did not answer: ${(err as Error).message}`);
  }
  const ms = Date.now() - start;
  if (status === 401 || status === 403) throw new Error(`ENV-UNAVAILABLE — ${e.healthUrl} rejected our credentials (${status}). Secrets may be stale after a restore.`);
  if (status >= 500) throw new Error(`ENV-UNAVAILABLE — ${e.healthUrl} returned ${status}`);
  return { url: e.healthUrl, status, ms, authOk: true };
}
