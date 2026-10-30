# Nikao QIP — Quality Intelligence Platform

An agent-ready Playwright framework for testing web platforms with GraphQL and/or REST APIs:
classified results instead of red and green, defects tracked from first failure to business sign-off,
and a team of Claude agents working inside clear, enforced boundaries.

```
npm ci
npx playwright install chromium
cp .env.example .env
npm run demo          # the whole loop against the bundled demo platform, offline
```

No time to run it? `samples/` holds the two workbooks from a demo run.

`npm run demo` runs the suite twice against a small holdings platform: once "before migration", then
again with planted defects. It produces `reports/QIP-Run-Report-*.xlsx` and
`reports/QIP-BAU-Review-*.xlsx`. In them you will find: two regressions in the REST contract, a UI
page-size regression, a renamed button with a locator-drift suggestion, a data defect, a product
question, read-model lag reported as infrastructure (not a product failure), a cascade skip, a
data-absent skip, one defect ready to close, and two held back because their passes do not prove a fix.

## What it does

| Capability | Where |
| --- | --- |
| Every result classified: known defect, product question, unlinked, infrastructure, setup, flaky; 8 categorised skip reasons and a build check | `core/classify`, `core/reporter` |
| Defect lifecycle: New → Active → ready to close → Closed, with business verdicts that the framework never overrides | `core/report/defect-state.ts` |
| Closure rule that refuses vacuous passes (0 rows checked), data-sensitive checks on thin data, and intermittent defects | same |
| Regression detection against any baseline run (e.g. the last run before a migration) | `core/report/history.ts` |
| GraphQL adapter: gateway-style 401s, labelled timeouts, introspection and schema diff | `core/api/graphql-client.ts` |
| REST adapter: 7 auth schemes, tenancy, safe retries (Retry-After, idempotency keys), problem+json, zod contracts, 4 pagination styles with runaway/duplicate guards | `core/api/rest-client.ts` |
| OpenAPI contract checks, operation coverage and spec diffs, no extra dependency | `core/api/openapi.ts` |
| Data sheet with date tokens (`{{previousBusinessDay}}`, `{{currentQuarter}}`) and probes that never mistake an outage for "no data" | `core/data` |
| Multi-tenant scope handling with `[scope-leak]` detection | `core/tenancy` |
| Locator drift: suggest, don't heal | `core/ui/drift.ts` |
| API p50/p95 per operation from every run | `core/perf` |
| Sentinel: health, latency, schema, OpenAPI and screen-hook drift → GREEN / AMBER / RED | `core/sentinel` |
| Run report and business review pack (Excel) | `core/report` |
| Eight Claude Code agents, guard hooks, eight skills | `.claude/` |

## Using it for a client
See `docs/onboarding-playbook.md`. In short: replace `client-pack/` with `templates/client-pack/`,
fill in `client-pack/config/client.config.ts`, run the Sentinel, then let the Observer, Prober and
Data steward capture the platform before Builders write tests.

## Commands
| Command | Does |
| --- | --- |
| `npm run typecheck` / `npm run test:unit` / `npm run test:hooks` | Framework checks (also `npm run ci:local`) |
| `npx playwright test [--project=api|ui|e2e]` | Run the product suite (takes the session lock) |
| `npm run qip:report [-- --baseline <label>]` | Run workbook + build check |
| `npm run qip -- history add [--label x]` | Save a run snapshot (closure and regression evidence) |
| `npm run qip:bau-pack [-- --baseline <label>]` | Business review pack |
| `npm run qip:probes` | Data probes against the data sheet |
| `npm run qip:sentinel [-- --update-baseline]` | Environment and change watch |
| `npm run qip:lock -- status|acquire|release --as <name>` | Session lock |
| `npm run qip:drift` | Locator drift suggestions from the last run |
| `npm run qip:leak-scan` | Fails if client-identifying terms appear (terms in `.qip-leak-terms`) |

## Documentation
- `CLAUDE.md`: the rulebook every agent and session follows
- `docs/architecture.md`: how the parts fit
- `docs/agent-model.md`: the agents, their roles and boundaries
- `docs/onboarding-playbook.md`: from a new client to the first baseline
- `docs/adapters.md`: GraphQL and REST adapters, contracts, pagination, tenancy, auth
- `docs/reporting.md`: outcomes, defect states, the closure rule, the BAU pack
