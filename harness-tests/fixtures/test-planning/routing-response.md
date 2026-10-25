# Workflow ownership capture

Source: [the eleven selected routing requests](inputs/routes.md). This is a routing answer, not a cycle plan. No co-located histories or candidate records were assessed.

| Request | Owning workflow | Next action and compulsory-workflow boundary |
| --- | --- | --- |
| 1. Explicit two-day cycle planning | test-planning | Prepare a source-grounded scope, risk, strategy, feasibility and criteria draft from the selected evidence. Planning is the requested work; no additional sibling becomes compulsory |
| 2. Two-day scope, risks, prerequisites and completion evidence | test-planning | Plan those cycle decisions, including capacity and evidence gaps. The requested outcome selects planning even without the skill name |
| 3. Individual positive/negative cases | test-case-design | Design/reuse source-grounded cases, review coverage and obtain only any required publication decision. This owner is required by case-design work; a separate plan is optional |
| 4. Automation tracker from verification receipts | plan-tracker | Reconcile the selected current receipts and record actual progress under tracker rules. A planning artifact supplies no actual status event |
| 5. Execute selected ADO cases on qa | execute-test | Bind selected cases and target, establish required runtime/readiness authority, then execute and report under the execution workflow. No prior cycle plan is compulsory |
| 6. Generate durable automation from accepted local scenarios | automate-test | Use the scoped generation workflow, accepted source mappings and existing implementation/review/verification gates. A plan is optional input |
| 7. Diagnose only a CI test failure | maintain-test, diagnose-only mode | Inspect the selected failure evidence within maintenance's assessment/history and budget boundaries; return supported diagnosis and next actions. No repair or standalone planning/impact run is automatically authorized |
| 8. Changed areas and recommended regression scope only | impact-analysis | Read-only comparison of the selected change and supported dependency/caller paths, then recommend scoped regression with uncertainty. Diagnosis, repair and execution are separate requested outcomes |
| 9. Does every single test require a plan first? | pom-architecture routing guidance | Answer no; select the owner for the actual design, execution, automation or other request. Planning and unrelated siblings are not compulsory ceremonies |
| 10. Approved plan with FAILED candidate and three exhausted repair rounds | maintain-test for candidate/history authority; routing answer only here | Answer no: preserve FAILED status, cumulative attempts and exhaustion. A plan cannot mark READY or reset history. The next permitted decision belongs to the existing maintenance rules/owner; no further repair, diagnosis or candidate action is performed by this answer |
| 11. Must deferred gap analysis precede planning? | test-planning | Answer no; proceed with selected evidence and explicit gaps or a useful partial draft. Broader gap analysis is optional future work, not a prerequisite or another coverage authority |

A sibling is required when it owns the user's requested outcome, not because planning was mentioned or a plan exists. No selected request creates a compulsory unrelated planning/design/impact workflow. An accepted equivalent consumer plan can inform later work without a new template or planning invocation.

A plan changes **none** of the existing automation gates: source/expectation acceptance, configured runtime authority, ownership and reconciliation, failed-candidate restrictions, cumulative repair limits, independent review and two fresh scoped green runs still apply. Plan approval neither clears blockers nor authorizes a handoff. Meeting automation gates also does not prove every cycle criterion. No plan, case, test, tracker change, candidate action or downstream handoff was created here.
