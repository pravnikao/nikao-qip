---
name: capture-screen
description: Observer procedure for capturing one live screen (hooks, network calls, states, text) into docs/captures. Use before writing or fixing a page object, or when the Sentinel flags a changed screen.
---

# Capture a screen

1. Open the app in the isolated browser (Playwright MCP) and sign in with your own credentials from the brief. Never the suite's saved session.
2. Switch to the tenant named in the brief and confirm it on screen.
3. Open the route. Record: heading, every `data-qa` (use `document.querySelectorAll('[data-qa]')`), grouped as filters / grid / row / cell / dialog / pagination.
4. For each action in the brief (search, sort, page, open dialog, close dialog): record the network calls it makes. GraphQL: operationName, variables, status, ms. REST: method, path, query, status, ms. Note extra or repeated calls (e.g. a refetch on dialog close).
5. Record the three states with exact text: loading, empty (use a search that matches nothing), error (only if it occurs naturally; never force one by writing data).
6. Note anything that looks wrong as an observation with evidence: what you did, what you saw, what the API returned.
7. Write `docs/captures/<screen>-<yyyy-mm-dd>.md` from `templates/capture.md`. Do not write anywhere else.
8. Report with `templates/report.schema.json`.

Never submit a form that writes (save, delete, close, assign, upload) unless the brief names that exact action and says the QA lead approved it.
