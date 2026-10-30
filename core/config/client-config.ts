import { z } from 'zod';
import * as path from 'path';
import { envOptional, QipConfigError } from './env';

/**
 * Client configuration: everything platform-specific lives in
 * client-pack/config/client.config.ts. The core never hardcodes a client.
 */

const EnvironmentSchema = z.object({
  /** Web app base URL. */
  baseUrl: z.string().url(),
  /** GraphQL endpoint, if the platform has one. */
  graphqlUrl: z.string().url().optional(),
  /** REST base URL, if the platform has one. */
  restBaseUrl: z.string().url().optional(),
  /** Optional OpenAPI document (URL or repo path) used for contract checks. */
  openApi: z.string().optional(),
  /** Regex matching the identity-provider login URL; used to detect AUTH-EXPIRED. */
  loginUrlPattern: z.string().default('/(login|signin|auth/realms)/'),
  /** Cheap authenticated URL that proves the environment is up (Sentinel and global setup). */
  healthUrl: z.string().url().optional(),
  /** Mutations allowed on this environment? false = read-only (production-like). */
  allowWrites: z.boolean().default(true),
});

const UiAuthSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('form'),
    /** Selectors for the identity provider's login form. */
    selectors: z
      .object({
        username: z.string().default('#username'),
        password: z.string().default('#password'),
        submit: z.string().default('button[type=submit], #kc-login'),
      })
      .prefault({}),
    /** Regex the URL must match once signed in. */
    successUrlPattern: z.string().default('.*'),
    /** Optional element that proves the app shell loaded. */
    readySelector: z.string().optional(),
  }),
  z.object({ kind: z.literal('basic') }),
  z.object({ kind: z.literal('none') }),
]);

const ApiAuthSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('oidc-client-credentials'),
    tokenUrlEnv: z.string(),
    clientIdEnv: z.string(),
    clientSecretEnv: z.string(),
    scope: z.string().optional(),
  }),
  z.object({
    kind: z.literal('oidc-password'),
    tokenUrlEnv: z.string(),
    clientIdEnv: z.string(),
    clientSecretEnv: z.string().optional(),
    /** Role whose username/password env vars are used. */
    role: z.string(),
  }),
  z.object({
    kind: z.literal('session-cookie'),
    /** Role whose saved UI session is reused for API calls (same-origin apps). */
    role: z.string(),
  }),
  z.object({ kind: z.literal('api-key'), headerName: z.string().default('x-api-key'), valueEnv: z.string() }),
  z.object({ kind: z.literal('bearer-env'), tokenEnv: z.string() }),
  z.object({ kind: z.literal('basic'), userEnv: z.string(), passEnv: z.string() }),
  z.object({ kind: z.literal('none') }),
]);

const RoleSchema = z.object({
  usernameEnv: z.string(),
  passwordEnv: z.string(),
  description: z.string().optional(),
});

const TenancySchema = z.object({
  /**
   * How the UI chooses the active tenant:
   * - none: single-tenant, or the tenant comes from the login
   * - ui-switch: a tenant picker in the app (fresh logins may land on the wrong tenant)
   */
  ui: z.enum(['none', 'ui-switch']).default('none'),
  /** How API calls carry the tenant. */
  api: z.enum(['none', 'header', 'query', 'variable']).default('none'),
  headerName: z.string().optional(),
  queryParam: z.string().optional(),
  variableName: z.string().optional(),
  tenants: z.record(z.string(), z.object({ id: z.string(), label: z.string() })).default({}),
  defaultTenant: z.string().optional(),
});

const ScreenSchema = z.object({
  title: z.string(),
  route: z.string().optional(),
  /** Other names the reporter should resolve to this screen (old titles, describe names). */
  aliases: z.array(z.string()).default([]),
  /** Spec file name fragments that belong to this screen. */
  specPatterns: z.array(z.string()).default([]),
  /** A screen with flows across several screens. */
  isFlow: z.boolean().default(false),
});

export const ClientConfigSchema = z.object({
  /** Short internal code. Never a client's legal name in shared artefacts. */
  code: z.string().regex(/^[a-z0-9-]+$/),
  displayName: z.string(),
  environments: z.record(z.string(), EnvironmentSchema),
  defaultEnvironment: z.string(),
  auth: z.object({ ui: UiAuthSchema, api: ApiAuthSchema }),
  roles: z.record(z.string(), RoleSchema),
  defaultRole: z.string(),
  /** Roles used only by tests that need a fresh login (login flows). */
  freshLoginRoles: z.array(z.string()).default([]),
  tenancy: TenancySchema.prefault({}),
  timeouts: z
    .object({
      apiMs: z.number().default(30_000),
      slowApiMs: z.number().default(60_000),
      readModelMs: z.number().default(30_000),
      uiMs: z.number().default(20_000),
    })
    .prefault({}),
  screens: z.record(z.string(), ScreenSchema),
  defectTracker: z
    .object({
      name: z.string().default('Jira'),
      ticketPattern: z.string().default('^[A-Z][A-Z0-9]+-\\d+$'),
      urlTemplate: z.string().optional(),
    })
    .prefault({}),
  closure: z
    .object({
      cleanRunsRequired: z.number().int().min(1).default(2),
      newDefectDays: z.number().int().default(7),
    })
    .prefault({}),
  /** Trend baseline per environment (ISO date): runs before it are history only. */
  trendBaseline: z.record(z.string(), z.string()).default({}),
});

export type ClientConfig = z.infer<typeof ClientConfigSchema>;
export type ClientConfigInput = z.input<typeof ClientConfigSchema>;
export type EnvironmentConfig = z.infer<typeof EnvironmentSchema>;
export type ScreenConfig = z.infer<typeof ScreenSchema>;

/** Use in client-pack/config/client.config.ts: validates at load, typed everywhere. */
export function defineClientConfig(input: ClientConfigInput): ClientConfigInput {
  return input;
}

let cached: ClientConfig | undefined;

export function parseClientConfig(input: unknown): ClientConfig {
  const parsed = ClientConfigSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new QipConfigError(`client.config.ts is invalid:\n${issues}`);
  }
  const cfg = parsed.data;
  if (!cfg.environments[cfg.defaultEnvironment]) {
    throw new QipConfigError(`defaultEnvironment "${cfg.defaultEnvironment}" is not in environments`);
  }
  if (!cfg.roles[cfg.defaultRole]) throw new QipConfigError(`defaultRole "${cfg.defaultRole}" is not in roles`);
  return cfg;
}

/** Loads and validates the client pack's config once per process. */
export function clientConfig(): ClientConfig {
  if (cached) return cached;
  const file = envOptional('QIP_CLIENT_CONFIG', path.resolve(process.cwd(), 'client-pack/config/client.config.ts'))!;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(file);
  cached = parseClientConfig(mod.default ?? mod.config ?? mod);
  return cached;
}

export function resetClientConfigCache(): void {
  cached = undefined;
}

export function activeEnvironmentName(): string {
  return envOptional('QIP_ENV') ?? clientConfig().defaultEnvironment;
}

export function activeEnvironment(): EnvironmentConfig & { name: string } {
  const name = activeEnvironmentName();
  const e = clientConfig().environments[name];
  if (!e) throw new QipConfigError(`QIP_ENV="${name}" is not an environment in client.config.ts`);
  return { ...e, name };
}
