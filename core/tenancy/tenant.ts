import type { Page } from '@playwright/test';
import { clientConfig } from '../config/client-config';

/**
 * Multi-tenant platforms: every test acts for one tenant (client, entity, workspace).
 *
 * UI-switch platforms often land a fresh login on whichever tenant the user saw last,
 * so the tenant must be re-applied and checked on every new session. A mismatch is
 * logged as [scope-leak] so leaks show up in the run log, then corrected.
 */

export interface TenantSwitcher {
  /** The tenant id the page is currently acting for. */
  current(page: Page): Promise<string | undefined>;
  /** Switch the page to a tenant id. */
  switchTo(page: Page, tenantId: string): Promise<void>;
}

let switcher: TenantSwitcher | undefined;

/** The client pack registers how its UI switches tenant. */
export function registerTenantSwitcher(s: TenantSwitcher): void {
  switcher = s;
}

export function tenant(key?: string): { key: string; id: string; label: string } {
  const t = clientConfig().tenancy;
  const k = key ?? t.defaultTenant;
  if (!k || !t.tenants[k]) throw new Error(`Unknown tenant "${k}". Configure tenancy.tenants in client.config.ts`);
  return { key: k, ...t.tenants[k] };
}

/** Makes sure the page acts for the tenant; switches and logs [scope-leak] if it did not. */
export async function ensureTenant(page: Page, key?: string): Promise<void> {
  const t = clientConfig().tenancy;
  if (t.ui !== 'ui-switch') return;
  if (!switcher) throw new Error('tenancy.ui is ui-switch but no TenantSwitcher is registered (client-pack/support)');
  const want = tenant(key);
  const have = await switcher.current(page);
  if (have === want.id) return;
  console.warn(`[scope-leak] expected tenant ${want.id} (${want.label}) but the session was on ${have ?? 'none'}: switching`);
  await switcher.switchTo(page, want.id);
  const after = await switcher.current(page);
  if (after !== want.id) throw new Error(`Tenant switch failed: wanted ${want.id}, still on ${after ?? 'none'}`);
}

/** Applies the tenant to an API request for header / query / variable tenancy. */
export function applyTenant<T extends { headers: Record<string, string>; query?: Record<string, string>; variables?: Record<string, unknown> }>(
  req: T,
  key?: string,
): T {
  const t = clientConfig().tenancy;
  if (t.api === 'none') return req;
  const id = tenant(key).id;
  if (t.api === 'header' && t.headerName) req.headers[t.headerName] = id;
  if (t.api === 'query' && t.queryParam) req.query = { ...(req.query ?? {}), [t.queryParam]: id };
  if (t.api === 'variable' && t.variableName) req.variables = { ...(req.variables ?? {}), [t.variableName]: id };
  return req;
}
