# Impact analysis: story-proposed

## Change

Selected source: synthetic Cedar **STORY-123**, current accepted revision 7/D7 against proposed revision 8/P8. Source citations are labels in supplied evidence.md, not live proof.

story/registration-r7.md:1-4 records owner D7 accepting a minimum of 12 for registration AC1 and the same minimum for invitation AC2. story/registration-draft8.md:1-3 proposes 16; no owner has accepted P8. The delta 12 -> 16 is conditional. The current accepted minimum remains 12. No implementation or runtime change is supplied.

Scope: D7/P8 and the supplied registration source/current cases. Other requirement sources and plan/maintenance histories are not selected.

## Impact map

| Conditional path | Located evidence | Impact if P8 is accepted and applied |
| --- | --- | --- |
| Proposed AC1 minimum 16 -> CASE-13 -> register(tc13) -> account-created assertion | tests/RegistrationTests.spec.ts:18-34; src/pages/RegistrationPage.ts:22-27; resources/testData/RegistrationTestJsonFile.json | Confirmed dependency, conditional behavior impact: 12 currently succeeds under D7 but would be below 16. |
| Proposed common minimum -> invitation AC2 -> CASE-15 -> openRegistration -> /register -> shared register(tc15) | tests/InvitationTests.spec.ts:17-21; src/pages/InvitationPage.ts:19-21; src/pages/RegistrationPage.ts:9-11,22-27; resources/testData/InvitationTestJsonFile.json#/tc15 | Confirmed indirect dependency, conditional behavior impact: the current 12-character invitation input would no longer be valid. |
| Proposed AC1 -> CASE-11/12 -> rejection assertions | Registration spec/method/data above | Inputs 7 and 11 remain invalid under both D7 and P8. CASE-12 would stop being the immediate lower boundary for the proposed rule. |
| Current AC1 -> CASE-10 -> 8-character input -> success assertion | Same registration spec/method/data | Already conflicts with accepted D7. This is not a new mismatch introduced by P8. |
| CASE-14 -> own /profile display-name save method | tests/ProfileTests.spec.ts:15-18; src/pages/ProfilePage.ts:10-24 | Dismissed for the selected flow: the complete method has no password or registration call/import and owns its own save button. |
| CASE-90 -> absent legacy paths | trace/registration-old.json#/CASE-90; supplied current file inventory | Uncertain; no replacement or retirement record establishes its current dependency. |

The supplied register method consumes per-case password data and clicks the registration button; it shows no threshold logic. There is no basis for prescribing an enforcement, method, locator, configuration or contract edit. The inventory supplies no current API registration case mapping.

## Findings

**Confirmed dependencies, conditional change:** CASE-13 and CASE-15 consume current valid 12-character passwords through the affected registration flow. Their P8 impact must not become an accepted expected-result change before owner acceptance.

**Existing accepted-state issue:** CASE-10 expects success for 8 despite D7. Address it independently through its owning workflow, using accepted D7 rather than proposed P8.

**Coverage:** CASE-12/13 already cover the accepted 11/12 boundary. The selected catalogue has no 15/16 boundary or valid-16 fixture/case. That is a conditional proposal coverage need, not a confirmed gap against the current accepted 12-character rule. CASE-11 remains useful below-minimum rejection coverage.

**Uncertain:** legacy CASE-90, API coverage, enforcement implementation and unselected dependencies. The absence of a current mapping does not dismiss them.

## Recommendations

For current accepted behavior, reuse CASE-12/13 for 11-reject/12-accept, CASE-15 for invitation registration at 12, and CASE-11 for retained rejection coverage. Reconcile CASE-10 through existing case-editing/maintenance handling before using its stale success criterion as an acceptance result.

If P8 is explicitly accepted, separately select the revised design/maintenance scope and verify 15 is rejected, 16 is accepted, and invitation registration follows the accepted common minimum. First check further existing cases for reuse; then design only missing coverage. Existing CASE-13/15 data and expectations would need reassessment under that accepted revision. This report changes none of them.

Keep useful rejection checks; do not simply raise input lengths or assert new outcomes because P8 exists. Recommended execution remains a separate execution/automation action.

## Limits and handoff

P8 has no acceptance, implementation, deployment or retest evidence. Request owner acceptance before adopting a 16-character expectation; it is not needed to complete this conditional analysis. Request current CASE-90 and API/contract mappings if those areas need an assessment.

No plan or diagnostic cohort was selected here, so none is replaced or reassessed by this report. Other requirements, including reset and SSO, are not imported into scope. No tests, diagnostics, repairs, case/source changes, new captures, tracker updates or handoffs occurred; existing histories and budgets remain unchanged.