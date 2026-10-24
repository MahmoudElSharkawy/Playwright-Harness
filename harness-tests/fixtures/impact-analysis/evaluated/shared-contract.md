# Impact analysis: shared-contract

## Change
Selected scope: Cedar cart technical proposal C3 against accepted C2 and current callers/cases. changes/C3-proposal.diff:1-4 proposes changing PATCH response and ApisCart.updateQuantity return type from {total: number} to {totals: {payable: number}}. C3 is unaccepted; revision/build/deployment are unknown. C2 (contracts/cart-v2.json#/PATCH) remains accepted. No accepted calculation change accompanies this structural proposal.

References identify synthetic evidence.md excerpts, not live tracker/executable source proof. No bug is selected; separate F456 is outside scope.

## Impact map

| Target | Supported path/evidence | Disposition |
| --- | --- | --- |
| Shared API/service contract | Quantity PATCH /cart/items/{id} -> ApisCart.updateQuantity returns body (src/apis/ApisCart.ts:8,24-34); C3 explicitly changes return type (changes/C3-proposal.diff:1-4). | Confirmed proposed external API/shared service impact, conditional on adoption. |
| Validation / CASE-21 | Returned body -> ApisCart.verifyTotal asserts body total (src/apis/ApisCart.ts:24-34) -> CASE-21 passes response/tc21.expectedTotal after its own item/quantity update (tests/CartTests.spec.ts:18-22). | Confirmed direct caller; total access is incompatible with nested-only C3. No runtime failure observed. |
| Summary / CASE-22 | Handler returns recalculation result (application/cart/routes.ts:12-16) -> renderSummary reads total (application/cart/summary.ts:10-13) -> CheckoutPage PATCH-backed form/rendered-total validation (src/pages/CheckoutPage.ts:12-31) -> CASE-22's tc22.expectedTotal (tests/CheckoutTests.spec.ts:19-24). | Confirmed indirect field consumer; nested-only C3 requires compatible mapping, none supplied. |
| Data | Separate paired Cart/Checkout quantities/expected totals; C3 changes shape, not selected numeric criteria. | Existing combinations matter; no automatic numeric fixture/expectation change. |
| Locale / CASE-23 | tests/LocaleTests.spec.ts:16-19 and selected complete profile methods read only locale field. | Dismissed within scope on affirmative separate behavior. |
| CASE-91 | trace/cart-old.json#/CASE-91 maps removed LegacyCartPage without current mapping/retirement. | Uncertain; stale trace proves neither current dependence nor irrelevance. |

## Findings
C3 crosses external API and shared service return-value boundaries. A type change alone proves no compatible implementation: current validation/rendering consume total. Compatibility with totals.payable is unknown.

C3 does not replace accepted C2. Nested-payable recommendations remain conditional on acceptance/implementation; shape/dependency evidence proves no migration or fix success. Payment, receipt, dynamic-extension, database and other external consumers lack selected current sources. No change to the API facade's PATCH mechanism is established.

## Recommendations
Reuse CASE-21 for returned-value validation and CASE-22 for rendering, with existing paired values. Current acceptance retains C2 total expectations. If C3 is accepted, the owning change workflow should reconcile endpoint response, service contract, validation and renderer, then verify the same numeric totals through the accepted shape.

Obtain accepted C3 revision, compatibility/migration policy and candidate-build binding before execution. Reuse existing cases before additions. No dedicated migration/old-client checks are evidenced; an accepted gap depends on a separately selected compatibility requirement and current case search. Invent no compatibility obligation and create no cases here.

## Limits and handoff
Proposal assessment, not deployed behavior. Configuration, full callers and implementation/mapping details are unknown. No maintenance cohort or accepted plan baseline is selected.

Contract/change owner should resolve acceptance and supply missing consumers/migration evidence. Later execution belongs to execution/automation; uncovered accepted requirements go to separately scoped test-case-design. No handoff, test, source/data/assertion edit, acceptance/history/budget change or external action occurred.
