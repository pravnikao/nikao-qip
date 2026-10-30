# Onboarding playbook: new client to first baseline

Target: in about a week, a classified baseline run of the client's test environment, every screen
mapped, every skip explained, and a BAU pack the business can act on.

| Day | Who | Output |
| --- | --- | --- |
| 1 | QA lead, Architect | Client config, secrets in `.env` and CI, leak terms, unit tests green |
| 1 | Sentinel | GREEN on the test environment; schema/spec/hook snapshots saved |
| 2–3 | Observer, Prober | A capture per screen; API sizing and contract check per screen |
| 2–3 | Data steward | `data-sheet.json` from the business matrix; probes reconciled |
| 3 | Architect | FRs per screen with status in `docs/fr-status.md` |
| 3–5 | Builders | Page objects, then api / ui / e2e specs; smoke for every screen |
| 5 | Reporting | First full run, report, `history add --label baseline`, BAU pack |

## Checklist
**Access**
- [ ] Test environment URLs: web app, GraphQL and/or REST base, OpenAPI document, a cheap authenticated health URL
- [ ] Identity provider: login form selectors; whether sessions rotate refresh tokens
- [ ] Two UI accounts: a main driver and a fresh-login account; API credentials for the right scheme
- [ ] Tenants (clients, entities, workspaces) and which one tests act for
- [ ] Whether writes are allowed on the environment, and which data may be created

**Configuration**
- [ ] `client-pack/` replaced from `templates/client-pack/`
- [ ] `client.config.ts` validated (`npm run test:unit`)
- [ ] `.env` locally; secrets in CI (names match the config's `*Env` fields)
- [ ] `.qip-leak-terms` (kept out of git) and `npm run qip:leak-scan` clean

**Evidence before tests**
- [ ] Sentinel GREEN, snapshots saved (`--update-baseline`)
- [ ] One capture per screen (`docs/captures/`)
- [ ] One probe per screen with data; `npm run qip:probes` agrees with the business matrix
- [ ] FR list per screen

**Suite**
- [ ] Page objects hold every locator; specs start with `meta()`
- [ ] Row-dependent tests use `requireRows()`; data-sensitive ones record `rowsChecked()`
- [ ] Known defects annotated with `bug()`; questions with `productQuestion()`
- [ ] Keyed-screen smoke for every screen
- [ ] Scheduled CI run enabled; `trendBaseline` set

## Choosing the API auth scheme
| The platform uses | `auth.api.kind` |
| --- | --- |
| OAuth2/OIDC service account | `oidc-client-credentials` |
| OIDC with a user's password (test realms) | `oidc-password` |
| Same-origin API behind the web session | `session-cookie` |
| API key header | `api-key` |
| A long-lived bearer token | `bearer-env` |
| HTTP basic | `basic` |
| Open (rare) | `none` |

## When the environment is restored or redeployed
Run the Sentinel. Expect AMBER. Then: Data steward reloads the matrix, Observer re-captures the
screens the Sentinel names, the QA lead refreshes secrets if auth is RED. Save a new baseline only
after the business confirms the data is loaded.
