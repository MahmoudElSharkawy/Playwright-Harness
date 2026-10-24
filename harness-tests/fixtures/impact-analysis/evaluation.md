# Recorded impact-analysis evaluation

These are synthetic forward evaluations of the guidance, separate from mechanical
package tests. Raw selected sources are in [evidence.md](evidence.md); the unchanged
requests are in [requests.json](requests.json). Retained reports are actual model
outputs, not hand-written expected answers. Fresh delegated Codex agents used the
configured default model; no model override or native-host parity measurement was made.

An independent reviewer compared impact paths, regression choices, acceptance and
workflow ownership against those raw sources. Nine initial requests passed; the
routing request failed because it imported unselected history from the composite
fixture. A composite-selection clarification alone did not fix the next response.
Moving owner selection before comparison, with a routing-only short circuit,
produced the passing third response. Both earlier failures remain unmodified:
[initial](evaluated/routes-initial.md), [second](evaluated/routes-second.md).
The scoped final review approved that correction; it did not repeat the other nine
evaluations or pretend the first attempts passed.

| Request and actual output | Independently checked result |
| --- | --- |
| [Accepted story](evaluated/story-accepted.md) | PASS: CASE-10 conflicts with D7; reuse CASE-12/13 boundaries and CASE-15 shared registration; retain CASE-11; exclude the evidenced profile flow, keep stale/API mappings uncertain and flag PLAN-7. |
| [Proposed story](evaluated/story-proposed.md) | PASS: minimum 16 stays conditional; accepted 12 remains authoritative, with the existing CASE-10 conflict kept separate. |
| [Design flags](evaluated/design-flags.md) | PASS: confirmed reset dependency/gap, dismissed profile premise, uncertain SSO and reuse of existing 11/12 boundary cases; no design scope expansion. |
| [Exact selected ID](evaluated/exact-id.md) | PASS: bind Cedar capture rather than Birch; trace direct CASE-21 and indirect CASE-22; resolved status does not verify F456. |
| [Symptoms without fix](evaluated/bug-no-fix.md) | PASS: initial behavior checks and explicit unknown technical impact, without borrowing F456/C3, inventing a cause or classifying a flake. |
| [Shared service/external contract](evaluated/shared-contract.md) | PASS: trace old-field consumers and preserve C2/unchanged numeric expectations; C3 recommendations remain conditional. |
| [Changed cohort/stale handoff](evaluated/cohort-stale-handoff.md) | PASS: name revision/build/fixture and omitted-summary changes; preserve FAIL and 2-of-3 repair consumption; recommend reassessment without diagnosis. |
| [Ambiguous ID](evaluated/ambiguous-id.md) | PASS: distinguish Cedar/Birch and request project selection without choosing one. |
| [Inaccessible source](evaluated/inaccessible.md) | PASS: HTTP 403 supports no invented item content or regression scope. |
| [Routing, third response](evaluated/routes.md) | PASS after two failures: all eight owners/next actions are correct; combined analysis/repair has one maintenance owner/assessment; no comparison of unselected histories or cohorts. |

File-integrity checks found the initial evaluation's 563 repository source files
unchanged, and the selected consumer inputs, retained history and prior reports
unchanged across the evaluations. Each evaluator added only its requested report(s).
Retained copies match the originals' SHA-256 values, including routing attempts.
These hashes identify the original UTF-8/LF bytes; a Git checkout configured to
convert Markdown to CRLF changes checkout bytes, not these recorded originals.

| Attempt | SHA-256 |
| --- | --- |
| Initial, failed | `b90b0fbb06112affe1cae107852af53c89110670ca706f842941e08dfab865df` |
| Second, failed | `4a29861d98bc0b12db29cf0dd804e45b79b4d52a31e8361f0621f330b8208224` |
| Third, passed | `a95c262f4904e701f8404c5b1fc04c22b2a4153ca567b0bbeadb4b5e33b30e28` |

Canonical discovery was red before adding the skill. The local fixed checklist then
passed all 1,591 tests with no skips/cancellations and its other checks except the
offline pack inventory, which rejected three dependency junctions in the disposable
proof clone. Removing only those verified junctions after testing allowed that check
to pass; final affected source/link/privacy/secret/provenance checks are separate
from the semantic evaluation. The changed-only POM linter is N/A (no runnable POM
files changed); the fixed checklist's three nonempty convention scopes passed.

Limits: supplied snapshots/excerpts only. The exact-ID case uses a synthetic captured
response, not a live ADO read. No application/test/diagnostic execution, repairs,
publication or tracker handoff was performed by the evaluators. File hashes are
integrity evidence, not syscall monitoring; these results establish neither live
tracker behavior nor equivalence between native Claude and Codex sessions.
