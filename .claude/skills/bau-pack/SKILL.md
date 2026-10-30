---
name: bau-pack
description: Build the business review pack (closure list, defects by screen and group, regressions, defects to raise, product questions) and record the decisions that come back. Use before each business review.
---

# BAU pack

1. `npm run qip:bau-pack -- --baseline <label|runId|date>` (the baseline is the run you compare against, e.g. the last run before a migration).
2. Check the Summary sheet: totals per screen and group. Read every "Needs triage" row; run the `triage-run` skill first if there are many.
3. Send the pack to the QA lead. Do not send it to the client yourself.
4. When it comes back marked up:
   - "Close" → add `{ verdict: 'Retest Pass', date, by }` to `client-pack/data/bau-verdicts.ts`
   - "Not a defect" / "Duplicate" → the same, with that verdict (and `duplicateOf`)
   - "Raise ticket" → when the ticket number arrives, add it to the defect's `tickets` in `client-pack/data/defects.ts`
   - "Test to fix" → brief a Builder
   - Questions answered → brief a Builder to turn the product question into an assertion, or into a defect
5. Never record a decision the business did not make.
