# Azure DevOps integration

ADO is optional for local automation and application browser/API/DB execution.
Configure it for suite/story retrieval, traceability, publication, work-item changes
or ADO PR delivery. Application operation permissions and external delivery authorization
are separate. Start with [configuration](configuration.md) and [automation](PIPELINE.md).

## Configure the connection

Create consumer `.harness/integrations.json`:

```json
{
  "version": 1,
  "ado": {
    "organizationUrl": "https://dev.azure.com/your-org",
    "project": "YourProject",
    "credentialRef": "ADO_CREDENTIAL",
    "planId": 1,
    "repository": "YourRepository"
  }
}
```

planId/repository are optional defaults. ADO credentialRef is a bare environment
variable name, unlike target `env:NAME`. Shell values precede ignored consumer `.env`;
the loader neither changes process environment nor reads package credentials.
Use privileges for the action, including project-read access for canonical ID/name.
`automationField` may name a project-owned Custom.* field; standard TCM fields need none.
Optional `ado.bugs` configures paths, assignment, tags, scalar fields and attachment bounds.

Legacy config/project.json azure settings and AZURE_ORG/AZURE_URL, AZURE_PROJECT,
AZURE_DEVOPS_EXT_PAT/AZURE_PAT remain supported; EXT_PAT precedes PAT. Legacy fetch
destinations apply only without modern config. Malformed modern config fails rather
than silently falling back. No private destination/branch/custom-field defaults exist.

REST 7.1 requests require production HTTPS, refuse redirects and bound I/O. Timeout
defaults to 30 seconds/max 60; response defaults to 2 MiB/max 8, with bounded bodies.
Lists cap at 100 pages/10,000 records; execution sources at 500 cases/1,000 expanded
steps per case; stories at 1,000 distinct linked items. These are adapter contracts,
not universal ADO Server/process/tenant compatibility. Work items/shared steps must
return matching System.TeamProject, and repositories identify the configured project.
A project segment in a URL is insufficient for collection-scoped work-item IDs.

## Fetch storage and migration

Run installed commands from the consumer:

```sh
npx --no pom-harness fetch-suite --plan 1 --suite 2
npx --no pom-harness fetch-suite --plan 1 --suite 2 --source-out scenarios/suite.json
npx --no pom-harness fetch-story --story 200
npx --no pom-harness fetch-story --story 200 --links tested-by,related --source-out scenarios/story.json
```

Fetch writes `_suite.json` and case Markdown under
`execution-tests/ado-suite-<suiteId>/` or `execution-tests/ado-story-<storyId>/`.
`--out` selects a parent; `--dry-run` previews without files. Fetch never mutates ADO.
`--source-out` also exports neutral automation input. Refinement logs are preserved
unless `--force`; previous destination identity is checked before reuse.

Nested shared steps have cycle/depth limits. Missing/partial content fails rather
than inventing assertions. Parameter metadata/table XML is retained; parameterized
or incomplete semantics need explicit refinement before neutral conversion, which
fails before changing outputs. A reviewed local source never resolves ADO references.

Older consumers manually move complete ado-suite-/ado-story- folders from `test/`
to `execution-tests/`, preserving manifests, refinements, traceability and verification
state after reconciling destinations. Setup does not move them; current readers use
only execution-tests.

## Story links, identity and changes

Story fetch follows Tested By by default. `--links` allows tested-by, child and
related; cases changed by relink-story become Related. Selected URLs must match the
configured collection/project name-or-ID form; aliases/foreign forms fail rather
than silently reducing scope. Test-case types come from Microsoft.TestCaseCategory,
including localized/custom types; a test case cannot be used as a story.

Foreign/non-case items are excluded by ID/reason without titles/steps. Deleted/
unreadable items, zero cases and exceeded limits fail the fetch. Included cases share
suite parsing contracts; manifests retain storyId/storyTitle/links and reject mismatched
destination or source identity. Neutral source ID is `ado-story-<storyId>`.

New manifest sourceFingerprint flows into legacy verification state. Changed content
invalidates stale verification; review preserved refinements/delivery data on refetch.
Older manifests retain weaker legacy contracts. Story fingerprint covers title, links
and included cases, excluding unrelated exclusions. Metrics/tracker include both
source kinds: shared cases count once using newest verification; conflicting recorded
results become no-state and tracker sync warns/skips them. Story retrieval supplies
cases, while outcome publication needs suite test points.

## Preview and deliver automation outcomes

Remote mutation commands preview by default. Review concrete scope/destination,
obtain authorization, then repeat with `--execute`. `--dry-run` is a preview alias
incompatible with execute. Previews may contact ADO and need read credentials.
Structured JSON returns exit 0 on success/1 on failure.

```sh
npx --no pom-harness publish-results --suite 2
npx --no pom-harness tag-workitem --ids 101,102 --tag reviewed
npx --no pom-harness relink-story --id 201 --story 200
npx --no pom-harness pr --source feature/example --title "Example change" --description-file pr-description.md
```

Compatibility publication reads `_verify-state.json`, not core evidence. Cases match
the manifest exactly; passed cases need two scoped greens. Unknown/pending states
refuse publication and `--all` does not bypass verification. `--point-map` resolves
ambiguous configurations using consumer JSON case-to-point IDs. Missing scope never
silently disappears. Publication checks run/result/point associations, completes and
rereads the run. Library `prepareRunPublication(run, roots, observations, mapping)`
instead reassesses core evidence and requires complete mapping with distinct case IDs.

| Harness status | ADO outcome |
|---|---|
| PASS | Passed |
| FAIL | Failed |
| BLOCKED | Blocked |
| SKIPPED | NotExecuted |
| NEEDS_REVIEW | Blocked |

Comments preserve status/stability without outputs, evidence payloads, freeform notes
or credentials. `--mark-automated` requires a working-script eligible case (passed or
failed as app defect) and literal unambiguous test pointer; run it after merge.
`--value "Not Automated"` reverses standard pointers within verified scope. Paths
may contain spaces/Unicode but cannot be absolute/traversing.

Tags/relations use revision tests/readback, preserve unrelated data and skip satisfied
changes; relation identity includes the collection. PR creation needs explicit repository
and remote source/target refs, defaulting target to the repository default branch,
which cannot be the source. It never pushes, merges, changes policy or infers unrelated
remotes. Descriptions are not truncated and comments not automatically attached.

## Manual execution delivery

[Manual execution](manual-execution.md) reassesses inputs/evidence; unrepaired integrity
failure blocks bugs/results. Changed cases are excluded unless include-changed.
`execute file-bugs <exec>` and `execute publish-results <exec>` preview first.

Bug preview validates process/category/fields/paths and validateOnly creation. Reliable
matching FAILs are default; `--include needs-review,diagnostics` widens scope and drafts
can select `file: false`. Stable defect tags group iterations/reruns without timestamps,
run IDs, environments or actual values. Open duplicates are skipped; closed duplicates
receive Related links. Browser defect attachment provenance follows current assertion
evidence rules; old evidence cannot be upgraded through delivery.

Suite outcome aggregation is FAIL > NEEDS_REVIEW > BLOCKED > all-SKIPPED > PASS.
Omissions are listed. Runs are manual (`automated: false`); bounded ASCII comments
retain method counts, bug IDs and revisions. Story executions can file bugs but cannot
publish suite outcomes. Resume retains saved selection/comments/identity after reassessment.

One delivery owns an execution; concurrent calls return BUSY. Create intents flush
before dispatch and acknowledgements persist identities in the same fsynced record.
Bugs reconcile by filing tag; runs use plan-scoped paged List Runs and exact names.
Missing matches remain UNCERTAIN, requiring explicit recreation/new-run authorization.
Uncertain attachments repeat only with explicit fingerprint/hash recreation.
See the [delivery procedure](../.agents/skills/execute-test/references/delivery.md).

## Receipts and references

Compatibility writes append ignored `.harness/state/integrations/<id>.jsonl` receipts.
Flushed prepared/dispatching events retain destination/request/input fingerprints,
known remote identities, acknowledgement/readback/completion without payloads, titles,
notes, secrets or absolute local paths. Acknowledged writes with failed readback remain
incomplete; lost replies after dispatch are uncertain. No automatic replay follows
revision conflict. Multi-write delivery stops at first failure retaining prior effects.
Reconcile dispatching receipts/remote state before another authorized invocation.
This is an audit boundary, not automatic rollback or a resumable compatibility engine.

`test:integrations` uses synthetic destinations/injected transport, not live tenant
proof. See archived [adapter validation](archive/milestones/M12-VALIDATION.md),
[story validation](archive/validation/ADO-STORY-VALIDATION.md) and
[manual validation](archive/milestones/M19-VALIDATION.md).

Microsoft references informing project-authored code include
[suite continuation](https://learn.microsoft.com/en-us/rest/api/azure/devops/testplan/suite-test-case/get-test-case-list?view=azure-devops-rest-7.1),
[point pagination](https://learn.microsoft.com/en-us/rest/api/azure/devops/test/points/list?view=azure-devops-rest-7.1),
[work-item updates](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/update?view=azure-devops-rest-7.1),
[PR creation](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/create?view=azure-devops-rest-7.1),
[project resolution](https://learn.microsoft.com/en-us/rest/api/azure/devops/core/projects/get?view=azure-devops-rest-7.1),
[work-item reads](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-item?view=azure-devops-rest-7.1),
[link types](https://learn.microsoft.com/en-us/azure/devops/boards/queries/link-type-reference?view=azure-devops) and
[type categories](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-item-type-categories/get?view=azure-devops-rest-7.1).
