# Consumer page map

One reviewed file per application page at `<projectRoot>/.harness/knowledge/ui/<page-slug>.md`
(e.g. `login.md`, `checkout.md`), named by a stable page slug and created from the
immutable [template](../assets/page-map-template.md). Record reviewed facts in that
consumer folder, never here. The page map is the compounding asset of this pipeline:
every suite run makes the next one cheaper.

- **Who writes**: the orchestrator only, by promoting reviewed observations. EXPLORE end
  and every VERIFY locator repair place them in `.harness/knowledge-candidates/ui/`;
  review and sanitize before promoting ([playbook](playbook.md) §3 and §5). qa-executor
  subagents never write here.
- **Who reads**: REFINE (step concretization), GENERATE (selector + rendered-string
  authority, after the run's own codegen-notes), and any session doing manual POM work.
- **Merge rule**: update in place — newer verified facts replace older ones, but a
  replaced selector is never deleted silently: it moves to the drift ledger with a
  cause. Facts must come from an executed run or a verified read, never from memory.
  Nothing durable to add is a valid outcome — never pad a page file.
- **Git concurrency**: page-map edits go in their own commit on the pipeline branch.
  On a merge conflict, union both branches' rows; per element keep the selector with
  the newest Verified date and move the loser to the drift ledger. Drift-ledger rows
  are append-only — never drop a row from either side. Facts on an unmerged branch are
  invisible to sibling pipelines — merge PRs promptly.
- **Escalation**: an element with **three or more drift-ledger entries** is flagged
  in the next framework review — its selector strategy is wrong, not unlucky.
- **No secrets, ever**: user handles (`users.customer`) and `defaults.*` key names are
  fine; values are not.

Template sections: Identity (URL patterns), Elements (business name → best selector, in
the element-locators strategy order), Login & session (landmarks), Rendered strings (per
locale, exact), Network (endpoints the page calls — candidates for `integration/` and
`Apis<Domain>`), Gotchas (iframes, timing, RTL, dialogs), Drift ledger
(`old → new + cause + date`). Keep the `## Drift ledger` heading: `harness-metrics`
counts locator drift from it.
