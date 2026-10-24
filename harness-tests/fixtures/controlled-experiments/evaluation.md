# Controlled-experiment evaluation

The implementation was evaluated after the merged change-impact work, using two
fresh independent consumers and a separate independent reviewer. Evaluators received
the canonical router/skills, selected requests, raw synthetic observations and retained
prior assessments. They received no expected answers, suspected defects or proposed
fixes. Reports were the permitted output; runtime execution and repair were excluded.

## Inputs and actual outputs

[Evidence](evidence.md) and [requests](requests.json) define the synthetic selections.
Each assessment below is retained unchanged beside the exact `prior.md` supplied to
its evaluator. Directory depth preserves the original evidence/prior links. The
routing answer is an evaluation capture, not another maintenance assessment store.

| Request | Independent grade | Evidence in the actual output |
| --- | --- | --- |
| [History](evaluated/state/maintenance/S510/assessment-eval.md) | PASS | Selected Chromium H1-H5: 2/5 first-attempt failures, 1/2 retry recovery, 2/2 conditional next-launch first-attempt recoveries and 2/4 adjacent transitions in each direction. Retains failures and excludes unselected Firefox H6. |
| [Collision](evaluated/state/maintenance/S520/assessment-eval.md) | PASS | C0/C2 varies owned key while holding order/workers. Separates primary 409 from cleanup 500, records alternative hypotheses and stops at 3/3 diagnostics. |
| [Readiness](evaluated/state/maintenance/S530/assessment-eval.md) | PASS | Contrasts loading/FAIL and ready/PASS with controls, disconfirmation and limits. One ready-gated observation supports the suspicion; it does not prove cause or stability. Stops at the existing bound. |
| [Dependency](evaluated/state/maintenance/S540/assessment-eval.md) | PASS | Retains primary 503/assertion failure and later cleanup timeout. Labels the selected failure/pass pair separately from an unknown historical denominator; the proposed controlled check remains unperformed. |
| [Deterministic](evaluated/state/maintenance/S545/assessment-eval.md) | PASS | Reports the selected 4/4 failures and 0/3 next-launch recoveries without a universal determinism claim. Preserves accepted 150 and rejects proposed, unaccepted 135. |
| [Changed inputs](evaluated/state/maintenance/S550/assessment-eval.md) | PASS | Separates build, fixture and quantity changes; preserves G0 and cumulative history. Proposes a build-only contrast against original inputs, with unknown remaining time unresolved. Reuses comparison in the same assessment. |
| [Empty CI](evaluated/state/maintenance/S560/assessment-eval.md) | PASS | Finds the pre-test image-pull failure. Empty results and missing shard establish no current case outcome or denominator; the previous commit's failure remains separate. |
| [Inconclusive](evaluated/state/maintenance/S570/assessment-eval.md) | PASS | Retains I1-I3 and the consumed 3/3 diagnostics and twelve minutes. A new assessment grants no further attempts; uncertainty and next owner/action remain explicit. |
| [Exhausted repair](evaluated/state/maintenance/S580/assessment-eval.md) | PASS | Rejects diagnostic PASS as a green, source renaming, a fourth repair and completion. Preserves V3 FAILED and 3/3 cumulative repairs. |
| [Blocked without spec](evaluated/state/maintenance/S590/assessment-eval.md) | PASS | A credential-renewal claim does not satisfy the exact fixture-read/readiness condition. Retains blocked REFINE, with no invented spec command or completion. |
| [Routing](evaluated/routes.md) | PASS | Explicit/natural flaky-test requests and combined analysis/repair use maintenance. Impact-only, execution, design and bug-draft requests keep their owners. Routing-only creates no assessment of co-located histories. |

All eleven reports passed independent semantic comparison with the raw selected
inputs. The separate framework review returned **APPROVE**, with no findings,
questions or open decisions. Its runnable POM checklist was **N/A**: zero POM code
changed; all 25 checklist boxes were N/A. Harness consistency and the actual reports
received read-only review; this was not a claim of a mechanical POM pass.

## Integrity and validation

Repository snapshots found all 579 pre-evaluation source files unchanged. Both
consumers' selected inputs and prior history remained unchanged; the only new files
were ten maintenance reports and one routing capture. Exact output copies and ten
prior-history inputs passed per-file link, privacy and secret checks. File comparison
does not establish syscall-level monitoring.

The portable-reference adoption assertion failed before the new reference existed.
After implementation, the fixed fourteen-check local checklist passed: syntax, JSON,
links, privacy, secrets, provenance, offline publication, contracts, all three nonzero
conventions scopes, types, fetch self-test and all **1,591 tests**, with zero failures,
skips or cancellations. Adoption verifies the same maintenance-owned resource is
reachable through both host skill links. The skill metadata validator also passed.
Added retained artifacts receive the affected static checks before delivery.

These are synthetic evidence assessments. Supplied outcomes were not independently
reproduced against an application, CI service or native runtime. No diagnostic,
repair, live tracker change or defect publication was executed. No native-host parity,
statistical stability or live causal validation is claimed. Proposed checks remain
unperformed, and ordinary repair/review/verification gates remain necessary.

The following SHA-256 digests bind the original evaluation bytes before any Git
checkout line-ending conversion. They are integrity evidence, not semantic grades.

| Output | SHA-256 |
| --- | --- |
| history | `33a61cc2ee773bb35cfb1f66bd4d47d68770b7c59ac80edaca9c972143541a05` |
| collision | `595d21977419a94fc54e30a187011e070be4daf44209ed1407e82cecd2d45ed3` |
| readiness | `d3079abb6aeb4de2476c8b9f7a24792700ae33209cf07fafb92db45d83cd75d5` |
| dependency | `8b2c7e0c79e827417aa5be0b38547c5c84207cdee122f7fe38edab0c845d101f` |
| deterministic | `87e0a5ee2b70e71a28ea2fd916f2b6888b9ac14fc47bbd0df0aaf534ac09a73d` |
| changed-inputs | `650a1a2db44a35eb3974fc1945fb6f5fee874d788290a4819a6e4851e2d278d2` |
| empty-ci | `762cd6719c28594db56665583fea0d56e65959f74a52536a99c6ca9687e92781` |
| inconclusive | `946b2b90c47748d2334fb2633bdedba34af72aa7858736f02518800c78b86165` |
| exhausted-repair | `587ef695f38ea6190827010c6780f7adaeb0df3c994efef0ec2d5aaa89b9abbc` |
| blocked-no-spec | `20c09d0eddb890afe92e5359f2da27ef0df2e0cd7d85aab926fdaced4c98b84d` |
| routes | `6def09887292505ed668bbb31a057aabd08ee4de0e629dd7dd024e03e39d5f5b` |
