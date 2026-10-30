# Architecture

```
                 ┌──────────────── client-pack/ (per client) ────────────────┐
                 │ config/client.config.ts   environments, auth, tenants,    │
                 │                           screens, tracker, closure rule  │
                 │ data/                     data sheet, probes, defects,    │
                 │                           business verdicts, renames      │
                 │ pages/  support/          page objects, tenant switcher   │
                 │ tests/api|ui|e2e          specs                           │
                 └───────────────────────────────┬────────────────────────────┘
                                                 │ uses
┌───────────────────────────────── core/ (generic) ─────────────────────────────────┐
│ config   lazy env, validated client config                                        │
│ auth     UI sign-in + saved sessions, 7 API auth schemes, AUTH-EXPIRED detection   │
│ tenancy  UI switch with [scope-leak] detection; header/query/variable for APIs    │
│ api      GraphQL client · REST client · OpenAPI contract · shared plumbing         │
│ data     date tokens · data sheet · probes (requireRows)                           │
│ ui       BasePage · DataGrid · network capture · smoke · locator drift             │
│ defects  bug(), productQuestion(), rowsChecked(), categorised skips, setupStep()   │
│ classify outcomes and rules (pure, unit-tested)                                    │
│ reporter Playwright reporter → reports/qip/results-<project>.json                  │
│ report   history · defect states · closure · regressions · clusters · workbooks    │
│ perf     per-operation timings                                                     │
│ sentinel health, latency, schema/spec/hook drift                                   │
│ run      session lock · global setup/teardown · eventually() · health              │
└───────────────────────────────────────────────────────────────────────────────────┘
```

## The flow of one run
1. **Sentinel** (optional, CI does it first): RED stops the run; AMBER flags changes.
2. **Global setup**: takes the session lock, checks health and API credentials (fails fast with
   ENV-UNAVAILABLE), signs each needed role in once and saves its session.
3. **Tests** run through `core/fixtures.ts`, which adds `gql`, `rest` and `pageAs(role)`, and after
   each test attaches API timings, the last redacted request/response pairs on failure, and locator
   drift suggestions on failure.
4. **Reporter** classifies every test (including ones that never ran) and writes one results file per
   project. Each record has a stable key that survives renames, its screen, FRs, defect refs, rows
   checked, product question, timings and drift suggestions.
5. **Global teardown** releases the lock (only if this run holds it).
6. **qip report** builds the run workbook and applies the build check. **qip history add** saves a
   snapshot. **qip bau-pack** builds the business pack against a baseline.

## Design rules
- **Nothing client-specific in core/.** The leak scan checks shared material for client terms.
- **Lazy configuration.** No module reads the environment at import time (a unit test enforces it).
- **Errors carry their class in their text.** `GATEWAY-TIMEOUT —`, `READ-MODEL-LAG —`,
  `AUTH-EXPIRED —`, `ENV-UNAVAILABLE —`, `SETUP-FAILED —`, `GRID-UNSETTLED —`, `CONTRACT —`.
  The classifier reads them; people can read them too.
- **Evidence over opinion.** Every closure, regression and drift suggestion points at runs, rows and
  requests. Nothing heals itself.
- **People decide.** Business verdicts are recorded, never computed.

## Extending
- A new API style: add an adapter under `core/api/` that records timings (`recordPerf`), logs
  redacted exchanges (`logExchange`) and labels timeouts `GATEWAY-TIMEOUT`.
- A new outcome or skip category: change `core/classify/` with unit tests, then the workbook legend.
- A new report sheet: `core/report/workbook.ts` or `bau-pack.ts`; keep the decision drop-downs.
