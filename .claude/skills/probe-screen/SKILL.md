---
name: probe-screen
description: Prober procedure for interrogating one screen's API (GraphQL or REST): row counts at the data anchor, field values, contract and error payloads. Use to confirm a suspected defect at API level or size data before tests are written.
---

# Probe a screen's API

1. Confirm `QIP_ENV` is not production. Stop if it is.
2. Read the screen's entry in `client-pack/data/data-sheet.json` for the anchor.
3. Write a disposable script under `docs/probes/` using the adapters:
   - GraphQL: `const g = await GraphQLClient.create(); await g.execute(DOC, vars)` (keep `errors`; an error is a finding).
   - REST: `const r = await RestClient.create(); await r.get(path, { query, tenant })`; for contracts `(await OpenApiContract.fetch(url)).check(response)`.
   - Paging: `r.collectAll(path, { kind: 'page' | 'offset' | 'cursor' | 'link-header', ... })` reports repeats and runaway paging.
4. Run it with `npx tsx docs/probes/<file>.ts`. Record request, status, timing, the relevant response fragment, and the conclusion in `docs/probes/<topic>-<date>.md`.
5. For a suspected defect, give the smallest request that reproduces it, and what the expected value would be and why (FR, contract or business rule).
6. Never write data unless the brief names the write and the QA lead approved it. Never print secrets.
