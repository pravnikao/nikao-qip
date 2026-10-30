---
name: run-suite
description: Run the product suite safely (Sentinel first, session lock, report, history) and hand the results to Reporting. Use for any full or partial run against an environment.
---

# Run the suite

1. `npm run qip:sentinel`. RED: stop and report. AMBER: tell the Architect what changed before trusting results.
2. `npm run qip -- lock status`. If someone else holds it, wait. Never delete it.
3. Run with your instance name: `QIP_INSTANCE=<you> QIP_ENV=<env> npx playwright test [--project=api|ui|e2e] [files]`. On a shared environment add `--grep-invert @creates-data` unless the QA lead approved writes. The global setup takes and releases the lock.
4. `npm run qip:report` (the build check must pass: every skip categorised).
5. For a baseline or a full scheduled run: `npm run qip -- history add [--label <name>]`.
6. Report: totals per layer, pass rate executed and with known defects expected, the build check, the largest unlinked groups, and the report path.
