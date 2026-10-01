# M12: optional Azure DevOps adapters

ADO is optional. Local specifications, environment profiles, the execution core and
browser/API/DB runtimes work without ADO configuration, credentials or network
access to ADO. M12 does not implement the M13 generation/review/verification
integration or M14 reporting. Node 24 remains the supported runtime.

## Boundaries

| Responsibility | Module | Behavior |
|---|---|---|
| Source loading | `scripts/lib/integrations/ado-source.mjs` | Two concrete local/ADO source choices; neutral scenario conversion and optional external identities |
| Outcomes and work items | `scripts/lib/integrations/ado-management.mjs` | Publish validated outcomes, mark automation, tag items and convert a selected parent relation to Related |
| Source-control delivery | `scripts/lib/integrations/ado-delivery.mjs` | Preview/create and verify an ADO PR; never push, merge or change branch policy |
| Transport and receipts | `scripts/lib/integrations/ado-client.mjs` | Destination-bound credentials, HTTPS, bounded IO, redirect refusal, explicit writes and flushed receipts |
| Consumer compatibility | `scripts/lib/integrations/compatibility.mjs` | Existing command names, consumer files and legacy verification input |

No generic adapter registry, workflow engine or execution-core changes are needed.
Application environment capabilities do not authorize publishing to shared test
management or source control. A configured `test` environment continues to permit
ordinary application testing without per-mutation harness approval. External
delivery has its own explicit execution flag.

## Consumer configuration

Configure only consumers that use ADO, in `.harness/integrations.json`:

```json
{
  "version": 1,
  "ado": {
    "organizationUrl": "https://dev.azure.com/your-org",
    "project": "SyntheticProject",
    "credentialRef": "ADO_CREDENTIAL",
    "planId": 1,
    "repository": "SyntheticRepository"
  }
}
```

`planId` and `repository` are optional explicit defaults. `automationField` may
name a project-owned `Custom.*` field; no private field is assumed. Standard TCM
automation fields work without a custom field. `timeoutMs` defaults to 30000 and
is capped at 60000; `maxResponseBytes` defaults to 2 MiB and is capped at 8 MiB.
Requests are also size bounded. Lists have 100-page/10000-record limits and suite
execution sources are limited to 500 cases with 1000 expanded steps per case.

Resolve the named credential from the shell environment or the consumer's ignored
`.env`. Existing shell values take precedence. The loader does not mutate the
process environment, read package credentials or persist a credential in receipts.
Use privileges appropriate to the requested ADO action. Do not commit credentials.
The adapter resolves the configured project's canonical ID/name with the bounded
read-only Projects API. Credentials therefore also need project-read access.
Work-item and shared-step reads must return matching `System.TeamProject`
ownership; repository responses must identify the same project. A project segment
in a work-item URL alone is not an ownership check for collection-scoped IDs.

For existing consumers, `config/project.json`'s `azure` section and the established
`AZURE_ORG`/`AZURE_URL`, `AZURE_PROJECT`, `AZURE_DEVOPS_EXT_PAT`/`AZURE_PAT`
settings remain supported. EXT_PAT takes precedence. Legacy fetch destination
flags are supported only when modern configuration is absent. A malformed modern
file fails explicitly; it does not fall back to another destination. There are no
private org/project, environment, repository, custom-field or `master` defaults.

REST API 7.1 is the supported contract. Older server/API variants are not silently
tried. The contract tests do not establish compatibility with every ADO Server
release, process template or tenant permission policy.

## Compatibility commands

Paths below are examples relative to a separate consumer. All five entrypoints
accept `--project-root`; package-as-consumer and paths escaping the consumer are
refused, including resolved junction escapes.

```sh
node ../playwright-pom-harness/scripts/fetch-ado-suite.mjs --project-root . --plan 1 --suite 2
node ../playwright-pom-harness/scripts/fetch-ado-suite.mjs --project-root . --plan 1 --suite 2 --source-out scenarios/synthetic.json
node ../playwright-pom-harness/scripts/publish-ado-results.mjs --project-root . --suite 2
node ../playwright-pom-harness/scripts/tag-ado-workitem.mjs --project-root . --ids 101,102 --tag synthetic
node ../playwright-pom-harness/scripts/relink-ado-story.mjs --project-root . --id 201 --story 200
node ../playwright-pom-harness/scripts/ado-pr.mjs --project-root . --source feature/synthetic --title "Synthetic change" --description-file pr-description.md
```

All remote mutation commands now **preview by default**. After authorization,
repeat with `--execute`. `--dry-run` remains an explicit preview alias; combining
it with `--execute` fails. Reads and preview can contact the explicitly configured
ADO service and need read credentials. Fetch writes consumer files unless
`--dry-run` is supplied, but never mutates ADO. Existing `--self-test`, list, fetch,
force, description-file, draft and JSON entrypoints remain available. Output is
structured JSON; success is exit 0 and any failure is exit 1. Legacy distinct
numeric error codes and automatic publication are intentionally discontinued.

Fetch retains `_suite.json` and Markdown specifications. It preserves files with a
Refinement log unless `--force` is supplied and checks the prior manifest's ADO
identity before reuse. Nested shared steps are resolved with cycle/depth limits;
missing cases/shared items or partial parsing fail instead of producing invented
assertions. Parameter metadata and data-table XML are retained, with the legacy
table projection where recognizable. `--source-out` additionally exports the
neutral local-source format. Parameterized cases and incomplete action/assertion
semantics require explicit refinement into that format; conversion fails before
any output changes. Local loading of a reviewed local file never resolves ADO
references over the network.

New manifests include `sourceFingerprint`. The legacy verification record must
copy that fingerprint from the source actually verified. Refetch changes it when
source content changes; stale verification is refused. Preserved refinement and
historical delivery metadata still require review after a source change. Old
manifests without this fingerprint retain the legacy verification contract and
cannot claim the stronger evidence integrity of an M5 run.

## Publication and linking

Library callers use `prepareRunPublication(run, roots, observations, mapping)` to
validate through the execution core before obtaining immutable publication rows.
The mapping must cover exactly the validated scenarios with distinct ADO case IDs.
The adapter does not change verdicts or retry assertions. The receipt includes a
fingerprint linking publication to its validated input. Business outputs, evidence
payloads, freeform legacy notes and credentials are not sent to ADO.

| Harness status | ADO outcome |
|---|---|
| PASS | Passed |
| FAIL | Failed |
| BLOCKED | Blocked |
| SKIPPED | NotExecuted |
| NEEDS_REVIEW | Blocked |

The result comment retains the exact harness status/stability so the final two
blocked categories remain distinguishable. Recovered passes remain recovered.

The compatibility publisher explicitly consumes legacy `_verify-state.json`,
not execution-core evidence. Its cases must exactly match the manifest. Passed
cases need at least two scoped greens; unknown or pending-confirmation statuses
refuse publication. `--all` no longer bypasses verification. `--point-map` accepts
a consumer JSON object mapping case IDs to point IDs, required when multiple
configurations make the point ambiguous. Missing cases/points/results never
silently disappear. Publication verifies results from its own run, then completes
and rereads that run and its results. Result-ID/point-ID associations must remain
identical, along with case/run identities when returned. It does not infer success
from a shared point's latest outcome.

`--mark-automated` retains working-script eligibility: passed, or failed with
app-defect classification. A literal, unambiguous generated test pointer is
required. `--value "Not Automated"` reverses the standard pointers in the selected,
verified scope. Optional custom marking uses only the configured field.
Relative generated paths may contain spaces and Unicode; absolute/traversal paths
remain invalid.
Tagging and relation changes use revision tests and fresh readback, preserve
unrelated data, and skip already-satisfied changes. Relation identity is bound to
the configured collection, not merely a matching trailing work-item number.

PR delivery requires an explicit/configured repository and remote source and
target refs. The default target is the repository's actual default branch. The
actual default branch is also refused as a source, regardless of its name. It
does not infer repository identity from an unrelated Git remote, truncate a long
description, or automatically attach comments. Authorization must cover the
specific external delivery; never silently rerun an uncertain creation.

## Receipts and incomplete effects

Executed writes create append-only `.harness/state/integrations/<id>.jsonl`
receipts, already ignored by consumer adoption. Prepared and dispatching events
are flushed before each request. Receipts retain destination/request/input
fingerprints, remote identities, acknowledgment, verification and completion.
Already-known work-item, plan/suite and repository identities are recorded before
their writes, including deliveries that later lose a response.
They exclude payloads, credentials, titles, notes and local absolute paths.

An acknowledged write with failed readback remains incomplete. A timeout,
connection loss or other unverified response after dispatch is conservatively
recorded as uncertain. No automatic write replay occurs, including after a
revision conflict. Multi-write delivery stops at the first failure and retains
earlier events. A crash can leave a final dispatching event; reconcile that
receipt and remote state before authorizing another invocation. This is an audit
boundary, not a resumable job engine or automatic rollback system.

## Validation and references

Run `npm run test:integrations` and the complete package checks. The fixtures map
a synthetic HTTPS destination to a real local HTTP server through an injected
test transport; production requests require HTTPS. They validate adapter and
compatibility contracts, not a live tenant's process rules, permissions, TLS or
service behavior. No live external writes are authorized by the M12 milestone.
See [M12 validation](M12-VALIDATION.md) for actual results and limitations.

The implementation follows Microsoft's [suite continuation contract](https://learn.microsoft.com/en-us/rest/api/azure/devops/testplan/suite-test-case/get-test-case-list?view=azure-devops-rest-7.1)
and [point pagination](https://learn.microsoft.com/en-us/rest/api/azure/devops/test/points/list?view=azure-devops-rest-7.1).
Revision-guarded JSON patches follow [work-item updates](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/update?view=azure-devops-rest-7.1),
and source-control requests follow [PR creation](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/create?view=azure-devops-rest-7.1).
Project ownership checks use [configured project resolution](https://learn.microsoft.com/en-us/rest/api/azure/devops/core/projects/get?view=azure-devops-rest-7.1)
and the `System.TeamProject` field from [work-item reads](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-item?view=azure-devops-rest-7.1).
These documents informed project-authored code; no third-party implementation
was copied and no dependency was added.
