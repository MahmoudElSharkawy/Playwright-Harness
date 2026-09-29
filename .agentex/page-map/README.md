# Page map — the harness's durable, git-tracked memory of the application

One file per application page (e.g. `login.md`, `checkout.md`, `order-summary.md`),
named by a stable page slug. This folder is the **compounding asset** of the
`automate-suite` pipeline: every suite run makes the next one cheaper.

## Contract

- **Who writes**: the pipeline orchestrator only — at EXPLORE end (merging that run's
  `codegen-notes/`), and during VERIFY whenever a locator is repaired (drift ledger).
  qa-executor subagents never write here.
- **Who reads**: REFINE (step concretization), GENERATE (selector + rendered-string
  authority, after the run's own codegen-notes), and any session doing manual POM work.
- **Merge rule**: update in place — newer verified facts replace older ones, but a
  replaced selector is never deleted silently: it moves to the drift ledger with a
  cause. Facts must come from an executed run or a verified read, never from memory.
  Nothing durable to add is a valid outcome — never pad a page file.
- **Git concurrency**: page-map (and class-ledger) edits go in their own commit on
  the pipeline branch. On a merge conflict, union both branches' rows; per element
  keep the selector with the newest Verified date and move the loser to the drift
  ledger. Drift-ledger rows are append-only — never drop a row from either side.
  Facts on an unmerged branch are invisible to sibling pipelines — merge PRs promptly.
- **Escalation**: an element with **three or more drift-ledger entries** is flagged
  in the next framework review — its selector strategy is wrong, not unlucky.
- **No secrets, ever**: user handles (`users.customer`) and `defaults.*` key names are
  fine; values are not.

## File template

See [_template.md](_template.md). Sections: Identity (URL patterns), Elements
(business name → best selector, in the element-locators strategy order), Login &
session (landmarks), Rendered strings (per locale, exact), Network (endpoints the
page calls — candidates for `integration/` and `Apis<Domain>`), Gotchas (iframes,
timing, RTL, dialogs), Drift ledger (`old → new + cause + date`).
