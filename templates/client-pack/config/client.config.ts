import { defineClientConfig } from '../../core/config/client-config';

/** Fill in for the client platform. See docs/onboarding-playbook.md. */
export default defineClientConfig({
  code: 'client-code', // short, no legal names
  displayName: 'Client platform',
  defaultEnvironment: 'test',
  environments: {
    test: {
      baseUrl: 'https://app.test.example.com',
      graphqlUrl: 'https://gateway.test.example.com/graphql', // remove if REST only
      restBaseUrl: 'https://api.test.example.com/v1', // remove if GraphQL only
      openApi: 'https://api.test.example.com/v1/openapi.json', // optional
      healthUrl: 'https://api.test.example.com/v1/health', // optional, authenticated and cheap
      loginUrlPattern: '/(auth/realms|login|signin)/',
      allowWrites: true,
    },
  },
  auth: {
    ui: { kind: 'form', selectors: { username: '#username', password: '#password', submit: '#kc-login' }, successUrlPattern: '.*', readySelector: '[data-qa="app-header"]' },
    api: { kind: 'oidc-client-credentials', tokenUrlEnv: 'QIP_API_TOKEN_URL', clientIdEnv: 'QIP_API_CLIENT_ID', clientSecretEnv: 'QIP_API_CLIENT_SECRET' },
  },
  roles: {
    main: { usernameEnv: 'QIP_MAIN_USER', passwordEnv: 'QIP_MAIN_PASS', description: 'Main driver for every test' },
    fresh: { usernameEnv: 'QIP_FRESH_USER', passwordEnv: 'QIP_FRESH_PASS', description: 'Login-flow tests only' },
  },
  defaultRole: 'main',
  freshLoginRoles: ['fresh'],
  tenancy: { ui: 'none', api: 'none', tenants: {} },
  screens: {
    // dashboard: { title: 'Dashboard', route: '/', specPatterns: ['dashboard'] },
  },
  defectTracker: { name: 'Jira', ticketPattern: '^[A-Z][A-Z0-9]+-\\d+$' },
  closure: { cleanRunsRequired: 2, newDefectDays: 7 },
});
