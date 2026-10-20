# Edit existing ADO test cases

`pom-harness edit-cases` changes selected existing cases in the configured ADO
project. It does not create cases, alter suites, or accept changed requirements.
The process's `Microsoft.TestCaseCategory` determines eligible types.

## Input and approval contract

Keep proposals in an ignored consumer artifact, for example
`.harness/runs/case-edit/proposal.json`:

```json
{
  "version": 1,
  "cases": [
    {"id": 101, "revision": 7, "title": "Accepted case title"},
    {
      "id": 102,
      "revision": 3,
      "steps": [
        {"id": 4},
        {"id": 2, "expected": {"text": "The accepted result is visible"}},
        {"id": 9, "action": {"text": "Open the record"}, "expected": {"html": "<p>Record is <b>visible</b></p>"}}
      ],
      "removeStepIds": [6]
    }
  ]
}
```

`steps` is the complete desired order. Existing IDs with omitted content keep
their exact original XML. Omitted existing IDs require explicit `removeStepIds`;
removed IDs cannot also appear in `steps`. New IDs must exceed the source's
`last` allocation counter and provide both action and expected result. At least
one step remains. Each content value has exactly one of `text` or `html`.
Plain text is XML-escaped; supported formatted HTML is validated and XML-escaped.
Insertion advances `last`; removal/reordering never reuse previously allocated IDs.

Unknown fields, duplicate IDs, empty titles/actions, malformed XML, contradictory
removals, parameters/shared references and unsupported embedded content refuse
content editing. Title-only changes do not parse or rewrite steps/parameter data.
Input is limited to 2 MiB, 100 selected cases and 1,000 steps per case; individual
content values to 64 KiB. Requests also respect configured ADO body bounds.

```sh
npx --no pom-harness edit-cases --input .harness/runs/case-edit/proposal.json
# Review the destination, revisions, complete before/after changes and fingerprint.
npx --no pom-harness edit-cases --input .harness/runs/case-edit/proposal.json --execute --approval <preview-fingerprint>
```

Preview is the default; `--dry-run` is its explicit alias. It performs authenticated
reads and zero remote mutations. Its JSON contains case content: retain it only
in private consumer artifacts. Obtain explicit authorization for that exact
preview before using `--execute`; the flag alone supplies no approval fingerprint.
Execution rereads every selected case and validates the whole batch before the
first write. Destination, proposal, current revisions and before/after content
are fingerprint-bound; changed inputs or sources require a new preview/approval.

## Outcomes and recovery

Only `System.Title` and `Microsoft.VSTS.TCM.Steps` may be patched. Every write
tests `/rev` and is followed by an uncached read of the case and new revision.
Unrelated fields, relations, parameters, tags and automation pointers are not
written. No-op cases generate no PATCH. The existing bounded client owns requests
and fsynced, sanitized delivery receipts under `.harness/state/integrations/`.

Execution returns per-case `completed`, `no-op`, `failed`, `uncertain` or
`not-executed`, plus the receipt. Incomplete batches exit 1, including acknowledged
writes whose readback is unavailable or mismatched. A batch is not atomic: stop
at the first failed/uncertain write and retain earlier completed outcomes. There
is no automatic replay or rollback. After interruption or lost acknowledgement,
inspect the receipt and refetch the affected cases before retrying. Reconcile
their current revisions/content, omit completed edits, then prepare and authorize
a fresh proposal for only remaining work. Original revision tests prevent replay
of an already applied batch.

## Refetch and maintenance

Fetch the affected suite/story with `--revisions` into a new `--out` location, preserving the old
manifest, snapshots and failure history. Compare the new revision against the
executed source. Expected-result changes need an explicitly accepted requirement
revision and its evidence; editing ADO does not provide that acceptance. Continue
through [maintenance](maintenance.md), retaining repair budgets, independent review
and two fresh scoped green verification runs. Case edits never mark automation
verified or rewrite frozen execution/generation state.

```sh
npx --no pom-harness fetch-suite --plan 1 --suite 2 --revisions --out .harness/runs/case-edit/refetched
```

## Implementation and proof

Reuse test-management's work-item ownership reads, category discovery, the shared
ADO transport and delivery receipts. Keep strict ordinary-step XML editing beside
the existing read-only parser; do not make that compatibility parser a serializer.
Injected-transport, CLI and installed-package tests cover preview/approval,
preservation, conflicts, bounds, partial batches and uncertain readback. They do
not establish live-tenant write compatibility; optional tenant proof is separate.

The revision guard follows Microsoft's [Work Items Update REST 7.1 contract](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/update?view=azure-devops-rest-7.1).
