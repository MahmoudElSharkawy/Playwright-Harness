# Impact analysis: story-accepted

## Change

Selected source: synthetic Cedar **STORY-123**, accepted revision 6/D6 to accepted revision 7/D7. All source citations below are location labels in the supplied evidence.md; they are not live tracker or filesystem verification.

story/registration-r6.md:1-3 accepts a minimum password length of 8. story/registration-r7.md:1-4 records owner D7 accepting a minimum of 12 for AC1 and the same minimum for invitation registration under AC2. This is the entire accepted delta. No application implementation change or observed runtime behavior is supplied.

Scope: D6/D7, the registration source/current case catalogue and PLAN-7. Other requirements and proposals are not added.

## Impact map

| Path | Located evidence | Impact |
| --- | --- | --- |
| D7 AC1 -> CASE-10 -> RegistrationPage.register(testData.tc10) -> password fill -> account-created assertion | tests/RegistrationTests.spec.ts:18-34; src/pages/RegistrationPage.ts:22-27; resources/testData/RegistrationTestJsonFile.json | Confirmed conflict: current tc10 is 8 characters and its success expectation was authored under D6; 8 is below accepted D7's 12. |
| D7 AC1 -> CASE-11 -> register(tc11) -> short-password rejection | Same registration spec/method/data labels | Confirmed regression relevance: 7 remains invalid, but is no longer the immediate lower boundary. |
| D7 AC1 -> CASE-12/13 -> register(tc12/tc13) -> rejection/success | Same registration spec/method/data labels | Confirmed reusable boundary coverage: CASE-12 rejects 11; CASE-13 accepts 12. Both were added under D7. |
| D7 AC2 -> CASE-15 -> InvitationPage.openRegistration -> /register -> shared RegistrationPage.register(tc15) -> account-created assertion | tests/InvitationTests.spec.ts:17-21; src/pages/InvitationPage.ts:19-21; src/pages/RegistrationPage.ts:9-11,22-27; resources/testData/InvitationTestJsonFile.json#/tc15 | Confirmed indirect shared-registration path; current 12-character invitation input remains valid and tests the new accepted minimum. |
| CASE-14 -> ProfilePage.changeDisplayName -> its own /profile save button | tests/ProfileTests.spec.ts:15-18; src/pages/ProfilePage.ts:10-24 | Dismissed for the supplied display-name flow: the complete method uses only the display-name field and its own save button, with no password, RegistrationPage import or register call. |
| CASE-90 -> removed legacy spec/page names | trace/registration-old.json#/CASE-90; supplied current file inventory | Uncertain: absence of both legacy paths does not establish retirement, replacement, or lack of impact. |
| D6/CASE-10 criterion -> accepted plan baseline | plans/registration-plan-p4.md:1-4 | PLAN-7 revision 4 binds D6 and successful 8-character registration; D7 changes that requirement dimension. |

The selected register method fills supplied data and clicks the /register button. It contains no shown length threshold. These dependencies do not establish where enforcement is implemented or require a particular page-method/locator edit. No configuration change or external API/database contract is evidenced.

## Findings

- **Confirmed:** D7 changes accepted AC1/AC2 behavior. CASE-10's current valid-input criterion conflicts with it; CASE-11 remains useful negative coverage; CASE-12/13 already cover 11/12; CASE-15 shares the affected registration flow.
- **Dismissed:** a registration-submit impact on the selected CASE-14 display-name path, using affirmative current method evidence.
- **Uncertain:** CASE-90's current ownership and any API registration coverage. The selected inventory contains no API registration case mapping; it cannot prove complete coverage or no API dependency.
- **Confirmed baseline impact:** PLAN-7 revision 4's D6/8-character-success criterion requires owner reassessment. D7 does not silently replace the accepted plan baseline.

## Recommendations

Reuse CASE-12 and CASE-13 for the accepted 11-reject/12-accept boundary, CASE-15 for invitation registration at 12, and CASE-11 for retained rejection coverage below the minimum. Check actual rejection/account-creation results through the owning execution or automation workflow when requested; this assessment supplies no pass result.

Send CASE-10's source/data/expectation conflict to the existing case-editing or maintenance owner with D7 evidence before treating it as a current valid-input regression. Reuse CASE-13's valid-12 coverage rather than propose duplicate boundary cases. Preserve D7; do not change assertions, data or case text in this impact run.

Request CASE-90's current replacement/retirement/caller record and relevant API contract/case evidence if those areas must be included. Do not count the unresolved legacy mapping as an unaffected case.

## Limits and handoff

Ask the PLAN-7 owner to reassess revision 4's requirement binding and CASE-10 criterion against D7; no replacement approval is supplied. Runtime enforcement, deployment, API/database dependencies and complete coverage remain unknown. Reset/SSO requirements and draft revision 8 are outside this request.

Only this report was produced. No tests, diagnostics, repairs, source/case edits, plan/tracker updates, history changes or handoffs were executed. Existing maintenance budgets and failures remain untouched.