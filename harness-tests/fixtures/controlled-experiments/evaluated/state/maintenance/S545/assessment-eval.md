# CASE-545 maintenance assessment

CASE-545 consistently fails in the selected window; flakiness is not demonstrated. Do not change expected 150 to 135: 150 remains the accepted S545 revision 7/D7 requirement; P8/draft8 has no owner acceptance.

## Scope and evidence

Selected evidence: evidence.md, "Consistent failure and proposed expectation — CASE-545", labels source/545-r7, source/545-draft8, native/545 and maintenance/545/M1; retained .harness/state/maintenance/S545/prior.md remains intact. This is an offline maintain-test assessment of synthetic captures, not a reproduction.

| Binding | Supplied value |
| --- | --- |
| Accepted baseline | S545 revision 7/D7; selected fixture must total 150 |
| Proposed delta | P8/draft8: expect 135; unaccepted |
| Comparable launches | K1-K4, complete original launches; same t45/b45/Chromium/qa/c45/f45 and parameter set |
| Outcomes | Every launch FAILs expected 150, actual 135; same assertion; no retries |
| Limits | Diagnostics 1/3 consumed, ten-minute cap; repairs 0/3; elapsed time unknown |
| Missing | Calculation trace, exact fixture/input values and source/code mappings, durations, timestamps/job/shard, working-tree state, generation stage/spec/status and tracker identity |

## Counts and diagnosis

Eligible first-attempt set: {K1,K2,K3,K4}, the entire selected window. Failure is 4/4 = 100%, with identical expected/actual signature. No passing observation exists. With no retries, within-launch retry recovery has no eligible denominator. Adjacent first-attempt pairs {K1->K2,K2->K3,K3->K4} are all FAIL->FAIL; observed FAIL->PASS is 0/3 eligible failed first attempts with a successor.

These counts establish consistency in this window, not universal determinism or an outside-window rate. Repetition does not prove 135 correct, and absence of a pass does not identify a product defect. Classification: consistent observed failure; cause unknown/needs-investigation.

| Competing cause | Evidence and discriminating information |
| --- | --- |
| Application calculation/return-value defect | Actual 135 conflicts with accepted 150, but no trace assigns the discrepancy to the application. Verify accepted inputs and component values first. |
| Test fixture/input mapping or asserted-field fault | Stable wrong input/field can produce identical failures. Matching fixture labels do not independently establish correct content/mapping. Inspect actual selected input, request and displayed/returned field. |
| Requirement genuinely changed to 135 | Only an unaccepted proposal supports it; observed 135 does not accept P8. The requirement owner must decide any conflict with D7. |
| Intermittent timing/environment issue | No outcome varies in the selected set. Additional evidence could change classification, but flaky is unsupported here. |

## Expectation authority and impact

The proposed change is exactly 150 -> 135 for the selected fixture. There is no accepted revision, acceptance artifact or requirement-change candidate; preserve expected 150. Do not weaken an assertion to match observations or rename the source to evade history.

Affected criterion: S545 total for f45 and the comparison assertion. Supplied mappings stop at case/fixture/assertion; calculation services, page methods, value transformations, data fields and callers are unknown. No code delta or confirmed shared dependency is provided. Implementation impact and broader regression membership remain uncertain.

If the owner eventually accepts a revised rule, record the actual responsible decision, accepted revision, old/new expectations and affected scope. Preserve revision 7 and K1-K4 and compare actual fixture/caller impact. Existing generated automation must continue S545 through accepted-source revision using the prior fingerprint and acceptance artifact, then independent review and two fresh scoped green processes. Acceptance alone neither verifies automation nor resets budgets.

## Next maintenance action: proposed, unperformed

The smallest next action is a read-only comparison of accepted D7 calculation/fixture specification with actual f45 input and selected output field. Request missing calculation trace and current case-to-data/service/locator mappings. This can distinguish a wrong selected input/field from an application calculation discrepancy without another launch.

If later authorized and read-only evidence is insufficient, propose one diagnostic within two remaining attempts and the remaining ten-minute ceiling. Hold S545-r7/t45/b45/Chromium/qa/c45/f45 and parameters fixed; keep expected 150; capture input, component calculation values, returned total and asserted field. This is baseline instrumentation, not a claimed causal contrast or result. A wrong fixture/field supports a test/data repair; verified accepted inputs requiring 150 with application output 135 support an application issue. Conflicting calculation/source evidence goes to the requirement owner, never automatic acceptance of 135.

| Open blocker | Unblock condition and next action/owner |
| --- | --- |
| Cause unknown | Maintenance/application owner supplies calculation and mapping evidence |
| Expectation proposal unaccepted | Requirement owner explicitly accepts a revision if intended; otherwise 150 remains authoritative |
| No configured runtime | Execution owner supplies approved target and reconciles effects before later replay |
| No verified resolution | Preserve S545, diagnostics 1/3 and repairs 0/3; any supported repair completes normal review/two-green gates |

No expectation edit, diagnostic, repair, tracker transition, candidate or handoff occurred. Four original failures remain intact; this assessment creates no PASS, completion or stability claim.
