# Impact analysis: exact-id

## Change
Selected source: Cedar / Bug 456 / revision 5, supplied response capture/cedar-456.json#/item for https://dev.azure.com/example-org/Cedar/_workitems/edit/456. References are synthetic excerpts in the consumer's evidence.md, not live tracker/runtime proof. The project is Cedar; an identical ID in another project is a different source.

The response reports an old checkout total after quantity changes and names F456. Resolved status supplies no merge, deployment or passing-retest receipt. Accepted R-CART-2 requires line totals and payable cart total to reflect selected quantities. Accepted C2 (contracts/cart-v2.json#/PATCH) returns {total: number} from PATCH /cart/items/{id}.

changes/F456.diff:1-5 proposes replacing returned cart.total with sumCurrentLineTotals(cart.lines) in application recalculation. F456 is not merged/deployed; candidate/baseline builds and commits are unknown. This implementation delta accepts no new expectation and changes no C2 response shape. Separate C3 is outside scope.

## Impact map

| Target | Supported path and evidence | Disposition |
| --- | --- | --- |
| API total / CASE-21 / R-CART-2 | F456 recalculation -> PATCH handler (application/cart/routes.ts:12-16) -> configured ApisCart.updateQuantity PATCH/returned body (src/apis/ApisCart.ts:8,24-34) -> CASE-21 response -> verifyTotal(response, tc21.expectedTotal) (tests/CartTests.spec.ts:18-22). CASE-21 passes its own tc21.item/quantity. | Confirmed direct current API caller; conditional regression impact if F456 is adopted. |
| Summary / CASE-22 / R-CART-2 | PATCH total -> renderSummary (application/cart/summary.ts:10-13) -> CheckoutPage rendered-total validation; changeQuantity submits the PATCH-backed cart form (src/pages/CheckoutPage.ts:12-31) -> CASE-22 quantity/expectedTotal (tests/CheckoutTests.spec.ts:19-24). | Confirmed indirect application/UI dependency. |
| Data / harness layers | Separate Cart/Checkout paired quantities/expected totals; ApisCart delegates PATCH/checks total and contains no F456 implementation (src/apis/ApisCart.ts:8,24-34). | Both existing data combinations matter. No fixture, service or utility defect/edit is established. |
| Locale / CASE-23 | tests/LocaleTests.spec.ts:16-19 calls profile locale methods; selected complete methods read only profile locale field. | Dismissed within supplied scope on affirmative separate-field behavior. |
| Legacy CASE-91 | trace/cart-old.json#/CASE-91 maps removed LegacyCartPage without current mapping/retirement. | Uncertain; stale trace proves neither current impact nor irrelevance. |

## Findings
Both returned and displayed totals have demonstrated paths from F456. Confirmed dependency does not prove fix efficacy or establish the symptom's cause. Application recalculation is the proposed edit; it does not establish a harness utility change.

Payment, receipt, dynamic-extension, database, configuration and further contract dependencies are unknown without selected current sources. Missing sources are not affirmative exclusions.

## Recommendations
Reuse CASE-21 in tests/CartTests.spec.ts and CASE-22 in tests/CheckoutTests.spec.ts with each existing paired quantity/expected-total combination against unchanged R-CART-2/C2. API success alone does not prove rendering. Before separately requested execution, bind the candidate build/commit to F456 and record test commit, fixture, environment and configuration.

Exclude CASE-23 from this cart scope on its affirmative evidence; retain CASE-91 as uncertain pending current mapping/retirement. Check missing consumers before broader claims. Existing CASE-21/22 provide reusable checks; no confirmed uncovered accepted criterion is established here to justify new case design automatically.

## Limits and handoff
Fixture-only partial assessment; no maintenance cohort or accepted plan baseline is selected. Source/change owner should provide F456 implementation/deployment binding and relevant missing current callers.

Later regression belongs to execution/automation; design requires separately selected scope. No handoff, test, diagnosis, repair, source/case/data edit, tracker update, acceptance/history/budget change or external publication occurred.
