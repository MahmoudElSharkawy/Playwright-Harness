# Requirements analysis

Issue [#62](https://github.com/MahmoudElSharkawy/Playwright-Harness/issues/62)
adds orchestration around a separately installed, unmodified GapCue. The harness
owns source capture, one trace inventory, identity/freshness checks and optional
confirmed discussion delivery. GapCue owns analysis guidance, findings and its UI.
There is no second analyzer or automatic business-rule acceptance.

## Implementation contract

The first milestone is a real browser round trip on GapCue 0.3.0, commit
`54fa0180fe17ea5034825a14dbd1201fc129aabf`: source, minimal inventory, one analysis
and UI build, edited question, custom finding, edited comment, native decision
download, fresh-session recovery, then changed-source reassessment. Upstream's
saved schema is 2; its download adds `gapcue: 1` and `story`. A disk state alone
has no review identity. Neither its version number nor a matching finding ID
proves freshness. Establish these interfaces before extending orchestration.

Use immutable consumer source snapshots and retained native imports, with an
atomic current-state pointer. Bind reviews to consumer/project identity, source
content/revisions, a unique review ID, the exact input and dependency content.
An interrupted, incompatible, wrong-scope or incomplete import cannot replace a
valid handoff. Browser-only edits need native Download decisions; an initial
disk state is not proof of a completed review.

Each located source statement has one stable inventory ID. Inventory entries
reference source excerpts/revisions and explicit acceptance evidence, and carry
unresolved questions, assumptions, constraints and dependencies. Agent judgment
refines these entries before analysis. A source criterion or recorded owner
decision can support acceptance; finding approval/out-of-scope cannot. Preserve
unanswered discussion concerns even when excluded from outgoing BA questions.

On refresh, invalidate affected acceptance and review links by source content and
revision. Preserve prior imports and manually edited comments. Carrying decisions
requires an explicit semantic assessment of source and finding meaning; show any
proposed replacement comment beside its predecessor and confirm the affected text.
Planning reads the same inventory and review references, and cannot resolve rules.

Optional delivery resolves known ADO coordinates and credentials through existing
adapters. Preview exact HTML, originating story, source/discussion identity and the
single ordered comment write. Require confirmation of that exact payload, recheck
freshness immediately before dispatch, durably record the attempt, and reconcile
an uncertain outcome before another attempt. No other remote writes belong here.

## Proof plan

- Native browser save/export/readback, fresh browser context and new Node process.
- Identity, completeness, failed import, missing dependency and changed-content
  rejection; update/rollback retains prior sources, imports and comments.
- Complete/zero-gap, incomplete, contradictory, vague performance, boundary,
  unanswered discussion and revised-source fixtures, with analysis quality judged
  separately from transport. Spaces/special characters remain valid inputs.
- Confirmed, declined, changed, concurrent and uncertain publication fixtures.
- Planning references the existing IDs, revisions, evidence and unresolved rules;
  source changes make old references stale without another analysis invocation.
- Package links, privacy, roots, host discovery, integration checks and an
  independent framework review. Report actual host/version limits, not assumed
  support.

## Research receipt

`retrieve: used` Graphify identified existing ADO transport, consumer paths and
adoption contracts; live files were inspected. The index reports stale metadata.
`retrieve: skipped(no-relevant-hits)` MemPalace returned no applicable history.
The public contract and optional write require the written specification above.
Compared extending GapCue with wrapping its native CLI/export: choose the latter
to preserve the required upstream boundary and avoid a second UI/state authority.

## Separate dependency installation and compatibility

GapCue is [Abdelrahman Hesham's MIT-licensed skill](https://github.com/Red-Cloud2000/skills/blob/54fa0180fe17ea5034825a14dbd1201fc129aabf/LICENSE).
It is neither bundled nor installed/modified by harness setup. Keep its copyright
and license with its separate distribution. To reproduce the tested installation:

```sh
git clone --no-checkout https://github.com/Red-Cloud2000/skills.git /path/to/gapcue-upstream
git -C /path/to/gapcue-upstream -c core.autocrlf=false checkout --detach 54fa0180fe17ea5034825a14dbd1201fc129aabf
node /path/to/harness/scripts/requirements-analysis.mjs dependency --project-root /path/to/consumer --gapcue /path/to/gapcue-upstream/GapCue/skills/gapcue
```

`scripts/lib/requirements/gapcue.mjs` records the tested version, immutable commit
and SHA-256 identities of its skill guidance, builder and UI template. They are the
entire code/guidance used by this integration; no dependency runtime is added.
Native host plugin/skill installations can also be supplied if those exact files
match. Do not auto-update this dependency. To evaluate an upgrade, install it
separately, run dependency validation, and retain the existing installation/review
root. Untested versions or changed bytes are rejected without changing prior state.
Rollback selects the original separate directory; native exports and review roots
remain in the consumer. A new compatibility pin requires input, native state,
existing review, browser/export, freshness and rollback proofs before adoption.

Supported proof: Windows, Node 24.15.0, Chromium 153.0.8010.12, native local
server plus native schema-2 Download/Load decisions. A fresh browser context and
new Node process recover edits. The unmodified single-file/browser-only UI can
download the same native export, but cloud-app host discovery and file delivery
have not been exercised. Disk `state.json` lacks identity and is intentionally not
accepted alone; browser-only changes must be downloaded, not guessed from disk.

## Consumer formats and commands

The installed CLI exposes `pom-harness requirements`; direct script calls support
`--project-root <consumer>`. This repository is the package, not a consumer.
Run all examples against a separate consumer workspace.

```json
{
  "version": 1,
  "project": "sample-shop",
  "application": "checkout",
  "storyId": 123,
  "sources": [{"id": "notes", "kind": "file", "path": "requirements.md"}]
}
```

Omit `storyId` for local-only inputs. `sources` can be empty for an ADO story;
otherwise each selected file uses the existing context reader's encoding,
delimiter and optional content-bound extraction fields. Omitted/inaccessible
content stays explicit. The request contains no credentials. ADO configuration
and credential references follow [the existing integration contract](azure-devops.md).
For supplied ADO attachments needing a host reader, optional `attachments` contains
`{attachmentId, extraction}` receipts in the existing context extraction format
(`hash`, `reader`, `coverage`, `parts` with exact `location`/`text`). The fetched
bytes must match the receipt's hash; unsupported or stale receipts remain omitted.

```sh
pom-harness requirements prepare --id checkout --request request.json
pom-harness requirements read --id checkout
pom-harness requirements inventory --id checkout --input decisions.json
pom-harness requirements review --id checkout --gapcue /path/to/gapcue/skills/gapcue --findings findings.json
# Start the printed native --serve command and review in the existing GapCue UI.
pom-harness requirements resume --id checkout --gapcue /path/to/gapcue/skills/gapcue
pom-harness requirements import --id checkout --input downloaded-decisions.json
pom-harness requirements plan --id checkout
pom-harness requirements preview --id checkout
# Only after confirmation of the exact preview:
pom-harness requirements post --id checkout --approval EXACT_PREVIEW_FINGERPRINT
pom-harness requirements reconcile --id checkout
```

Inventory changes use `{version: 1, snapshot, changes: [...]}`. Each change names
the existing `id`, a disposition and an `evidence` array; optional `assumptions`,
`questions`, `constraints`, `dependencies` are string arrays. Source acceptance
evidence is `{kind: "source", partId, revision, quote}` and must reference an
exact criterion excerpt. Owner-decision evidence is `{kind: "decision", path,
fingerprint}` referencing a consumer JSON record with `version: 1`, `authority:
"owner"`, `actor`, `consumer`, `snapshot`, `requirementId`, the entry's `content`
fingerprint, `disposition` and
`statement`. The agent records only decisions actually given by the owner; the
schema is not proof that an owner spoke. Finding dispositions are not evidence.
Unspecified acceptance starts unknown; discussion starts needs-decision. Any changed
snapshot, including discussion alone, clears old acceptance/evidence until explicit
reassessment records support against the current snapshot.

To distinguish independently accepted rules in a compound field or line, the same
inventory command accepts `partitions: [{partId, entries: [{id, start, end}]}]` before
starting review. Offsets are UTF-16 positions in the sanitized source part. Entries
must cover every non-whitespace character once, without overlaps or Unicode splits.
Keep existing IDs when matching the same rule. New slices start unresolved; source
acceptance evidence must quote the whole selected slice, not an arbitrary substring.
After a changed compound source, inspect/repartition its new text before analysis;
previous mappings remain in immutable history. Planning links the same slice IDs,
offsets, revisions and decisions instead of accepting an entire mixed field.

Each finding uses GapCue's native `id`, `kind`, `title`, `why`, `q`, `anchors`, plus
`requirementIds` referencing the existing inventory. Contradictions require two
anchors. Zero findings is valid. The deterministic wrapper creates source HTML
from sanitized text, preserves wording and strips the trace-only field from the
native finding. No HTML or upstream implementation is copied into the package.

State lives at `.harness/state/requirements/<analysis-id>/`: content-addressed
source snapshots and state records, atomic `current.json`, native review folders,
unaltered `imports/`, and durable comment attempts/history. Existing state remains
readable if GapCue is absent. Each consumer/project/application has a distinct
identity; copied reviews cannot silently cross consumers. A surviving lock after
interruption requires checking the stopped owner process before removing that
specific lock. Failed imports never change the current pointer.
The bound original input and generated native story/page are content-checked on
import, resume and handoff readback; altered content cannot reuse an old identity.
Refresh differences include exported edited questions and custom findings as well
as original findings and exact old/new final comments.

Planning output links the actual inventory record, requirements and native review.
Keep those links in a plan rather than copying source text or creating another
acceptance register. Compare consumer/snapshot/content/revision against a fresh
capture before using old references. Plan approval cannot modify the inventory.

## Comment transport and recovery

The only remote write is the confirmed POST supported by Microsoft's
[Add Work Item Comment](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/comments/add-work-item-comment?view=azure-devops-rest-7.1)
contract. The native final HTML is previewed and posted unchanged with `format=html`.
The preview fingerprint binds destination, source, inventory, review, export and
ordered body. Source/discussion freshness and originating-project ownership are
checked before dispatch; ADO has no atomic conditional-comment write, so a remote
edit between the last read and POST remains a documented race. A later source
change requires another preview. No credential or remote attachment bytes are
included in receipts.

Durable transport acknowledgements identify a confirmed comment even after a local
interruption. With a lost response, reconciliation lists exact-text candidates
absent from the pre-dispatch discussion. A candidate is not automatically attributed
to this request. Explicit owner identification via `reconcile --comment-id` can
complete the readback; otherwise the attempt stays uncertain and blocks replay,
including a changed payload. No candidate/permission does not authorize retry.
Local read-only review and declined publication do not create remote writes.

## Validation evidence

The native proof is reproducible with `GAPCUE_SKILL` pointing at the separate
installation and `npm run probe:requirements`. It uses the actual unmodified
builder/UI, native Download/Load decisions, disk readback, a fresh browser context
and a fresh Node process. It also exercises file-only browser decisions, proves
that those edits did not change disk state, imports their downloaded artifact,
rejects an unavailable upgrade and resumes the existing review after rollback.
Changed source builds a distinct review; the prior manually edited export survives.
The native run passed on the Windows/Node/Chromium versions recorded above.

The seven synthetic stories in
[the quality corpus](../harness-tests/fixtures/requirements-quality.json) record
one author analysis pass following the pinned guidance and harness acceptance
boundaries. Its outputs are 0/1/1/1/1/0/1 findings for complete, incomplete,
contradictory, vague nonfunctional, boundary, unanswered discussion and revised
stories respectively. The revised fixture reuses an ID with changed meaning.
The author records five useful questions, zero invented executable expectations
and all unresolved source concerns. These are small synthetic author judgments,
not benchmark scores or evidence of superiority over another analyzer. Independent
review must assess usefulness, inventions, unresolved concerns and coverage
separately from the executable inventory/schema/transport checks.

`npm run test:requirements` covers source/inventory completeness, accepted and
unresolved planning references, identity-bound import and retained original bytes,
bad/incomplete handoffs, semantic changes with reused IDs, manual-text preservation,
wrong project/consumer, missing/incompatible dependencies, attachment sanitization,
paginated discussion, exact confirmation/freshness, concurrent dispatch, durable
acknowledgement and duplicate-safe uncertain-outcome recovery. These are synthetic
authenticated-adapter fixtures; no live ADO comment is posted by this validation.

Independent framework review concluded **APPROVE** after regression-backed fixes
for snapshot-wide acceptance freshness, independently accepted compound slices,
owner evidence bound to slice content, native Markdown operators and malformed
decision maps. Reassessment now includes saved custom findings and edited questions.
The revised boundary fixture received an independent usefulness check; final corpus
judgment was five useful questions and zero invented executable expectations.

Final focused results: **33 requirement tests passed**, plus the native GapCue
round trip. The broad package checklist passed syntax, JSON, links, privacy,
provenance, contracts, example/generation/workflow conventions, strict types and
fetch checks. Secret-scanner literal triggers were corrected without scanner
exceptions. Initial Windows tests exposed the documented long/short temporary-path
junction limitation and local overlay redirects; the isolated clean-source rerun
passed all **87 adoption, root and native-generation tests** with a verified short
external TEMP/TMP. The clean-source publication gate passed (483 packed files);
the development checkout's separately installed ChaosEngine files were excluded
from that snapshot, not deleted or added to the harness package.
