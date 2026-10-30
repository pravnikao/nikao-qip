import { defineClientConfig } from '../../core/config/client-config';

/**
 * Client pack configuration. This example targets the bundled demo app.
 * For a new client: copy client-pack/ from templates, then fill this file in
 * (environments, auth, tenants, screens). Nothing client-specific goes in core/.
 */
export default defineClientConfig({
  code: 'demo-holdings',
  displayName: 'Demo Holdings',
  defaultEnvironment: 'demo',
  environments: {
    demo: {
      baseUrl: 'http://localhost:4310',
      restBaseUrl: 'http://localhost:4310/api/v1',
      graphqlUrl: 'http://localhost:4310/graphql',
      openApi: 'http://localhost:4310/api/v1/openapi.json',
      healthUrl: 'http://localhost:4310/api/v1/health',
      loginUrlPattern: '/auth/realms/',
      allowWrites: true,
    },
  },
  auth: {
    ui: { kind: 'form', selectors: { username: '#username', password: '#password', submit: '#kc-login' }, successUrlPattern: '/positions', readySelector: '[data-qa="app-header"]' },
    api: { kind: 'api-key', headerName: 'x-api-key', valueEnv: 'QIP_API_KEY' },
  },
  roles: {
    admin: { usernameEnv: 'QIP_ADMIN_USER', passwordEnv: 'QIP_ADMIN_PASS', description: 'Main driver for every test' },
    viewer: { usernameEnv: 'QIP_VIEWER_USER', passwordEnv: 'QIP_VIEWER_PASS', description: 'Fresh-login and permission tests only' },
  },
  defaultRole: 'admin',
  freshLoginRoles: ['viewer'],
  tenancy: {
    ui: 'ui-switch',
    api: 'header',
    headerName: 'x-tenant',
    tenants: { alpha: { id: 'alpha', label: 'Alpha Capital' }, beta: { id: 'beta', label: 'Beta Partners' } },
    defaultTenant: 'alpha',
  },
  timeouts: { apiMs: 15_000, slowApiMs: 30_000, readModelMs: 2_500, uiMs: 15_000 },
  screens: {
    positions: { title: 'Positions', route: '/positions', specPatterns: ['positions'] },
    documents: { title: 'Documents', route: '/documents', specPatterns: ['documents'] },
    comments: { title: 'Comments', route: '/comments', specPatterns: ['comments'] },
    platform: { title: 'Platform', aliases: ['Smoke', 'Authentication'], specPatterns: ['smoke', 'auth'] },
  },
  defectTracker: { name: 'Jira', ticketPattern: '^DEMO-\\d+$' },
  closure: { cleanRunsRequired: 2, newDefectDays: 7 },
});
