# API adapters

Both adapters: auth for the configured scheme, tenant per call, timeouts labelled
`GATEWAY-TIMEOUT` (reported as infrastructure), one retry with a fresh token after a 401, timings for
p50/p95, and a redacted request log that is attached to failing tests.

## REST
```ts
const r = await rest.get<Page>('/positions', { query: { page: 1, size: 20 }, tenant: 'alpha', schema: PageSchema });
r.status; r.data; r.ms; r.problem;              // problem = RFC 9457 body for problem+json errors

await rest.get('/health', { anonymous: true, expectStatus: 401 });   // negative tests
await rest.post('/comments', body, { idempotencyKey: true });        // safe to retry
RestClient.path('/positions/{id}', { id });                          // encoded path params
```
- **Success** is any 2xx unless `expectStatus` says otherwise. Otherwise a `RestError` names the
  method, URL, status and problem title/detail.
- **Retries**: GET and HEAD retry twice on 429/502/503/504 and network errors, honouring
  `Retry-After`, with jittered backoff. POST/PATCH retry only with an idempotency key. Timeouts are
  never retried: they are reported.
- **Contracts**: pass a zod `schema` (typed result, `CONTRACT —` error listing every mismatch), and/or
  check against the OpenAPI document:
  ```ts
  const contract = await OpenApiContract.fetch(env.openApi);
  contract.assertConforms(response);   // status documented, content type, body schema
  contract.coverage();                 // documented operations exercised by this process
  ```
  The validator covers type, nullable, required, properties, additionalProperties: false, items,
  enum, oneOf/anyOf/allOf, $ref, min/max, lengths, pattern, date and date-time.
- **Pagination**: `collectAll(path, strategy)` with `page`, `offset`, `cursor` or `link-header`.
  It stops runaway paging (`maxPages`) and throws when a page repeats an earlier one: both are
  real defects.

## GraphQL
```ts
const d = await gql.data<Docs>(QUERY, { search: 'CA' });     // throws GraphQLRequestError on errors
const r = await gql.execute<Docs>(QUERY, vars, { anonymous: true });
isUnauthorised(r);                                             // gateway 200 + UNAUTHENTICATED counts
const types = await gql.introspect();                          // schema contract and Sentinel diff
```
`execute` keeps `errors` for tests that assert on them; `data` throws with every error's message,
code and path.

## Tenancy
`tenancy.api`: `header` (e.g. `x-tenant`), `query` or `variable`. Every call takes `tenant`; the
default comes from the config. `tenancy.ui: 'ui-switch'` plus a `TenantSwitcher` in
`client-pack/support/` makes `BasePage.open()` correct a fresh session that landed on another tenant,
logging `[scope-leak]`.

## Writes and read models
After a write on an event-sourced platform, read back with
`eventually('what', () => readSide(), { timeoutMs: cfg.timeouts.readModelMs })`. Lag beyond the
budget fails as `READ-MODEL-LAG`: infrastructure, with the wait time, for dev.
