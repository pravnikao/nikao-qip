# Agent model

One person leads; eight Claude agents do the work in their lanes. Definitions live in
`.claude/agents/`; the rules that must never be broken are enforced by `.claude/hooks/guard.mjs`
(git, secrets, the session lock, owned paths, writes to shared environments).

| Agent | Role | Key boundary | Why it exists |
| --- | --- | --- | --- |
| **QA lead** (human) | Intent and requirements; git; CI secrets; irreversible writes; product and business decisions | Never hands those decisions to an agent | Some calls are judgement and accountability: what ships, what is a defect, what may be written to a shared environment |
| **Architect** | FRs with live status, a brief per agent, run order and the lock between agents, reviews every report | Accepts nothing without evidence; never commits; never assigns a BUG ref without evidence; never overrides a business verdict | Without one owner of sequencing, parallel agents edit the same files and runs collide |
| **Observer** | Live screen captures: hooks, network calls, empty and error states, text | Read-only; own fresh login; never the suite's session during a run | Screen changes after a deployment can only be pinned down live; a capture separates "screen stalls" from "no data" |
| **Prober** | API interrogation: contracts, values, counts, error payloads, introspection | Never production; read-only unless a write was approved; own credentials | Proves a defect at API level, sizes data, and catches stale credentials before they look like product failures |
| **Builders** (parallel) | Page objects, specs, test data, tooling from confirmed FRs and captures | Own files only; never commit; hold the lock; annotate, don't guard; never weaken an assertion | Parallel work in one tree needs explicit ownership; annotate-don't-guard keeps defects visible |
| **Reporting** | Classifier, workbook, trends, history, BAU pack; expectations before a run, reconciliation after; defect states on evidence | Never changes tests or reclassifies by hand; never counts a vacuous pass; intermittent defects close on dev confirmation | Turns hundreds of results into a handful of decisions, without false closures |
| **Verifier** | Independent check of a claim: fix, closure, classification | Never fixes; answers CONFIRMED / REFUTED / INCONCLUSIVE with evidence | The author of a change is the worst judge of it |
| **Sentinel** | Health, auth, latency, GraphQL schema, OpenAPI and screen-hook drift; GREEN / AMBER / RED | Read-only; own login | Restores, deployments and stale secrets otherwise surface as hundreds of failures |
| **Data steward** | The business data matrix as `data-sheet.json`, one probe per screen, reconciliation | Creates no business data without agreement; never turns a bug into "no data" | After a restore, data is the main source of failures; someone must own it |

## How work moves
1. The QA lead states the intent. The Architect writes briefs (`templates/brief.md`).
2. Observer and Prober gather evidence; the Data steward confirms the data.
3. Builders change tests, each in its own files, one run at a time under the lock.
4. Reporting builds the report and the BAU pack; claims of "fixed" or "ready to close" go to the
   Verifier first.
5. The QA lead reviews, commits, and takes the pack to the business. Business decisions come back
   as verdicts and ticket numbers.

Every agent ends with a JSON report (`templates/report.schema.json`), so reports can be checked by
machine and collected by CI (`.github/workflows/agent-triage.yml`).

## Running agents
- Interactive: in Claude Code, ask for an agent by name ("use the observer to capture Documents").
- Headless (CI or scripts): `claude -p "<task>" --output-format json --json-schema "$(cat templates/report.schema.json)"`.
- Parallel Builders: give each a brief that owns different files. The guard hook refuses writes
  outside a builder's owned paths (`.claude/hooks/ownership.json`).
