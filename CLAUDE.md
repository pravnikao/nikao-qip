# Nikao QIP: rulebook for every agent and session

This repository is a test framework for a client platform. People and agents work in it together.
The rules below apply to everyone. The hooks in `.claude/hooks/guard.mjs` enforce the critical ones.

## Who does what
| Role | Owns | Never |
| --- | --- | --- |
| **QA lead** (human) | Intent and requirements; git (stage, commit, push, merge); CI secrets; every irreversible write to a shared environment; product and business decisions | Hands those decisions to an agent |
| **architect** | FRs with live status, briefs, run order and the lock between agents, reviewing every report | Accepts anything without evidence; commits; assigns a BUG ref without evidence; overrides a business verdict |
| **observer** | Live screen captures (`docs/captures/`) | Changes the app or its data; reuses the suite's session during a run |
| **prober** | API interrogation (`docs/probes/`) | Touches production; writes without approval |
| **builder** | Page objects, specs, support code (`client-pack/pages`, `client-pack/tests`) | Edits files outside its brief; weakens an assertion; commits |
| **data-steward** | `client-pack/data/data-sheet.json`, probes, `docs/data-matrix.md` | Creates business data without agreement; turns a bug into a "no data" skip |
| **reporting** | Classifier, reporter, workbook, history, BAU pack, defect registry and verdict records | Changes tests; reclassifies by hand; contradicts a business verdict |
| **verifier** | Independent confirmation of fixes, closures, classifications | Fixes anything |
| **sentinel** | Environment health, latency, schema/spec/hook drift | Edits tests |

## The decision tree for a failing test
1. **Environment?** GATEWAY-TIMEOUT, READ-MODEL-LAG, AUTH-EXPIRED, ENV-UNAVAILABLE → infrastructure. Tell the Sentinel/dev. Change nothing in the test.
2. **The screen changed?** (drift suggestion, Sentinel hook diff, capture) → it is a test update once the Observer confirms the change is intended.
3. **No data?** Probe first. Real absence → `requireRows()` skips DATA-ABSENT. Data that cannot exist because of a defect → `product-issue` + `blockedBy` in the data sheet; dependants skip BLOCKED-BY-DEFECT; one canary test carries `bug()`.
4. **Unclear expectation?** → `productQuestion()`. The assertion stays.
5. **The product is wrong?** → confirm with the Prober or Observer, add to `client-pack/data/defects.ts`, annotate with `bug('BUG-UI-NNN', { priority })`. The test keeps failing until the fix lands.

**Annotate, don't guard.** Never `test.skip` a confirmed defect. Never weaken an assertion to pass.

## Working rules
- `npm run typecheck` before and after every change. Run the affected specs once with retries 0. A fix is not done until it has run.
- Read a file before editing it. Never apply a change from memory.
- Verify claims against the live app or API before trusting them. Flag contradictions; do not fix around them.
- Narrow scope: change only what the brief names.
- One run at a time: the session lock (`npm run qip -- lock status`). Delete it only through `qip lock release --as <you>`, and only if it names you.
- Use the main driver role for tests; fresh-login roles only for login tests.
- Never read `.env` or saved sessions; never print secrets (first 4 characters at most).
- Business (BAU) verdicts are final unless the business changes them.
- Reports: JSON per `templates/report.schema.json`, plus a short plain-English summary with counts.

## Where things are
- `core/`: the framework (no client specifics). `client-pack/`: everything about the client platform.
- `docs/`: architecture, agent model, onboarding playbook, adapters, reporting. `templates/`: briefs, reports, captures.
- `npm run demo`: the whole loop against the bundled demo platform.
