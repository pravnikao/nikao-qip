import { clientConfig } from '../config/client-config';
import { env, envOptional } from '../config/env';

/**
 * API credentials for every supported scheme. Tokens are cached per scheme and
 * refreshed 60 s before expiry. Secrets never reach logs (see maskSecret).
 */

interface CachedToken {
  token: string;
  expiresAt: number;
}
const cache = new Map<string, CachedToken>();

export function clearTokenCache(): void {
  cache.clear();
}

async function fetchToken(key: string, tokenUrl: string, form: Record<string, string>): Promise<string> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt - 60_000 > Date.now()) return hit.token;
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AUTH-TOKEN — ${tokenUrl} returned ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error(`AUTH-TOKEN — ${tokenUrl} returned no access_token`);
  cache.set(key, { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 300) * 1000 });
  return body.access_token;
}

/** Headers to add to every API request for the configured scheme. */
export async function apiAuthHeaders(): Promise<Record<string, string>> {
  const a = clientConfig().auth.api;
  switch (a.kind) {
    case 'none':
    case 'session-cookie':
      return {};
    case 'api-key':
      return { [a.headerName]: env(a.valueEnv, { secret: true }) };
    case 'bearer-env':
      return { authorization: `Bearer ${env(a.tokenEnv, { secret: true })}` };
    case 'basic':
      return {
        authorization: `Basic ${Buffer.from(`${env(a.userEnv)}:${env(a.passEnv, { secret: true })}`).toString('base64')}`,
      };
    case 'oidc-client-credentials': {
      const form: Record<string, string> = {
        grant_type: 'client_credentials',
        client_id: env(a.clientIdEnv),
        client_secret: env(a.clientSecretEnv, { secret: true }),
      };
      if (a.scope) form.scope = a.scope;
      return { authorization: `Bearer ${await fetchToken('cc', env(a.tokenUrlEnv), form)}` };
    }
    case 'oidc-password': {
      const role = clientConfig().roles[a.role];
      const form: Record<string, string> = {
        grant_type: 'password',
        client_id: env(a.clientIdEnv),
        username: env(role.usernameEnv),
        password: env(role.passwordEnv, { secret: true }),
      };
      const secret = a.clientSecretEnv ? envOptional(a.clientSecretEnv) : undefined;
      if (secret) form.client_secret = secret;
      return { authorization: `Bearer ${await fetchToken(`pw:${a.role}`, env(a.tokenUrlEnv), form)}` };
    }
  }
}

/** Forget a cached token after a 401, so the next call fetches a fresh one. */
export function invalidateApiToken(): void {
  cache.clear();
}
