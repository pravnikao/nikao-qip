# Reporting

## Outcomes
| Outcome | Meaning | Counts as |
| --- | --- | --- |
| Pass | Passed | pass |
| Pass – defect annotated | Passed while linked to a defect | pass; closure evidence |
| Flaky | Failed, then passed on retry | pass for rates; never closure evidence |
| Fail – known defect | Failed on a recorded defect | expected failure |
| Fail – product question | The expected behaviour needs a business answer | expected failure |
| Fail – unlinked | Failed with no defect reference: triage it | failure |
| Fail – infrastructure | GATEWAY-TIMEOUT, READ-MODEL-LAG, AUTH-EXPIRED, ENV-UNAVAILABLE, network | not a product result |
| Fail – setup | A setup step failed (`setupStep`, beforeAll) | not a product result |
| Skip – Data absent / Blocked by defect / Blocked (env / access) / Not deployed / Not applicable / Not automated / Deferred / Blocked by earlier failure | Categorised skips | skip |
| Skip – No reason recorded / Other | Fails the build check | — |

Pass rates are reported two ways: **executed** (known defects count as failures: the product view)
and **known defects expected** (suite health).

## Defect states
| State | Rule |
| --- | --- |
| Closed | A business verdict of Retest Pass, Not a defect or Duplicate. Never computed. |
| Active | Has a ticket in the client's tracker |
| New | No ticket; first seen within `newDefectDays` |
| Active – Unlinked | No ticket and older: raise it or close it |

## The closure rule
A defect is **ready to close** only when the last `cleanRunsRequired` runs each exercised it and every
linked test passed, with:
- no vacuous passes: `rowsChecked` > 0, or ≥ `dataSensitive.minRows` for paging/sort/count checks
- no flaky passes
- the defect not marked `intermittent` (those close on dev confirmation)

"Closed but failing: reopen?" flags a closed defect whose test fails again. "Environment failed:
retest" flags a defect whose tests only failed on infrastructure this run.

## Regressions
`--baseline <label|runId|date>` compares with a saved run (`qip history add --label pre-migration`).
A regression is a test that passed in the baseline and fails now for a product reason. Environment
and setup failures are never regressions.

## The BAU pack
| Sheet | For |
| --- | --- |
| Summary | Screens × groups: Mapped, New – regression, New – data issue, New – functional, New – flaky / environment, Needs triage, Closed |
| Closure list | Close / Hold (one more clean run) / Hold (intermittent), with reasons |
| Defects by screen | Every defect and failure group with tests linked, current results, regressed tests and a decision drop-down |
| To raise | Defects with no ticket that still fail, with evidence |
| Questions | Product questions with what the screen does now |

Decisions come back as verdicts in `client-pack/data/bau-verdicts.ts` and ticket numbers in
`client-pack/data/defects.ts`.
