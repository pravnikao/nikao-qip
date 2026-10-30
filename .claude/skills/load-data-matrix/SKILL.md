---
name: load-data-matrix
description: Data steward procedure to load a new business data matrix into client-pack/data/data-sheet.json and reconcile it with probes. Use when the business sends a new matrix, after an environment restore, or when data-absent skips look wrong.
---

# Load a data matrix

1. Diff the new matrix against `docs/data-matrix.md`. List every changed screen; nothing else changes.
2. For each changed screen, update `client-pack/data/data-sheet.json` for the environment:
   - anchors as tokens where the business says "today", "previous business day", "current quarter" (`{{today}}`, `{{previousBusinessDay}}`, `{{currentQuarter}}`); fixed dates where they loaded a fixed day
   - the right field for each screen (a price date is not a trade date)
   - status: `data`, `data-absent` ("need to load"), `product-issue` with `blockedBy` (the business says it is a bug), `not-applicable`
   - `notes`: source and date of the matrix line
3. `npm run test:unit` (the sheet schema test must pass).
4. `npm run qip:probes`. For every `!` (sheet and data disagree) or `E` (API error), write one line for the business with the anchor and the count.
5. Update `docs/data-matrix.md` and report: screen → anchor → rows, plus the disagreements.
