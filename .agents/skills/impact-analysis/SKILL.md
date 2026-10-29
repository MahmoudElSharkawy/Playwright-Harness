---
name: impact-analysis
description: Identify affected areas and recommend regression scope for selected story, bug-fix, requirement, application or framework changes. Use for impact-only analysis; failure diagnosis, automation repair and blocked-test recovery belong to maintain-test.
---

# Change impact analysis

Use the shared [tracker provider contract](../../../docs/tracker-providers.md) for
Azure, Jira with Xray or Zephyr Scale, and Jira without a plugin. Keep the same
workflow and gates; select native adapters and preserve the captured source identity.

Resolve this linked skill to its real path. Read [ROOTS](../ROOTS.md).

## Choose the owner before analysis

- Diagnose failures/flakes, repair automation or recover blocked tests, including
  combined analysis-and-repair requests: [maintain-test](../maintain-test/SKILL.md)
  owns the entire workflow. It uses the same comparison procedure in its existing
  assessment/history; no standalone impact run or second assessment is required.
- Run the recommended regression: the existing [execution](../execute-test/SKILL.md)
  or [automation](../automate-test/SKILL.md) workflow and its current gates.
- Design missing coverage: [test-case-design](../test-case-design/SKILL.md), with
  separately selected scope. Draft/file a bug: [bug-report](../bug-report/SKILL.md).

A story/bug ID or attached failure report alone does not select maintenance.
If asked only to choose workflows, return the requested owners and next actions;
do not perform the comparison, construct an impact map or inspect extra histories
or cohorts to explain routing. Save that routing response only if requested.
Continue below only when identifying affected areas/regression scope is requested.

## Analyze the selected impact

Follow the [shared source/caller procedure](../../../docs/impact-analysis.md#source-and-caller-comparison).
Use selected text, local documents/snapshots or exact IDs/links through existing
supported, configured read-only intake. No failed test is required.

Identify the selected project/item, source revisions or fingerprints, baseline,
proposed/observed delta and acceptance status. Keep accepted requirements, proposals,
reported symptoms and observed changes separate. Missing fix/baseline evidence
permits a useful partial assessment; a resolved bug proves no fix, deployment or
successful retest. Ask only for missing information essential to proceed.

Trace affected requirements, cases/specs and relevant methods, locators, data,
configuration and external contracts with direct/indirect dependency paths and
source references. Validate current callers rather than trusting stale mappings.
Explain confirmed, dismissed and uncertain impacts; a confirmed dependency does
not verify a fix. Check existing coverage for reuse before recommending separately
scoped test design. Validate incoming test-design flags without expanding that
design's selected requirements or authorizing case changes.

Record changed plan-baseline or diagnostic-cohort inputs and recommend the owning
workflow's reassessment. Do not infer a failure cause or flakiness from changed
builds, fixtures, requirements or mixed outcomes.
The plan owner can use [test-planning](../test-planning/SKILL.md) to revise affected
scope, estimates and criteria; the recommendation performs no revision or handoff.

Save a compact sanitized [report](../../../docs/impact-analysis.md#report) under the
consumer's `.harness/runs/impact-analysis/<analysis-id>.md`, preserving earlier
reports. Source reads and targeted repository searches are evidence operations.
The requested report is the only workflow output: do not run tests/diagnostics,
edit source/cases/expectations, approve requirements, alter maintenance history or
budgets, publish results, update a tracker or execute a recommended handoff.

Recheck provenance and affected source revisions before reusing earlier impact
findings; matching IDs alone do not establish freshness.
