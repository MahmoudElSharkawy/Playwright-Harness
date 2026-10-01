---
name: plan-tracker
description: "Use to record automation progress for the ADO test plan or to (re)generate the plan-tracker HTML report — \"update the tracker\", \"regenerate the plan tracker\", \"record these cases as done/blocked\", \"sync the tracker with the pipeline\", \"where are we on the plan\", or after any automation wave / bug filing / team ruling that changes case status or scope. The report is rendered on demand by scripts/generate-tracker.mjs from consumer-owned data: a structural plan registry plus an append-only dated history ledger."
---

# Plan Tracker (Progress Report Generator)

Resolve this skill to its real path before following references. Read the
[package and consumer boundaries](../ROOTS.md); mutable state belongs to the consumer.

One self-contained HTML dashboard — donuts, per-suite trees, filters, bug/manual
panels — for the automation status of your ADO test plan. The page is a disposable
*render*; the truth lives in two consumer-owned data files and is
folded by `scripts/generate-tracker.mjs`. Never hand-edit the generated HTML.

| File | Holds | Changes when |
|---|---|---|
| `.harness/state/tracker/plan-<planId>.json` — create yours from [the registry template](assets/registry-template.json); the script discovers it (or `--plan <id>` when several exist) | Structure: branches (`inScope` flag), suites, cases with consolidation verdict (`k`/`d`/`f`/`t`) + review note, `manual` map (id → non-automatable ruling), `bugs` registry, owner `names` | Scope changes: new suites fetched, verdict/ruling changes, a bug filed, a note updated |
| `.harness/state/tracker/history.jsonl` | Progress: append-only dated status events; later lines win — starts empty | Every automation wave, re-test, or team ruling that flips a case's status |
| [assets/tracker-template.html](assets/tracker-template.html) | The page shell with a `/*__TRACKER_DATA__*/` injection point | Only for UI changes — it carries no data |

Output: `reports/tracker/plan-<planId>-tracker.html` (gitignored, regenerate at will).

Run package scripts from the consumer working directory, or pass `--project-root <consumer>`.
The renderer reads the HTML template from the installed package and writes only consumer state/output.

## Commands

```
npm run tracker                                    # fold history → render the report (once wired; or node <packageRoot>/scripts/generate-tracker.mjs)
node <packageRoot>/scripts/generate-tracker.mjs --sync --dry-run # preview a pipeline sync (ALWAYS first)
node <packageRoot>/scripts/generate-tracker.mjs --sync           # append live _verify-state.json diffs as one event, then render
node <packageRoot>/scripts/generate-tracker.mjs --archive        # also keep a timestamped copy under reports/tracker/archive/
node <packageRoot>/scripts/generate-tracker.mjs --json           # machine-readable summary (for loops/agents)
```

`--sync` maps pipeline state (`_verify-state.json` in `test/ado-suite-*/` and
`test/ado-story-*/`) to tracker status: `passed`→done · `fixme`/`blocked`→blocked ·
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
  NEEDS-COLLECTION / environment; a filed ADO bug is NOT a status — add it to the
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

- Suite-level pipeline state and NEEDS-HUMAN queue → `scripts/harness-metrics.mjs`
  (reads the same `_verify-state.json`; this skill renders the plan-scope view).
- Filing the ADO bug itself is out of scope; this skill only registers the filed
  bug's id/severity/blocked-cases in the registry.
- Tracker data edits ride the normal branch & PR law like every other change.
