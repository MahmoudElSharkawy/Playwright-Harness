---
name: execute-test
description: Execute an ADO suite or story through live browser, API and database runtimes, without generating automation code. Produce verified reports and optionally file bugs or publish suite outcomes.
---

# Execute manual tests

Resolve [ROOTS](../ROOTS.md) first. Run the consumer's installed CLI with
`npx --no pom-harness execute`; use [automate-test](../automate-test/SKILL.md)
when the request includes durable POM code generation.
Use [maintain-test](../maintain-test/SKILL.md) to investigate prior failures or
reassess blocked cases before resuming this execution workflow.

Accept `/execute-test suite <id> [plan <id>] [on <environment>] [checkpoint]`
or `/execute-test story <id> [on <environment>]`. Execute sequentially, pausing
on blockers. In checkpoint mode, pause after each case. Authorization already
given by the user remains in force for ordinary permitted application operations.

1. Run `prepare suite|story <id> [--plan <id>] [--environment <name>] [--checkpoint]`.
   Read the captured source and exclusions. Edit only its draft `refinement.json`,
   following [refinement](references/refinement.md); then run `freeze <exec>`.
   Complete required login, API/DB operations, provenance and cleanup declarations.
   Resolve `readiness.ready: false` for the selected scenario before starting it.
2. Read [protocol](references/protocol.md) and [verdicts](references/verdicts.md).
   Run `next <exec>` and drive its live commands. Adapt to the observed UI using
   fresh refs. Every expected condition needs a check, grounded observation or
   explicit unresolved reason. Actions alone do not establish a pass.
   Use the returned `startUrl` and pause between cases when `checkpoint` is true.
3. Repeat `next` until complete. Use `resume` or `next --rerun <scenario>` after
   an interruption or integrity failure. Report remaining blockers candidly.
4. Always run `report <exec>` before the final response, including failed, blocked,
   interrupted or partially completed work. A captured source can be reported before
   freeze. For blockers not already recorded by execution/readiness, supply source-bound
   notes with `report <exec> --input <consumer-notes.json>` following
   [reporting](../../../docs/reporting.md#case-results-and-blocker-notes).
   Link the returned `html` directly and summarize case counts, failure/blocker reasons,
   methods, defects and cleanup dispositions. Include the report in a related PR
   when PR delivery is part of the work, following the
   [report handoff](../../../docs/reporting.md#skill-report-handoff).
   Share this single case report with its Summary and Defects companions; attempt
   evidence is already inside its case details.
   If report delivery fails, state that separately from case outcomes. Report output is ignored consumer storage; never generate
   framework, tracker or legacy verification files on this route.
5. Read [delivery](references/delivery.md) only when ADO delivery is requested.
   Preview first. External writes require `--execute`; the request must authorize
   the concrete delivery. Story scope supports bugs only.
