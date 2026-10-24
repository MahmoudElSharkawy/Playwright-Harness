# Impact analysis: routes

## Change

This request selects routing decisions only for incoming requests (a)-(h), using synthetic **Cedar Bug 456 revision 5** (capture/cedar-456.json#/item). No incoming task is executed. This report does not perform F456's impact assessment, diagnosis, repair, recovery, regression, case design or bug drafting.

The supplied capture's Resolved status is not merge/deployment/passing-retest proof. Source labels below refer to evidence.md, not live tracker state.

## Impact map

| Incoming request | Owning workflow | Next action when that request is actually started | Separate impact run/assessment? |
| --- | --- | --- | --- |
| **(a) What could F456 affect?** | **impact-analysis** | Bind the selected proposed change, its authority/baseline and current caller/case evidence; produce supported impact findings and existing regression recommendations. | A standalone impact report is the requested output. Maintenance is not selected by the bug ID or attached failure evidence. No second maintenance assessment is required just for this question. |
| **(b) Diagnose why CASE-21 failed.** | **maintain-test** | Resolve CASE-21's existing source/history and comparison inputs; use its one maintenance assessment for source/caller comparison and bounded evidence-based diagnosis through the existing runtime gates if needed. | **No** standalone impact run or second assessment. Reuse current impact findings after checking provenance/revisions and reassess affected/stale evidence in maintenance. |
| **(c) Repair CASE-21 for the accepted change.** | **maintain-test** | Bind the accepted change to CASE-21, assess the actual defect and existing history, then use the appropriate existing repair/revision path and verification gates. The request's wording does not authenticate acceptance; preserve accepted expectations unless the selected accepted source changes them. | **No** separate impact run/second assessment. Source/caller impact belongs in the same maintenance assessment/history. |
| **(d) Recover this blocked test.** | **maintain-test** | Retrieve the retained blocker, exact unblock conditions, current evidence and saved workflow stage. Verify all conditions, then resume that stage; a case without generated automation resumes its existing authoring/execution path. | **No** separate impact run/second assessment. Clearing a blocker alone proves neither PASS nor automation completion. |
| **(e) Run the recommended regression.** | **execute-test** for live/manual execution, or the existing **automate-test/automation execution workflow** for automated regression | Bind the recommended cases to current source revisions and the selected environment/mode; run through that owner's current gates and retain results. Resolve only missing execution inputs. | **No** new standalone impact run is inherently required. Check recommendation freshness; the owner reassesses stale/changed evidence before relying on it. |
| **(f) Design cases for a confirmed accepted coverage gap.** | **test-case-design** | Separately select the accepted requirement/gap scope, inspect existing cases for reuse and prepare a source-grounded proposal through current design/review/publication gates. | **No** separate impact run is mandatory. Reuse valid findings; flags do not expand selected design scope or authorize case changes. |
| **(g) Draft a bug report.** | **bug-report** | Prepare the editable source-grounded draft for the selected project/item and supplied symptom/evidence, preserving uncertainty and project-specific required fields. Drafting does not file or publish it. | **No** impact run or maintenance assessment is required solely to draft. Any necessary further reproduction belongs to its authorized owning workflow. |
| **(h) Analyze the impact and repair the affected automation.** | **maintain-test**, owning the entire combined request | Assess source/caller impact in maintenance's existing assessment/history, diagnose, make only justified repairs through POM owners and complete existing verification gates. | **No** standalone impact run and **no** second assessment/store. Reuse fresh report findings where available and recheck changed evidence in the maintenance assessment. |

## Findings

Routing follows the requested outcome. The same selected bug can lead to impact-only analysis, maintenance, execution, design or drafting; item type, numeric ID and attached failures do not select maintenance by themselves.

Existing maintenance evidence is not fresh merely because the item ID matches. maintenance/cart-a3.md:1-5 binds M-CART-A3 to Cedar Bug 456 revision 4, build b117, test t10, fixture f1, qa/config c1, and a CASE-21-only recommendation. Its recorded missing renderSummary inspection and revision binding require the maintenance owner to recheck affected evidence before reuse.

## Recommendations

For maintenance requests (b), (c), (d) and (h), retain the applicable cumulative source/history. M-CART-A3 records **2 of 3 repair rounds consumed** and a retained prior FAIL. A revised bug, assessment, candidate or source ID does not reset that budget or erase the failure. Assessment/recommendation alone does not consume a repair round; actual repair/revision/application-change candidates follow existing budget accounting. Exhaustion still requires the existing owner decision.

For a final generated-automation repair, preserve fresh independent framework review and **two independent scoped green processes** after the final candidate. Diagnostic attempts are retained and do not count as generation greens. Application defects retain assertions; accepted source changes need their acceptance evidence. Recovery resumes the saved stage only after all unblock conditions are verified.

For (e), retain the existing execution/generation history and applicable completion gates. For (f) and (g), keep the existing proposal/draft and publication authorities. None of these routing decisions edits maintenance state, expands scope, approves requirements or marks a case done.

## Limits and handoff

The next maintenance owner must account for comparison input changes if using runs/cart-comparison.json#/samples: X1 is b117/f1 and FAIL; X2 is b118/f2 and PASS, with fixture quantity 2 -> 3. Test t10, qa and c1 are retained, but build and fixture both differ. No supplied evidence links b118 to F456 or supplies a same-build/fixture comparison. These inputs require owner reassessment, not a flakiness, fix or successful-retest conclusion.

All eight entries above are recommendations of ownership and next action only. No incoming task, runtime, test, diagnostic, repair, recovery, case design, draft, source/case mutation, history/budget update, new capture, tracker write or external handoff was executed. Only this requested routing report was saved.