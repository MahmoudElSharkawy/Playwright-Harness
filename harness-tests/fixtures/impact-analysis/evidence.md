# Synthetic selected sources for impact-analysis evaluation

All projects, items, decisions, paths and receipts below are synthetic. Code blocks
are selected source excerpts with stable location labels, not executable test files.
No live tracker or application is involved. Only the sources named by a request are
selected for that request; the remaining sections are not permission to expand it.

## Identity sources

`story/registration-r6.md:1-3`: project Cedar / STORY-123 / revision 6.
Owner decision D6 accepted AC1: registration accepts passwords of at least 8 characters;
shorter passwords are rejected. AC2: invitation registration uses the same minimum.

`story/registration-r7.md:1-4`: project Cedar / STORY-123 / revision 7.
Owner decision D7 accepted AC1: registration accepts passwords of at least 12 characters;
shorter passwords are rejected. AC2: invitation registration uses the same minimum.
This is the entire accepted change from revision 6.

`story/registration-draft8.md:1-3`: project Cedar / STORY-123 / proposed revision 8.
Proposal P8 asks for a minimum of 16. No owner has accepted P8. D7 is still current.

`story/reset-r2.md:1-3`: project Cedar / REQ-RESET / revision 2.
Owner D-R2 accepted: a reset password must satisfy the registration password minimum.
No reset case appears in the selected current case catalogue below.

`story/profile-r4.md:1-2`: project Cedar / REQ-PROFILE / revision 4.
Owner D-P4 accepted: editing the display name does not require a password.

`capture/cedar-456.json#/item`: supplied read-only item response for
`https://dev.azure.com/example-org/Cedar/_workitems/edit/456`, project Cedar,
type Bug, revision 5, status Resolved. Reported symptom: checkout displays the old
total after quantity changes. The response names proposed change F456; it includes
no deployment or passing retest receipt. Calculation expectation R-CART-2 remains
accepted: line totals and payable cart total reflect the selected quantities.

`capture/birch-456.json#/item`: project Birch, type Bug, ID 456, revision 2.
Reported symptom: a profile avatar is not displayed. It is unrelated to Cedar cart.

`capture/denied-777.json#/response`: exact selected Cedar Bug 777 read returned
HTTP 403. No title, description, relationships or implementation evidence is available.

## Registration source and current cases

`src/pages/RegistrationPage.ts:22-27`:
```ts
public async register(input: RegistrationInput) {
  await this.email_txt.fill(input.email);
  await this.password_txt.fill(input.password);
  await this.register_btn.click();
}
```
`src/pages/RegistrationPage.ts:9-11`: `register_btn` belongs to `/register`.

`tests/RegistrationTests.spec.ts:18-34`:
```ts
// CASE-10 / STORY-123 AC1
await registrationPage.register(testData.tc10);
await registrationPage.verifyAccountCreated();
// CASE-11 / STORY-123 AC1
await registrationPage.register(testData.tc11);
await registrationPage.verifyShortPasswordRejected();
// CASE-12 / STORY-123 AC1
await registrationPage.register(testData.tc12);
await registrationPage.verifyShortPasswordRejected();
// CASE-13 / STORY-123 AC1
await registrationPage.register(testData.tc13);
await registrationPage.verifyAccountCreated();
```
`resources/testData/RegistrationTestJsonFile.json`: selected current fixture metadata
records password lengths `{tc10: 8, tc11: 7, tc12: 11, tc13: 12}`. CASE-10 was authored
against D6. CASE-12/13 were added against D7. IDs and expected outcomes above are current.

`tests/InvitationTests.spec.ts:17-21`:
```ts
// CASE-15 / STORY-123 AC2
await invitationPage.openRegistration(testData.tc15.invitation);
await registrationPage.register(testData.tc15);
await registrationPage.verifyAccountCreated();
```
`resources/testData/InvitationTestJsonFile.json#/tc15`: current password length 12.
`src/pages/InvitationPage.ts:19-21`: `openRegistration` navigates to `/register`.

`tests/ProfileTests.spec.ts:15-18`:
```ts
// CASE-14 / REQ-PROFILE
await profilePage.changeDisplayName(testData.tc14.displayName);
await profilePage.verifyDisplayName(testData.tc14.displayName);
```
`src/pages/ProfilePage.ts:10-24`: `/profile` owns its own `save_btn` and
`changeDisplayName` fills only `displayName_txt` then clicks `save_btn`. No password
field, RegistrationPage import or register call occurs in the selected complete method.

`trace/registration-old.json#/CASE-90`: revision 1 mapping names
`tests/LegacyRegistrationTests.spec.ts` and `LegacySignupPage.signUp`. Both paths
are absent from the supplied current file inventory; no replacement or retirement
record is supplied. The selected current inventory has no API registration cases.

`flags/design-r7.md:1-5`: a prior test-design proposal for STORY-123 rev 7 flags:
- F1: REQ-RESET rev 2 may inherit the changed minimum; evidence `reset-r2:2-3`.
- F2: REQ-PROFILE rev 4 may share the registration submit button; evidence was only
  the generic button label, not a source mapping.
- F3: external REQ-SSO may share the password contract; no revision or caller evidence.
- F4: STORY-123 AC1 boundary coverage may need 11/12-character cases; no case search
  was performed by the flag's author. Current design scope remains STORY-123 only.

## Cart change and current callers

`changes/F456.diff:1-5`: proposed fix, not merged or deployed:
```diff
--- application/cart/recalculate.ts
+++ application/cart/recalculate.ts
- return {...cart, total: cart.total};
+ return {...cart, total: sumCurrentLineTotals(cart.lines)};
```
`contracts/cart-v2.json#/PATCH`: accepted contract C2:
`PATCH /cart/items/{id}` accepts quantity and returns `{total: number}`.
`application/cart/routes.ts:12-16`: that PATCH handler calls `recalculate(cart)`
and returns its result. `application/cart/summary.ts:10-13`: `renderSummary` displays
the `total` returned by that PATCH. These are application excerpts, not harness utilities.

`src/apis/ApisCart.ts:8,24-34`: `updateQuantity_serviceName` is
`/cart/items/{id}`; `updateQuantity` calls the configured ApiActions PATCH for that
operation and returns its body. `verifyTotal` asserts the body's `total` against
the supplied expected value. No proposed F456 implementation exists in this service.

`tests/CartTests.spec.ts:18-22`:
```ts
// CASE-21 / R-CART-2
const response = await apisCart.updateQuantity(testData.tc21.item, testData.tc21.quantity);
await apisCart.verifyTotal(response, testData.tc21.expectedTotal);
```
`tests/CheckoutTests.spec.ts:19-24`:
```ts
// CASE-22 / R-CART-2
await checkoutPage.changeQuantity(testData.tc22.quantity);
await checkoutPage.verifySummaryTotal(testData.tc22.expectedTotal);
```
`src/pages/CheckoutPage.ts:12-31`: `/checkout`; `changeQuantity` operates the cart
quantity field and submits the PATCH-backed form. `verifySummaryTotal` observes
the rendered `renderSummary` total. Cart/Checkout paired data contains separate
quantities and expected totals. F456 does not change accepted calculation expectations.

`tests/LocaleTests.spec.ts:16-19`: CASE-23 calls `profilePage.changeLocale` and
`verifyLocale`; the selected complete methods read only the profile locale field.
`trace/cart-old.json#/CASE-91`: revision 1 mapping names removed `LegacyCartPage`;
there is no supplied current mapping or retirement record for CASE-91.
No payment, receipt, dynamic extension, database caller or contract revision is
included in the selected evidence. Their implementation dependencies are unknown.

`changes/C3-proposal.diff:1-4`: separate unaccepted contract/service proposal:
```diff
- PATCH response: {total: number}
+ PATCH response: {totals: {payable: number}}
- ApisCart.updateQuantity return type: {total: number}
+ ApisCart.updateQuantity return type: {totals: {payable: number}}
```
C2 remains the accepted contract. This proposal is not part of F456 unless explicitly
selected. It changes a shared service return shape and the external API contract.

## Existing histories and comparison inputs

`plans/registration-plan-p4.md:1-4`: accepted plan PLAN-7 revision 4 binds STORY-123
rev 6/D6 and CASE-10's successful 8-character criterion. No replacement approval exists.

`maintenance/cart-a3.md:1-5`: existing maintenance assessment M-CART-A3 binds
Cedar Bug 456 revision 4, application build b117, test commit t10, fixture f1,
environment qa, configuration c1. It suggests CASE-21 only; it did not inspect
renderSummary. Cumulative repair rounds consumed: 2 of 3. Prior FAIL remains retained.

`runs/cart-comparison.json#/samples`:
- X1: FAIL / CASE-21 / app b117 / test t10 / fixture f1 / qa / config c1.
- X2: PASS / CASE-21 / app b118 / test t10 / fixture f2 / qa / config c1.
Fixture f2 changes quantity from 2 to 3. No evidence links b118 to F456 or confirms
which implementation changed. No same-build/fixture comparison is supplied.

## Bug with symptoms only

`capture/cedar-789.md:1-3`: Cedar Bug 789 revision 1, New. Checkout sometimes shows
an old total. No fix, diff, baseline, run denominator or deployment/retest is supplied.
Selected supporting evidence is R-CART-2, CASE-21/22, the cart caller excerpts above
and accepted C2 only. F456 and C3 are not selected evidence for Bug 789.
