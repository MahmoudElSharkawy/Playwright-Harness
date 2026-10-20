---
name: requirements-analysis
description: Analyze supplied requirements or an ADO story with separately installed GapCue, preserve acceptance traceability and resumable review, and optionally post the user's confirmed story comment.
---

# Requirements analysis

Resolve this linked skill to its real path. Follow [ROOTS.md](../ROOTS.md) and
the [workflow and formats](../../../docs/requirements-analysis.md). The consumer
owns all mutable sources, inventory, reviews, decisions and delivery receipts.

## Capture and inventory

Resolve known project/application, story, supplied paths, configured adapters and
prior analysis ID from the conversation and project. Bundle only genuinely missing
choices. Never ask the user to repaste accessible sources. Create a consumer JSON
request and run `pom-harness requirements prepare --id <id> --request <file>`.
Local mode never resolves ADO credentials. ADO mode automatically reads title,
description, acceptance criteria, paginated discussion and supplied attachments
through the existing authenticated transport and context readers. Inspect omissions;
use supported host readers for unsupported attachments, with content-bound extraction
receipts. Sanitize sensitive material before review; do not recover redacted secrets.

Read the prepared source and single inventory. Each located statement is recorded
once. Keep source statements in the source, acceptance/trace mappings in the
inventory, findings/review decisions in GapCue. Before analysis, split compound
statements into independent, exact source slices using `inventory` partitions;
cover every statement once and retain stable IDs when matching existing rules.
Each slice has its own disposition and full-span acceptance evidence. Keep constraints,
dependencies, assumptions and unanswered discussion concerns on their entries.
Do not repeat unanswered discussion in outgoing questions automatically.

Use `requirements inventory` to record accepted source criteria or explicit owner
decisions with exact evidence. Otherwise retain `proposed`, `unknown` or
`needs-decision`. Missing preconditions/data, measurable performance targets,
unspecified inclusive boundaries and conflicting rules remain unresolved. Finding
approval, dismissal, out-of-scope or accepted plan logistics never accept a business
rule, test assertion or invented default. Preserve source/test expectations.

## One GapCue pass and its existing UI

Resolve the separately installed skill with `requirements dependency --gapcue
<directory>`. Missing/incompatible content stops analysis/UI invocation while keeping
prepared sources and previous reviews. Follow the exact pinned GapCue SKILL.md for
one host-AI analysis pass and its existing review UI; there is no analyzer API.
Use the known consumer review root below rather than asking again where to save.
Do not copy, patch, fork or replace upstream files or add another analyzer/UI.

The harness acceptance contract controls the scope: upstream suggested finding
counts are not quotas, zero findings is valid, allowed spaces/special characters
stay allowed, and upstream filtering/default assumptions are not accepted business
rules. Keep filtered but unanswered discussion concerns in the inventory. Report
only evidenced gaps and contradictions, and distinguish questions from expectations.

Write that pass's native findings array, adding `requirementIds` to link each finding
to the existing inventory. Run `requirements review --id <id> --gapcue <directory>
--findings <file>` once per source snapshot. It builds the native review and prints
the native serve script/arguments. Start that server and give its actual URL and
consumer folder to the user. The UI supports edited questions, custom findings and
a manually edited rich comment. Do not publish from an Approved click.

## Resume and source changes

Reuse `requirements read --id <id>` and the existing native UI.
`requirements resume --id <id> --gapcue <directory>` reopens the same bound review
without analysis; an interrupted build uses the saved input and a fresh native
root while preserving partial files. Load any retained native export in that UI.
Require GapCue's **Download decisions**, then `requirements import --id <id> --input <file>` for a
complete identity-bound handoff. Retain the original export. Browser-only edits,
an initial disk state, lost/partial exports or an unsaved review remain incomplete.
Never synthesize an export to pretend the user's review was saved.

Refresh with the original request before reusing current acceptance or publishing.
Every changed snapshot invalidates accepted evidence until reassessed against the
current source and discussion, even if a criterion's own words did not change.
Changed sources invalidate affected links and start a separate review. Inspect
prior source excerpts, finding meaning and saved custom findings/questions/comment;
matching IDs or version numbers do not prove equivalence. Prior exports/history
remain available. Reassess through the one new source pass, then have the user
reconsider decisions in the current native UI; do not automatically carry approvals.
Preserve manual final text as the starting point. Show old/new text and affected
source/finding differences before confirming any replacement final comment.

Planning uses `requirements plan --id <id>` read-only. Link its existing inventory
path, stable IDs, revisions, evidence and review; no copied acceptance authority,
automatic rule resolution, second GapCue invocation or remote write.

## Optional discussion delivery

Only when requested, run `requirements preview --id <id>`. Show the exact returned
HTML/text, destination/story URL, reviewed snapshot/discussion, differences from
the prior manual comment and the ordered single POST. Bundle any remaining choices
before this preview. Obtain one final confirmation of this unchanged payload, then
pass that preview's fingerprint to `requirements post --id <id> --approval <hash>`.
Existing authorization applies only if it covers that exact preview. A changed
payload/source/discussion needs a new preview and confirmation.

The deterministic adapter rechecks freshness, durably records dispatch and verifies
the comment ID/URL. On uncertain results use `requirements reconcile`; never retry
blindly. An identical new comment is only a reconciliation candidate. Ask the owner
to identify it before `reconcile --comment-id <id>` if no durable acknowledgement
identifies the write. Missing access/destination, declined publication and local
requirements remain saved locally. No story-field, case, result or other writes.
