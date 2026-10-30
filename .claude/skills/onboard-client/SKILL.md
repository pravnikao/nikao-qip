---
name: onboard-client
description: Set up Nikao QIP for a new client platform, from an empty client pack to the first baseline run. Use when starting a new engagement or pointing the framework at a new environment.
---

# Onboard a client platform

Goal: a first baseline run on the client's test environment, with every screen mapped and every skip explained.

## Day 1: configure (QA lead + Architect)
1. Copy `templates/client-pack/` over `client-pack/` (keep the demo pack in a branch for showcasing).
2. Fill `client-pack/config/client.config.ts`: environments (baseUrl, graphqlUrl and/or restBaseUrl, openApi, healthUrl, loginUrlPattern, allowWrites), auth (ui: form/basic/none; api: one of the 7 schemes), roles (one main driver, fresh-login roles), tenancy (ui and api), screens (title, route, aliases, specPatterns), defect tracker pattern.
3. Put credentials in `.env` (never committed) and in CI secrets. Agents never read them.
4. Write `.qip-leak-terms` (client names, hostnames, ids; kept out of git) and run `npm run qip:leak-scan` before sharing anything outside the engagement.
5. `npm run typecheck && npm run test:unit` must pass.

## Day 1: check the environment (Sentinel)
6. `npm run qip:sentinel -- --update-baseline` until GREEN. RED means credentials or the environment: fix before anything else.

## Days 2–3: capture and probe (Observer, Prober, Data steward)
7. Architect writes one Observer brief per screen (`templates/brief.md`). Observer writes `docs/captures/<screen>-<date>.md`.
8. Prober sizes each screen's data and checks the contract (OpenAPI or GraphQL introspection).
9. Data steward turns the business data matrix into `client-pack/data/data-sheet.json` and one probe per screen; `npm run qip:probes` reconciles.
10. Architect writes FRs per screen into `docs/fr-status.md` from the captures.

## Days 3–5: build (Builders, in parallel on separate files)
11. Page objects first (`client-pack/pages/`), then specs per layer: api, ui, e2e. Smoke every screen with `keyedScreenSmoke`.
12. Every row-dependent test probes first; every defect is annotated; every skip is categorised.

## First baseline (Reporting)
13. `run-suite` skill, then `npm run qip -- history add --label baseline`.
14. Set `trendBaseline[env]` in the config to the baseline date. Build the BAU pack and walk the business through it.
