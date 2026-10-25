# Test-planning evaluation

Two fresh independent consumers completed the selected requests from
[requests.json](requests.json) using the canonical router/planning guidance and raw
synthetic [inputs](inputs/checkout.md). They received no intended answers, suspected
defects, fixes or prior grades. A third independent reviewer compared the actual
reports with those inputs and the issue's requirements.

## Actual outcomes

| Request | Independent grade | Evidence in the actual report |
| --- | --- | --- |
| [Checkout](evaluated/runs/test-planning/checkout/v1.md) | PASS | Eight accepted rule/browser points; current mapping limits and stale AC-3/q16 evidence remain visible. Ten-to-fourteen person-hours including contingency are compared with twelve available; the upper estimate exceeds capacity by two hours. Four scoped criterion types and unresolved readiness are retained. |
| [API revision](evaluated/runs/test-planning/api/v1.md) | PASS | All five accepted requirements retain strategy/coverage links. Applicable branch/version/fixture populations, effort and readiness stay unresolved where evidence is absent; no invented service operations or oracles. |
| [Incomplete sources](evaluated/runs/test-planning/missing/v1.md) | PASS | Useful partial draft without accepted baseline, invented owners/capacity or coverage denominator. The injected instruction and unaccepted 250 ms target do not become authority. |
| [Reorder](evaluated/runs/test-planning/reorder/v2.md) | PASS | Requested presentation changes preserve risk/criterion IDs, meanings and draft status. The exact [v1](evaluated/runs/test-planning/reorder/v1.md) remains intact. |
| [Changed baseline](evaluated/runs/test-planning/revision/v2.md) | PASS | Nine-point accepted matrix remains visible; the six Chrome-only omissions are an unaccepted proposal. Four available person-hours and the missing new estimate are explicit. DEC-7/results remain v1-bound; criterion lineage and supplied impact findings are reused. Exact [v1](evaluated/runs/test-planning/revision/v1.md) is preserved. |
| [Equivalent plan](evaluated/runs/test-planning/equivalent/L3-review.md) | PASS | Existing L3 format, decision and criterion IDs are consumed directly without migration or a completion claim; the one-point selected population is retained. |
| [Routing](routing-response.md) | PASS | Eleven owner/next-action answers preserve optional planning, individual-case routes, deferred gap-analysis independence and failed-candidate/exhausted-budget gates. No co-located history is assessed. |

The independent framework verdict was **APPROVE**, with no confirmed findings,
questions or open decisions. Zero runnable POM files changed: mechanical conventions
were **N/A**, with 0 PASS, 0 FAIL and 25 N/A checklist boxes. Harness consistency
and semantic outputs received actual review; no zero-scope linter pass is claimed.

## Integrity, execution and limits

Before/after snapshots found all **615 original package-source files** unchanged
during evaluation. All **23 consumer inputs, protected source/framework/tracker/
generation markers and prior plans** remained byte-identical. Only five plan drafts,
one equivalent-plan assessment and one routing capture were added. Exact copies
and both prior versions are retained here; per-file links, privacy and secret checks
passed. File comparison is not syscall monitoring.

Evaluator action records contain named/targeted skill and input reads, inventories,
hashing and exact report writes. No configured live target or credentials were
provided. No application/API/runtime execution, readiness probe, case creation,
repair, tracker/candidate update, downstream handoff or publication was performed.
Supplied results and decisions are synthetic inputs, not independently authenticated
live outcomes. No native-host parity, statistical effectiveness or model-token/cost
savings is established by these reports.

One combined report-write command exceeded the Windows command-line limit before
process creation; four separate writes succeeded. A read-only link-check command
had a parser error and its correction passed. During retention, the routing report's
consumer-root-relative input link failed when copied under `evaluated/`; retaining
identical bytes at the fixture root preserved that original link. No report text,
expected result or validator was rewritten to obtain a pass.

The portable skill/resource adoption assertion was **red first**: one selected test
failed because `test-planning` was absent, before the skill/playbook/template existed.
Skill metadata validation passed after implementation. Initial sandboxed focused
link/privacy attempts returned unreadable-candidate ERROR; the read-access runs
passed and remain distinct attempts. Package, regression and installed-archive
checks are separate delivery evidence, not inferred from semantic grades.

## Versions and digests

Source baseline: commit `053bceceae297943fc3bdd87069cb30176b9dfbf` plus the evaluated
working changes. Evaluation used Codex desktop collaboration agents with inherited/
default model configuration and no model override. Exact model deployment revision,
desktop client build and actual model usage are not exposed by this interface and
are unavailable; this limits exact replay and cross-model comparisons.

The original-byte source manifest digest is
`37470b1450ff294348b26d7f7c9714c4c8862577b1f5adc1977e799ebbbd222d`.
The following digests bind original evaluation bytes before any Git line-ending
normalization; they establish identity, not semantic quality.

| Output | SHA-256 |
| --- | --- |
| checkout | `249d4cffa789c14be0e68827e6de27371dc9ce98245ed6a80ca9ea4f1eb1c423` |
| api | `b904b7fc4453a9b127c127edda5a4258ecd9f0a5776fad3aa4e533cd888b740e` |
| missing | `512b8d7946e0048e6581a4429382e82ae61a0aafea9839aab4f35514b01e1d38` |
| reorder | `60991017d6037d6a941572564105464b1777e16df35cb4738f0bb4c368b9ec62` |
| revision | `7ae6f90d15b423da5f1058763e23da4493d5b3a69513194a8ca2b78c190d7b00` |
| equivalent | `8ee52714e17004bc85a85397e3b29da7980ba7fc65201bdeeabd208f7ce86812` |
| routes | `1d79206b6bd8ce1dd29f1b2f1753b24efbdce7d2a4ff0a5a96ecea38be7e97de` |

| Core source | SHA-256 |
| --- | --- |
| `test-planning/SKILL.md` | `24d57b75f6ba53c4eb80b1f3b3e2e19d3e187781a8e2cd68195efc9b0f2ba322` |
| `references/playbook.md` | `84561d9ab069fd4b49681634275060b4fee87e56884112827a97ebf599af3df3` |
| `assets/test-plan-template.md` | `ff805cd2ceb708d941fcb90dd5db1ab716cbbf1efe27d1d496cfa99201ca7361` |
| `docs/test-planning.md` | `b30248cee1a530cbee4ec0d59124206aae46d7c84807fce8b10cb910074648df` |
