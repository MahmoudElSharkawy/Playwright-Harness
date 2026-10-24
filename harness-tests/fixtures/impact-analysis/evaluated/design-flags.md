# Impact analysis: design-flags

## Change

Selected source: synthetic Cedar **STORY-123 revision 7**, accepted D7 minimum 12 for AC1 and invitation AC2 (story/registration-r7.md:1-4), and incoming prior design flags F1-F4 (flags/design-r7.md:1-5). Selected supporting sources are registration/current cases, REQ-RESET revision 2/D-R2 and REQ-PROFILE revision 4/D-P4. All citations are stable labels in supplied evidence.md, not live tracker receipts.

The originating test-design scope remains STORY-123 revision 7. A candidate affected requirement named in a flag is not added to that design automatically. The flags are hypotheses to validate, not accepted requirement changes or case-edit authority.

## Impact map

| Flag and provenance | Current evidence and dependency path | Disposition |
| --- | --- | --- |
| **F1:** origin STORY-123 rev 7; candidate REQ-RESET rev 2; flag evidence reset-r2:2-3 | story/reset-r2.md:1-3 records accepted D-R2: reset passwords must satisfy the registration minimum. Accepted STORY-123 D7 -> shared minimum 12 -> accepted reset criterion. The selected current catalogue contains no reset case. | **Confirmed requirement dependency.** Reset inherits 12 under the accepted rule. Reset implementation, methods, callers and actual behavior remain unknown because no reset source/case path is supplied. |
| **F2:** origin STORY-123 rev 7; candidate REQ-PROFILE rev 4/CASE-14; original evidence only a generic button label | story/profile-r4.md:1-2 accepts display-name editing without a password. tests/ProfileTests.spec.ts:15-18 -> ProfilePage.changeDisplayName; src/pages/ProfilePage.ts:10-24 shows a complete method using only displayName_txt and its own /profile save_btn, with no password or RegistrationPage import/call. | **Dismissed for the selected CASE-14 flow.** Affirmative current evidence contradicts the shared-registration-submit premise. Matching button labels are not a dependency. |
| **F3:** origin STORY-123 rev 7; candidate external REQ-SSO, revision unknown; no flag caller evidence | flags/design-r7.md:1-5 supplies no accepted SSO revision, contract or current caller/mapping. | **Uncertain.** Neither shared-password impact nor exclusion is established. No SSO requirement or cases are approved or added. |
| **F4:** origin STORY-123 rev 7/AC1; candidate boundary case additions, no prior case search | tests/RegistrationTests.spec.ts:18-34 -> register(tc12/tc13) -> rejection/success. resources/testData/RegistrationTestJsonFile.json records CASE-12 = 11, CASE-13 = 12 and their D7 authorship; src/pages/RegistrationPage.ts:22-27 fills those inputs. | **Boundary relevance confirmed; claimed need for duplicate 11/12 additions dismissed.** Current CASE-12/13 already supply the checks the flag proposed looking for. |

Related selected registration paths: CASE-15 uses InvitationPage.openRegistration to /register, then RegistrationPage.register with length 12 and verifies account creation (tests/InvitationTests.spec.ts:17-21; src/pages/InvitationPage.ts:19-21; src/pages/RegistrationPage.ts:9-11,22-27; invitation data #/tc15). CASE-11 rejects length 7. CASE-10 still expects success at length 8 despite accepted D7 (registration spec/data above).

## Findings

F1 supports an accepted cross-requirement consequence, but it does not prove reset implementation changed or works. The absence of a reset case is a coverage gap in the selected catalogue; completeness beyond that catalogue is unknown.

F2 is dismissed only for the supplied profile display-name requirement and complete CASE-14 path. This does not certify every profile feature unaffected. F3 remains an evidence request, not a confirmed impact. F4 needs regression reuse, not duplicate case design.

CASE-10 has a confirmed existing data/expectation conflict with D7 and requires source/maintenance handling. CASE-11 remains useful rejection coverage but is no longer the immediate lower boundary.

Legacy CASE-90 remains uncertain: its old spec and LegacySignupPage.signUp paths are absent, but trace/registration-old.json#/CASE-90 supplies no replacement/retirement record. No current API registration case mapping exists in the selected inventory; API coverage and contract dependencies are unknown.

## Recommendations

For the existing STORY-123 design/regression scope, reuse CASE-12/13 for 11-reject/12-accept, CASE-15 for the invitation path at 12 and CASE-11 for additional rejection coverage. Route CASE-10's conflict through existing case-editing/maintenance handling with accepted D7; do not weaken the minimum or alter the case here. No new AC1 boundary cases are justified by F4.

For F1, recommend **separately selected REQ-RESET revision 2 scope**. Check any additional current reset cases/mappings for reuse, then design missing accepted-minimum coverage if the gap remains; verify reset rejects 11 and accepts 12 through its own supported flow. Do not insert reset cases into the current STORY-123 proposal merely because F1 is confirmed.

For F2, omit CASE-14 from the password-minimum regression recommendation on the supplied exclusion evidence. For F3, request the selected SSO requirement identity/revision, acceptance/contract evidence and current callers/cases before deciding impact or design scope. Request a current CASE-90 mapping if legacy coverage is required.

## Limits and handoff

No reset implementation, SSO source, current legacy mapping or API contract/case path is supplied. No plan baseline or diagnostic cohort is selected for this flag assessment. Confirmed dependencies do not prove implementation correctness, coverage completeness or a failure cause.

No tests/diagnostics, source/case changes, design-scope expansion, approvals, state transitions, captures, tracker writes or handoffs were performed. Existing histories, failures and repair budgets are unchanged.