---
name: triage-run
description: Reporting procedure to turn a finished run's unlinked failures into decisions (raise a defect, fix a test, environment, product question). Use after every run that has unlinked or setup failures.
---

# Triage a run

1. Open the newest `reports/QIP-Run-Report-*.xlsx` → Triage sheet → "Failures with no defect reference, grouped".
2. For each group, decide with evidence:
   - **Environment**: GATEWAY-TIMEOUT, READ-MODEL-LAG, AUTH-EXPIRED, ENV-UNAVAILABLE. Collect operation names and timings for dev; no defect.
   - **Test fix**: the screen changed (check the Locator drift sheet and the Sentinel's hook diff), or the test ran without data it needs. Brief a Builder.
   - **Defect**: the product is wrong. Ask the Prober (API) or Observer (screen) to confirm, allocate the next free BUG ref, add it to `client-pack/data/defects.ts`, brief a Builder to annotate with `bug()`. One canary test per defect; dependent tests skip with `skipBlockedByDefect`.
   - **Product question**: the expected behaviour is unclear. Brief a Builder to add `productQuestion()`; it goes to the business in the BAU pack.
   - **Regression** (passed in the baseline): raise as a defect first; these are the most important.
3. Never reclassify by hand. If the classifier is wrong, change its rules with a unit test.
4. Report: group → decision → owner → brief written.
