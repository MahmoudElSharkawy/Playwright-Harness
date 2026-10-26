# Selected checkout planning evidence

All material in this fixture is synthetic. Source labels are evidence locations,
not live systems. No runtime, service, account or external publication is configured.

## source/checkout-r7 — accepted scope

Project Checkout; source CHK revision 7. The product owner accepted these four rules:

- AC-1: Saving a populated address updates the same cart's summary and persists after reload.
- AC-2: An empty postcode prevents saving, displays "Postcode is required" and preserves the saved address.
- AC-3: Cancel closes the editor without saving changes.
- BR-1: A shopper cannot update another shopper's cart; denied attempts leave the target cart unchanged.

The selected cycle must cover each rule in Chrome and Firefox, the only two required
browser cohorts here. Mobile, payment and unrelated checkout stories are outside
this cycle. Configuration qa-c1 and candidate application build q17 are selected;
no current access/fixture readiness receipt is supplied.

## cases/checkout-current — design evidence

| Case | Current mapping | Conditions / limit |
| --- | --- | --- |
| CASE-101 | AC-1, steps 2-3, changed-address data and reload assertion | CHK r7; Chrome only |
| CASE-102 | AC-2, steps 2-3, empty postcode and retained-address assertion | CHK r7; Chrome and Firefox |
| CASE-103 | AC-3, cancel and unchanged-address assertion | CHK r6 mapping; freshness against r7 has not been reviewed |

BR-1 has no selected case mapping. No selected evidence shows current q17 execution.
An older q16 Chrome pass for CASE-101 is supplied only as history, not a q17 result.

## constraints/cycle-a — supplied planning facts

Two elapsed working days. QA-A and QA-B each have three person-hours available on
each day, with no other team capacity supplied. Work may be split where independent;
the shared fixture must first be established. QA-Lead owns scope/exit decisions,
Env-Owner owns qa-c1 readiness, and QA-A/QA-B can perform the selected testing work.
Their availability is not an appointment made by this planning request.

QA-Lead supplies these activity estimates for this cycle, in person-hours:

| Activity | Estimate | Basis |
| --- | --- | --- |
| Access and owned-fixture setup | 2 | Owner estimate; current readiness unverified |
| Reuse review and needed design updates | 2-3 | Comparable prior address-form cycle |
| Scoped browser checks | 3-5 | Same two-browser scope; depends on setup/design |
| Triage and evidence/handover | 1-2 | Comparable prior cycle |
| Contingency | 2 additional | Explicit reserve, not included in the four rows above |

QA-Lead identifies wrong-cart modification as high impact because it exposes another
shopper's data. Its likelihood is unknown. Address persistence is business-critical;
no measured defect probability or numeric risk score is supplied. Priorities may be
recommended but the new plan has not been approved.

## decisions/cycle-a — criterion inputs

QA-Lead supplied these conditions for the cycle; they are not completed observations:

- Entry: q17 identity, qa-c1 access and each case's owned fixture must have current readiness evidence before its execution.
- Exit: all selected rule/browser coverage points must have compatible q17 outcomes without a failing or unavailable point, and unresolved critical wrong-cart defects require a scope-owner decision; evidence comes from native results and source-bound case mappings during this cycle.
- Suspension: suspend affected mutation work if the shared fixture's ownership/state becomes uncertain; preserve evidence and reconcile effects.
- Resumption: Env-Owner supplies a current case-scoped readiness/ownership receipt after reconciliation before affected work resumes.

No testing has been performed for this planning exercise. Save a draft with material
decisions and a useful handoff; do not invent an accepted plan decision.
