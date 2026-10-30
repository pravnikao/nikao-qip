# Brief: <short title>

**For:** <agent: observer | prober | builder | data-steward | reporting | verifier | sentinel>
**From:** Architect · **Date:** <yyyy-mm-dd> · **Environment:** <QIP_ENV>

## Goal
<One or two sentences: the outcome, not the steps.>

## Evidence already in hand
- <capture / probe / run id / report row, with paths>

## You own (may edit)
- <exact files or folders; nothing else>

## Out of scope
- <what not to touch or decide>

## Rules that apply
- Never commit. Hold the session lock for runs; delete it only if it names you.
- Annotate, don't guard. Skips use the categorised helpers.
- typecheck before and after; run the affected specs once, retries 0.
- No secrets in output (first 4 characters at most).

## Report
JSON matching `templates/report.schema.json`, plus a short human summary: what changed, before → after counts, anything needing the QA lead's decision.
