---
name: retest-round
description: Check which defects can close (consecutive clean runs with real data) and which closed defects fail again, then prepare the closure list for the business. Use after each scheduled run or when dev says fixes have landed.
---

# Retest round

1. Make sure the last runs are in `history/<env>/` (`npm run qip -- history list`).
2. `npm run qip:report` → Defects sheet, "Ready to close?" column and the Check column.
3. For each "Ready to close": give the Verifier the defect ref, its linked tests and the run ids. Accept only CONFIRMED.
4. Hold (do not propose) any defect that is intermittent, whose passes checked 0 rows or fewer than its `dataSensitive.minRows`, or whose screen the business has flagged as broken.
5. For each "Closed but failing: reopen?": confirm with the Observer or Prober that it is the same behaviour, then propose a reopen. Never reopen on a single run that failed on the environment.
6. `npm run qip:bau-pack`: the Closure list sheet is the proposal. The business decides; record their decisions in `client-pack/data/bau-verdicts.ts`.
