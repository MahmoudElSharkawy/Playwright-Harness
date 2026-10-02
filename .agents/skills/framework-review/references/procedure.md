# Framework Review — procedure

## Neutral generation review (M13)

For M13 output, review the frozen handoff, candidate file hashes and source-to-assertion bindings described in [M13](../../../../docs/M13-GENERATION.md). The legacy ADO traceability table below applies to legacy ADO artifacts. Neutral local cases carry `allure.testCaseId`; external cases retain their real `allure.tms` links. Require the actual assertions to preserve source intent, and review operation definitions and lifecycle dispositions. A reviewer identity field alone is not evidence of independent review. User-authorized branch and delivery choices take precedence over template defaults.

Inputs: a diff scope (default: `git diff master...HEAD` plus unstaged changes,
**plus untracked files from `git status --porcelain`** — at the pipeline's GENERATE
gate the generated code is still untracked and a bare diff sees nothing; or the file
list the caller names). Output: the verdict block in §4.

## 1. Mechanical pass (always first — cheap facts before judgment)

```
npx --no pom-harness check-conventions --changed
```

Every new FAIL/WARN it prints becomes a pre-confirmed finding (evidence is the
`file:line` it names). Do not re-litigate what the linter already proved; do not
proceed to §2 while the linter itself errors (exit 2).

## 2. Classify the diff by layer

Map each changed file through the pom-architecture layer map: `tests/` → test-classes
+ test-methods; `pages/` → page-classes + element-locators + action-methods +
validation-methods; `apis/`/`dbs/` → service-classes; `utils/` + lifecycle scripts →
utility-classes; `resources/testData/` → test-data; config/reporting paths →
pom-architecture's report-output contract. Files outside the layer map (scripts/,
.claude/, docs) get a consistency read only.

## 3. Walk the checklist — each box with its owner

For each box of design-conventions §6 that the diff's layers make applicable, read
the diff against the box; on doubt, open the owning playbook section (the box ↔ owner
mapping is in the §6 text itself) and judge by ITS checklist, not memory. Record per
box: PASS / FAIL / N-A, with `file:line` evidence for every FAIL.

Also check, from the harness's own rules (not in §6):
- Generated tests carry the right `allure.tms` ids (diff vs `_suite.json` when
  reviewing pipeline output).
- **Traceability table** (pipeline output, 2026-08-27 ruling): the diff carries
  `test/ado-suite-<id>/_traceability.md`; it covers every tms id the spec carries,
  every method it names exists on the named class (grep), every API/DB row carries
  a `Why this layer` code from the closed vocabulary (`per-ADO`/`seed`/`oracle`/
  `cross-check`/`reroute`), and every `reroute` names the observable it replaced.
  A missing, stale, method-inventing, or reason-less table is a finding
  (class: `traceability-table-stale`).
- No secrets in code, step titles, or test data (values, not handle names).
- Page-map edits honor its contract (orchestrator-written, drift ledger append-only),
  and any element with **three or more drift-ledger entries** becomes a finding —
  its selector strategy is wrong, not unlucky.
- The change is on a feature branch, not master (`git branch --show-current`).
- **Every NEW public action/validation method** in the diff: search `pages/`, `apis/`,
  `dbs/` for an existing equivalent intent (case/suffix-tolerant, legacy `assert*`
  names included, parameterized actions count as coverage). A duplicate of an existing
  intent is a blocking finding (class: `duplicate-action-method`).
- **Record-creating test data**: mutable inputs live in per-case `tc<id>` clusters
  (ids matching the tests' `allure.tms`), suffix-tolerant bases carry the TC id,
  and no two tests consume the same mutable key (class: `shared-case-data`) — the
  data rows of ONE parameterized case sharing its cluster and tms id are the
  sanctioned exception, not a finding.
- **New SQL** in the diff: when `resources/Queries/` already holds a matching team
  query, the field must derive from it (`@param`-parameterized, single statement,
  sample literals stripped) — from-scratch SQL the library covers is a finding
  (class: `query-library-bypassed`); raw sample literals surfacing in test data or
  code is a finding (class: `query-sample-literal-leaked`). Exported library files
  themselves are never edited in a diff (README/index maintenance excepted).
- **New API endpoints** in the diff: when `resources/apisCollections/` already holds
  a matching request, the `<op>_serviceName` field / `integration/*_api.json` entry
  must derive from it (path as the field, base URL via config/env keys, payload as
  typed parameters) — from-scratch endpoint definitions the collection covers are a
  finding (class: `collection-library-bypassed`); collection sample literals
  surfacing in test data or code are a finding
  (class: `collection-sample-literal-leaked`). Curated collection files change only
  through the import ritual (README/index and sanitization-ledger maintenance
  excepted). Additionally: `integration/*_db.json` connection coordinates
  contradicting `src/config/databases.ts` are a finding
  (class: `db-config-forked`).

## 4. The verdict block (fixed format)

```
FRAMEWORK REVIEW — <scope> — <date>
Reviewer: <independent subagent | self (smoke test only)>
Mechanical pass: <n> FAIL / <n> WARN (new)
Boxes: <n> PASS · <n> FAIL · <n> N/A

F1. Verdict: confirmed | Blocking: yes|no
    Where: <file:line>
    Rule: <skill + section, e.g. element-locators §8>
    Scenario: <what goes wrong if shipped>
    Class: <kebab-slug, e.g. strict-mode-papered, secret-in-title>
    Fix: <route to the owning skill + one-line direction>

OPEN-DECISION notes: <touched open decisions, if any>
Questions (unproven): <suspicions needing the author's answer>

VERDICT: APPROVE | CHANGES-REQUIRED (any blocking finding ⇒ CHANGES-REQUIRED)
```

## 5. After the verdict

- Append each finding's `class` to the consumer’s `.harness/state/review/class-ledger.md` (use the [template](../assets/class-ledger-template.md)) (date,
  class, file). **Three entries for one class** ⇒ add a proposal line to the ledger:
  either a concrete new rule for `scripts/check-conventions.mjs` or "cannot mechanise
  because <reason>". Implementing the rule is a normal reviewed change.
- When the review gates the automate-suite pipeline: CHANGES-REQUIRED loops back to
  GENERATE (fix via the owning skills, re-review); APPROVE releases VERIFY/commit.
- Never fix and approve in the same breath as the reviewer — findings go back to the
  author (or the session acting as author), the fix lands, the re-review is scoped to
  the diff since the last verdict.
