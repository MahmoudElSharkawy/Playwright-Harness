# Planning baseline review — legacy-orders-cycle / L3

**Assessment:** the accepted consumer release notes provide an equivalent planning baseline in their original format. LEG-DEC-3 binds QA-Lead's scope and criterion acceptance to this exact L3 edition; migration into the harness template is unnecessary. This is a planning/handoff assessment, not cycle completion.

Original reference: [consumer release notes](../../../../inputs/equivalent-plan.md). Located evidence remains authoritative:

| Baseline fact | Original location and assessment |
| --- | --- |
| Identity, source, decision and conditions | Lines 3–6: legacy-orders-cycle/L3; Product-Owner accepted LEG-R3; build l3/qa-legacy; QA-Lead accepted this edition through LEG-DEC-3. |
| Scope and exclusions | Lines 8–12: LEG-1 on Chrome only; payment and other releases excluded by LEG-DEC-3. RISK-PERSIST links LEG-1 to persistence loss, with material impact and unknown likelihood. |
| Designed versus executed | Lines 10–12: CASE-501 currently maps LEG-1 through saved-value/reload assertions. No run results are supplied; this is designed/planned coverage. |
| Feasibility | Lines 14–17: one elapsed day and four person-hours available to QA-A. Owner estimate totals four person-hours: two checks + one evidence/triage + one contingency, based on the same fixture/browser scope. Capacity equals that estimate, including contingency; readiness remains unverified. No resource booking or unconditional completion commitment follows. |

The following handoff preserves the accepted criterion IDs, meanings and owners from original lines 19–24. Every row is bound to L3 / LEG-R3 / LEG-1 / Chrome / l3 / qa-legacy and the selected one-day cycle.

| Criterion / type / parent | Accepted condition and population/window | Intended evidence / decision owner |
| --- | --- | --- |
| LEG-IN / entry / LEG-1 | Fresh selected-case fixture/access readiness before execution for the selected scope | Existing readiness receipts; Env-Owner |
| LEG-OUT / exit / LEG-1 | The **one** selected rule/browser point has compatible native outcome/assertion evidence during the cycle; duplicate references/retries do not increase this denominator | Native results plus CASE-501's mapped saved-value/reload assertions; QA-Lead |
| LEG-STOP / suspension / LEG-1 scope | Stop affected mutations if fixture ownership becomes uncertain during the cycle | Lifecycle evidence; Env-Owner |
| LEG-GO / resumption / LEG-1 scope | Reconcile effects and obtain fresh selected-case readiness before affected work resumes | Ownership/readiness receipts; Env-Owner |

A separately requested workflow can consume the original L3 document and LEG-DEC-3 directly, carrying the selected scope/exclusions, LEG-R3/build/environment/cohort, RISK-PERSIST, CASE-501 mapping, and LEG-IN/OUT/STOP/GO. Concrete fresh receipt and native run references remain to be supplied and checked for the applicable conditions/window by their stated owners. Named evidence types do not prove readiness, execution or successful outcomes.

The original document remains unchanged. No criterion was evaluated as passed; no cycle was closed, workflow handed off, case created, or source/tracker/generation state changed.