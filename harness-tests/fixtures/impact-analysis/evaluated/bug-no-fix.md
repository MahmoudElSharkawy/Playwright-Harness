# Impact analysis: bug-no-fix

## Change
Selected source: Cedar / Bug 789 / revision 1 / New, capture/cedar-789.md:1-3. It reports checkout sometimes displays an old total. Provenance is synthetic selected evidence.md excerpts, not live item/application proof.

Selected support is accepted R-CART-2, accepted C2, CASE-21/22 and their cart caller excerpts. R-CART-2 requires totals to reflect selected quantities; C2 specifies quantity PATCH returning {total: number}. No fix, diff, prior implementation/baseline, run denominator, deployment or retest exists in the selection. Implementation delta and change acceptance are unknown. A symptom accepts no changed behavior.

## Impact map

| Target | Selected path/evidence | Disposition |
| --- | --- | --- |
| Checkout / CASE-22 / R-CART-2 | Reported old total -> CASE-22 quantity/expectedTotal check (tests/CheckoutTests.spec.ts:19-24); CheckoutPage.changeQuantity submits the PATCH-backed form and verifySummaryTotal observes rendering (src/pages/CheckoutPage.ts:12-31). | Confirmed relevant behavior/check mapping; occurrence/cause unverified. |
| API / CASE-21 / R-CART-2 | CASE-21 passes tc21.item/quantity to ApisCart.updateQuantity and checks returned body against tc21.expectedTotal (tests/CartTests.spec.ts:18-22); service PATCHes /cart/items/{id}, returns body and validates total (src/apis/ApisCart.ts:8,24-34). | Confirmed reusable related API check, not confirmed technical change impact. |
| Response-to-summary | Handler calls recalculation (application/cart/routes.ts:12-16); renderSummary displays returned total (application/cart/summary.ts:10-13). | Confirmed current dependency; which component changed, if any, is unknown. |
| Data / contract | Separate Cart/Checkout paired quantities and expected totals; contracts/cart-v2.json#/PATCH is accepted C2. | Preserve expectations; no fixture/assertion/contract change warranted. |

## Findings
The symptom concerns cart calculation/checkout summary. Existing CASE-21/22 check the related response/rendering paths, supporting an initial behavior assessment without a failing test or fix. Implementation blast radius, changed methods/locators/configuration and broader callers remain unknown.

No selected evidence supports dismissing those unknowns or assigning a cause. “Sometimes” provides neither a flake classification nor a failure rate without a denominator or controlled comparison. No caching, timing, recalculation defect or successful repair is inferred. No implementation/contract proposal is selected.

## Recommendations
Reuse CASE-22 for the displayed summary and CASE-21 for the related API total, retaining each case's quantity/expected total and unchanged R-CART-2/C2. Assess existing checks before new coverage design.

For later requested execution, record app build, test commit, fixture, environment and configuration and actual outcomes. Reassess implementation/caller scope once a selected fix diff/baseline is available. No confirmed coverage gap currently authorizes automatic additions; broader scope needs selected requirements/callers.

## Limits and handoff
No supplied fix effects, reproduction or improvement can be certified. No maintenance assessment, accepted plan baseline or comparable cohort is selected; no history/budget change follows.

The source owner should supply the intended change/fix and baseline when available, plus existing run context for later comparison. This does not block the initial behavior recommendation. Later diagnosis/repair belongs wholly to maintain-test with existing history/gates; regression belongs to execution/automation. No handoff, test, diagnosis, repair, edit, state change or external action was started.
