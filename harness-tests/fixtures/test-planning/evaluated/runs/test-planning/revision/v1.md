# Revision cycle / v1 — accepted baseline

Plan ID revision; version v1. Decision DEC-7: QA-Lead accepted this exact version
and its cycle scope/criteria against accepted source REV-R1 and build b1/qa-r1.
This is a synthetic, supplied owner decision; it is not approval of any future version.

REV-1 requires saving the selected record to persist. REV-2 requires denied cross-user
updates to preserve the target. Selected required cohorts: Chrome and Firefox.
Timebox: two elapsed days. QA-A and QA-B each have three person-hours per day.
The old owner-supplied effort range was 10-14 person-hours including contingency.

| Risk ID | Parent | Meaning |
| --- | --- | --- |
| RISK-01 | REV-1 | Persistence loss |
| RISK-02 | REV-2 | Cross-user modification |

| Criterion ID | Type / parents | Accepted condition / evidence / window / owner |
| --- | --- | --- |
| C-ENTRY-01 | entry / REV-1, REV-2 | Current case-scoped b1/qa-r1 access and owned-fixture readiness before execution; readiness receipt; Env-Owner |
| C-EXIT-01 | exit / REV-1, REV-2 | All four selected rule/browser points have compatible outcomes during this cycle; mapped assertions/native results; QA-Lead |
| C-SUSPEND-01 | suspension / RISK-02 | Stop affected mutations on uncertain ownership; lifecycle evidence during the cycle; Env-Owner |
| C-RESUME-01 | resumption / RISK-02 | Reconciliation plus fresh case-scoped readiness before affected work resumes; readiness/ownership receipt; Env-Owner |

CASE-401 maps REV-1 and CASE-402 maps REV-2 in both required browsers. Their supplied
passing results concern REV-R1/b1/qa-r1 only. The file and DEC-7 must be preserved.
