# Impact analysis: cohort-stale-handoff

## Change
Selected source: Cedar / Bug 456 / revision 5 / Resolved, capture/cedar-456.json#/item; F456 (changes/F456.diff:1-5), current cart callers, M-CART-A3 and X1/X2. These are synthetic evidence.md excerpts, not live tracker, deployment or runtime proof.

F456 proposes replacing cart.total with sumCurrentLineTotals(cart.lines) in application recalculation; it is not merged/deployed. R-CART-2 and C2's {total: number} response remain accepted. Resolved status proves no fix/deployment/passing retest. Separate C3 is outside scope.

## Impact map

| Target | Supported path/evidence | Finding |
| --- | --- | --- |
| CASE-21 / R-CART-2 | F456 -> PATCH handler (application/cart/routes.ts:12-16) -> service PATCH/body and verifyTotal (src/apis/ApisCart.ts:8,24-34) -> CASE-21 tc21.item/quantity/expectedTotal (tests/CartTests.spec.ts:18-22). | Confirmed direct API dependency; reuse existing check. |
| CASE-22 / R-CART-2 | PATCH total -> renderSummary (application/cart/summary.ts:10-13) -> CheckoutPage form/rendered-total validation (src/pages/CheckoutPage.ts:12-31) -> CASE-22's quantity/expectedTotal (tests/CheckoutTests.spec.ts:19-24). | Confirmed indirect dependency omitted by M-CART-A3's CASE-21-only scope. |
| Data / harness layers | Separate Cart/Checkout paired quantities/expected totals; ApisCart calls/validates PATCH and contains no F456 implementation. C2: contracts/cart-v2.json#/PATCH. | Preserve expectations; no fixture/service/utility defect or edit established. |
| Locale / CASE-23 | Locale spec/selected complete profile methods read only locale field (tests/LocaleTests.spec.ts:16-19). | Dismissed for selected cart delta on affirmative evidence. |
| CASE-91 / other consumers | Removed LegacyCartPage lacks current mapping/retirement (trace/cart-old.json#/CASE-91); no payment/receipt/dynamic/database callers supplied. | Uncertain; neither safe exclusion nor confirmed dependence. |

## Findings: changed comparison inputs
M-CART-A3 (maintenance/cart-a3.md:1-5) binds Cedar Bug 456 rev 4, app b117, test t10, fixture f1, qa, config c1. It did not inspect renderSummary. Same item ID does not establish current revision binding or caller scope.

| Dimension | Old/reference | Other/current evidence | Implication |
| --- | --- | --- | --- |
| Source revision | M-CART-A3: Bug 456 rev 4 | Cedar Bug 456 rev 5 capture | Refresh binding; rev-4 content is unknown, so infer no actual requirement/symptom delta from number alone. |
| App build | M-CART-A3 / X1: b117 | X2: b118 | Changed build; no receipt links b118 to F456 or identifies implementation delta. |
| Fixture/input | M-CART-A3 / X1: f1, quantity 2 | X2: f2, quantity 3 | Changed comparison input; expected-total value for the fixture change is not supplied. |
| Test/environment/config | t10 / qa / c1 | X1/X2 retain t10 / qa / c1 | Matching dimensions do not compensate for app/fixture differences. |
| Outcome/scope | X1 FAIL, CASE-21 | X2 PASS, CASE-21 | Different app/fixture inputs: no controlled same-conditions repair retest. Neither covers CASE-22. |
| Caller scope | M-CART-A3 suggests CASE-21 only | Current renderSummary -> CheckoutPage -> CASE-22 | Reassess indirect consumer; no claim that the method itself changed. |

Samples: runs/cart-comparison.json#/samples. No same-build/fixture comparison is supplied. X1/X2 prove no root cause, flakiness, F456 efficacy or successful repair retest. No accepted requirement change or replacement plan baseline is established.

## Recommendations
Reuse CASE-21/22 against unchanged R-CART-2/C2 and each case's paired values. CASE-22 follows demonstrated dependency, not speculative cause. Resolve stale CASE-91/selected missing callers before broader coverage claims; reuse checks before new design.

Recommend maintain-test reassess M-CART-A3's source binding, caller scope and diagnostic cohort using this report. Its diagnostic specialist, when available, should establish meaningful recorded comparisons if diagnosis is later authorized. Obtain b118/F456 linkage and baseline evidence; certify no controlled repair outcome from X1/X2.

## Limits and handoff
Retain M-CART-A3's prior FAIL. Cumulative repair consumption stays **2 of 3**; this report spends/resets no round and replaces no history. Maintenance should reuse current findings in its one existing assessment/history with existing review/two-green gates, without another standalone assessment.

Maintenance/source owner should supply rev-4 content when the actual source delta matters, b118 change/deployment binding and comparable run evidence. No diagnosis, flake classification, test, repair, fixture/assertion edit, baseline approval, history/budget mutation, tracker update or handoff was executed.
