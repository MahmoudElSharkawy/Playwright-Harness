---
name: plan-tracker
description: "Use to record automation progress for the selected Azure, Jira plugin or local source, or regenerate the plan-tracker HTML report — update the tracker, record cases as done/blocked, sync with the pipeline, or after a wave, bug filing or ruling changes status or scope. The report is rendered on demand from consumer-owned structural registry and append-only dated history."
---

# Plan Tracker (Progress Report Generator)

Use the shared [tracker provider contract](../../../docs/tracker-providers.md) for
Azure, Jira with Xray or Zephyr Scale, and Jira without a plugin. Keep the same
workflow and gates; select native adapters and preserve the captured source identity.

Resolve this skill to its real path before following references. Read the
[package and consumer boundaries](../ROOTS.md); mutable state belongs to the consumer.

One self-contained HTML dashboard — donuts, per-suite trees, filters, bug/manual
panels — for the automation status of your selected source. The page is a disposable
*render*; the truth lives in two consumer-owned data files and is
folded by `scripts/generate-tracker.mjs`. Never hand-edit the generated HTML.

| File | Holds | Changes when |
|---|---|---|
| `.harness/state/tracker/plan-<planId>.json` — create yours from [the registry template](assets/registry-template.json); the script discovers it (or `--plan <id>` when several exist) | Structure: branches (`inScope` flag), suites, cases with consolidation verdict (`k`/`d`/`f`/`t`) + review note, `manual` map (id → non-automatable ruling), `bugs` registry, owner `names` | Scope changes: new suites fetched, verdict/ruling changes, a bug filed, a note updated |
| `.harness/state/tracker/history.jsonl` | Progress: append-only dated status events; later lines win — starts empty | Every automation wave, re-test, or team ruling that flips a case's status |
| [assets/tracker-template.html](assets/tracker-template.html) | The page shell with a `/*__TRACKER_DATA__*/` injection point | Only for UI changes — it carries no data |

Output: `reports/tracker/plan-<planId>-tracker.html` (gitignored, regenerate at will).
Create an empty adjacent `history.jsonl` when starting a new registry.

Keep the Azure template for existing numeric registries. For native Jira keys, start
with the [source-bound example](assets/registry-jira-example.json), preserving the
exact `source` site, project and plugin. Local registries bind
`"source": {"provider": "local", "id": "<source-id>"}`. `planId`, suite and case
IDs may then be opaque strings. Copy `sourceIdentity` from `tracker --json` into
each hand-recorded history event for that source; unbound/foreign events do not apply.

Run package scripts from the consumer working directory, or pass `--project-root <consumer>`.
The renderer reads the HTML template from the installed package and writes only consumer state/output.

## Commands

```
npx --no pom-harness tracker                       # fold history → render the report
npx --no pom-harness tracker --sync --dry-run      # preview a pipeline sync (ALWAYS first)
npx --no pom-harness tracker --sync                # append live _verify-state.json diffs as one event, then render
npx --no pom-harness tracker --archive             # also keep a timestamped copy under reports/tracker/archive/
npx --no pom-harness tracker --json                # machine-readable summary (for loops/agents)
```

`--sync` maps source-bound Azure/Jira pipeline state (`_verify-state.json` alongside
its matching native manifest), or local generation receipts, to tracker status:
`passed`/generation `READY`→done · `fixme`/`blocked`→blocked ·
`failed` at the 3-round cap→blocked, else doing · `pending-confirmation`→doing. A case
whose folders disagree is skipped with a warning. It never touches cases under
a `manual` ruling, and never overrides a history event newer than the verify-state
file (team rulings outrank stale pipeline state — skips are warned). Run `--dry-run`
first and read the would-be event before appending.

## Recording an event by hand

Append one line to `.harness/state/tracker/history.jsonl` (append-only — to correct a mistake, append
a newer event; never rewrite or delete lines):

```json
{"at":"2026-09-02","source":"wave 3","note":"Suites <idA>/<idB> automated: done = green ×2; blocked = fixme on app defect (evidence in _traceability.md).","set":{"done":[123456],"blocked":[123457]}}
```

- `at` ISO date · `source` short origin label · `note` the why, with evidence pointers.
- `set` statuses are exactly `todo` / `doing` / `done` / `blocked`; omit empty ones.
- Optional `assign`: `{"<name from registry names>": [caseIds]}`.
- Status semantics match the pipeline's: **done = spec green ×2** (the
  rerun-reusability gate); **blocked** = fixme-on-app-defect / NEEDS-FIXTURE /
  NEEDS-COLLECTION / environment; a filed bug is NOT a status — add it to the
  registry's `bugs` map (the page then shows "Bug filed" regardless of status);
  a non-automatable ruling goes in the registry's `manual` map with the reason.

After any data edit: regenerate and read the printed summary — the script fails
loudly on malformed lines, unknown statuses, and warns on case ids missing from the
registry (fix the registry, don't silence the warning).

## The page's interactivity vs the repo truth

Status pills clicked in the browser persist only in that browser's localStorage and
are reset to the embedded baseline by the next regeneration; locally-chosen
assignees are kept unless a history `assign` event sets one. Browser clicks are
scratch for triage sessions. To keep a teammate's progress: have them use the
page's **Sync / Names → Export**, then translate the changed cases into a history
event (one event, note = "imported <name>'s export of <date>").

## Boundaries

- Cycle objectives, risk priorities, strategy, estimates and criteria belong to
  [test-planning](../test-planning/SKILL.md). This tracker records actual progress;
  accepting a plan creates no status event or automation completion.

- Reassessing blocked or failed cases uses [maintain-test](../maintain-test/SKILL.md).
  Verified unblocking permits resumed work (`doing`), never `done` by itself.
  Neutral generation can sync current receipts when the registry binds its exact
  local source ID; native sync also checks source fingerprints. Preserve unresolved
  blockers, exhausted repair budgets and manual rulings.

- Suite-level pipeline state and NEEDS-HUMAN queue → `scripts/harness-metrics.mjs`
  (reads the same `_verify-state.json`; this skill renders the plan-scope view).
- Filing the bug itself is out of scope; this skill only registers the filed
  bug's id/severity/blocked-cases in the registry.
- Tracker data edits ride the normal branch & PR law like every other change.
