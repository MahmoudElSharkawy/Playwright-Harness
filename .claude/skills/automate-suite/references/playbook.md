# Automate-Suite Playbook

The phases in execution order. Each phase states its **inputs**, **exact
commands**, **outputs**, and **failure handling**. State lives on disk (§8), so any
phase can be re-entered idempotently.

---

## 0. Preflight, triage & branch (run once per pipeline, minutes)

### 0a. Checks

| Check | Command | On failure |
|---|---|---|
| Fetch script healthy | `node scripts/fetch-ado-suite.mjs --self-test` | Fix the script before anything else |
| Azure config | `azure.org` + `azure.project` in `config/project.json` | Ask the user / run `/init-test` wizard |
| PAT | script exits 1 with a clear message if `AZURE_PAT` / `AZURE_DEVOPS_EXT_PAT` missing in `.env` | Ask the user to fill `.env` (never ask them to paste the PAT in chat) |
| playwright-cli (EXPLORE only) | `npx playwright-cli --version` | `npm install -D @playwright/cli && npx playwright-cli install-browser chromium` — use the registry approved for the consumer project |
| Playwright deps (VERIFY only) | `node_modules/@playwright/test` exists | `npm install` (same registry note) |
| Conventions linter clean | `node scripts/check-conventions.mjs` | New FAILs on an untouched tree mean someone bypassed the hooks — surface to the user |

The PAT needs **Work Items: Read & Write**, **Test Management: Read & Write** (both
verified in this project), and **Code: Read & Write** for PR creation.
(For EXPLORE, the browser-testing skill ships its own `preflight.js` that probes the
whole toolchain in one call — prefer it over individual checks when that phase runs.)

### 0b. Triage — depth from blast radius × reversibility

Triage inputs are the suite's case titles and steps — with only a suite id in hand,
run 0a and 0c now and **finalize triage right after FETCH prints its case table,
always before dispatching EXPLORE**. Take caution from the worse answer; re-triage
when a case turns out riskier than its suite name suggested.

| The suite's cases… | EXPLORE mode | Extra guard |
|---|---|---|
| Read-only (navigation, content, search, dashboards) | `parallel` autonomous is fine | none |
| Create records (quotes, registrations, uploads) | sequential by default | seed/cleanup plan reviewed before dispatch |
| Hard-to-reverse (payment, policy issuance, cancellation, anything sending real notifications) | sequential, human-in-the-loop ONLY | write-steps flagged in REFINE; never dispatched autonomously; disposable data only |

### 0c. Branch — before anything touches a file

All pipeline work rides a purposefully-named feature branch; **nothing is ever
committed to or pushed to master directly** (repo rule, hook-enforced). In order
(Bash tool — the `&&` chains are not PowerShell 5.1 syntax):

1. **Dirty tree is a STOP.** `git status --porcelain` must be empty; anything else
   is reported to the user (whose work is it? commit/stash is their call) — never
   silently stashed, never carried onto the automation branch.
2. **Resume before create.** `git branch --list "automation/ado-suite-<suiteId>-*"`
   — if a branch exists, `git checkout <it>` and skip step 3 (never restart from
   master while an automation branch for the suite has unmerged work).
3. **Create fresh**: `git checkout master && git pull && git checkout -b
   automation/ado-suite-<suiteId>-<feature-slug>`. If the pull fails (diverged
   local master, proxy), report it and ask whether to proceed from local master —
   don't guess.

---

## 1. FETCH — pull the suite from Azure DevOps

```
node scripts/fetch-ado-suite.mjs --plan <planId> --suite <suiteId>
node scripts/fetch-ado-suite.mjs --suite <suiteId>            # azure.testPlanId set in config
node scripts/fetch-ado-suite.mjs ... --env <env>              # when the user said "on <env>"
node scripts/fetch-ado-suite.mjs --list-plans                 # discovery
node scripts/fetch-ado-suite.mjs --list-suites <planId>       # discovery
```

The script (zero-dependency Node, REST + PAT — it does not need the az CLI) resolves
org/project from `config/project.json`'s `azure` block, fetches every test case in the
suite (steps XML parsed, shared steps inlined, parameter data tables extracted), and
writes:

- `test/ado-suite-<suiteId>/tc-<id>-<slug>.md` — one AgenTeX spec per test case, in
  the exact markdown grammar the browser-testing skill expects (Target from the
  default environment's `portalUrl`, expected results as acceptance criteria,
  steps as a stateful scenario chain).
- `test/ado-suite-<suiteId>/_suite.json` — the manifest: case ids/titles/tags, the
  raw parsed steps per case (the ADO source of truth for phase 4, independent of any
  spec refinement), spec-file map, and `suggestedFeature` / `suggestedSpecFile` /
  `suggestedDataFile` for phase 4.

Then **show the user a table** of fetched cases (id, title, steps, state) before
continuing. Refetching overwrites raw fetched `.md` files but **preserves any spec
carrying a `## Refinement log`** (use `--force` to overwrite those too). Hand edits
outside the REFINE phase belong in ADO, not in these files.

Failure handling: exit 1 = config/PAT missing (fix `.env` / config); exit 2 = PAT
rejected (regenerate with the scopes above); exit 3 = wrong plan/suite id OR the
suite exists but holds zero test cases — in both cases STOP the pipeline and report
(offer `--list-plans` / `--list-suites`), never proceed with an empty manifest;
exit 4 = network/API (corporate proxy or org URL — try
`--org-url https://dev.azure.com/your-org` style URLs).

---

## 2. REFINE — make the fetched specs executable (scope-preserving)

ADO manual steps are written for humans. Before running anything, review EVERY
fetched spec and restructure only as much as smooth agent execution needs. This
phase changes **how steps are expressed — never what the test case covers or
proves**.

Allowed (log each change):

- Add the plumbing steps a human does implicitly: open the portal, login as a
  handle from `environments/<env>.json` `users`, dismiss cookie banners/popups.
- Resolve every precondition expressed as prose (e.g. "user has an active paid
  policy", "a pending cancellation request exists" — any state a case assumes
  before its own steps) against
  [prerequisite-dictionary.md](prerequisite-dictionary.md) — the costed map of the
  plan's recurring state chains. Expand it into explicit seed steps: `api:`/`db:`
  where the dictionary records a sanctioned route (catalog entries only — a
  route the catalog lacks becomes a PROPOSED entry, same flow as the query library
  below); where the dictionary says GUI-only, prepend the chain's steps or point to
  the tc that builds the state, and copy its consumability warning
  (consumed-per-run / poisons-shared-state) into the spec's Notes. A prose state
  the dictionary doesn't know is **NEEDS-FIXTURE**: report it with the NEEDS-DATA
  list and, once the route is resolved, add the entry — the dictionary is a living
  document, updated in the same PR as the refinement that discovered the gap.
- Split compound steps, reorder mis-ordered ones, make vague actions concrete
  ("enter valid data" → the exact fields and where each value comes from).
- Bind every data need to a real source: `users.<handle>`, `defaults.password` /
  `otp` / `captcha` / `Iqama`, or a disposable value (`qa.tester@example.com`
  pattern) for data the case invents. Reference handles symbolically — never paste
  secret values into a spec.
- Convert verification intents that have a cataloged path into `api:` / `db:` steps
  (entries in `integration/*_api.json` / `*_db.json` only — an uncataloged need is
  noted as a gap, not improvised). Consult `resources/Queries/` (the team's DB-query
  knowledge library) to recognize which verification/seed intents the team already
  has SQL for: a library query a case needs but the catalog lacks becomes a PROPOSED
  catalog entry — adapted per `resources/Queries/README.md` (single statement,
  parameterized, sample literals stripped, connection coordinates mirroring
  `src/config/databases.ts` — the named catalog — credentials only via the
  `DB_USER`/`DB_PASSWORD` env keys), added to `integration/*_db.json` and confirmed
  with the user before EXPLORE. Never SQL invented from scratch when the library
  already knows the tables. Symmetrically, consult `resources/apisCollections/`
  (the team's API-collection knowledge library) for api intents: a collection
  request a case needs but the catalog lacks becomes a PROPOSED catalog entry —
  adapted per `resources/apisCollections/README.md` (auth and base URLs via env
  keys, sample literals stripped), added to `integration/*_api.json` and confirmed
  with the user before EXPLORE. Never HTTP invented from scratch when the
  collection already knows the endpoint.
- Tag each expected result's proof layer as you resolve it (the 2026-09-01
  validation-layer ruling): does this need the GUI to prove it, or does an API/DB
  check prove it better? Cataloged `api:`/`db:` steps and the service layers are
  the destinations for the latter; the tag guides GENERATE's `verify*` placement
  and lands in the Refinement log like every other change.
- Mark the stateful chain and make per-step expected results explicit.

Forbidden:

- Dropping, weakening, or rewording-away ANY expected result that came from ADO —
  every validation point must survive, traceably.
- Adding validations beyond the case's scope (the standard "no console errors" AC
  is boilerplate, not scope creep), changing the covered flow, or inventing expected
  results ADO doesn't claim.
- Inventing data that must be real (accounts, credentials, national ids): when
  `environments/<env>.json` can't supply it, list the case under **NEEDS-DATA** in
  your message to the user and mark its spec `Notes: blocked — needs data` — never
  guess.

Close each spec with a `## Refinement log` section listing the changes ("- step 2
split into 2–3; added login as users.customer; bound OTP to defaults.otp") or
`- no changes needed` when the fetch is already clean. That section doubles as the
refetch-preservation marker (the script skips refined files unless `--force`). If
ADO steps changed upstream, refetch that suite with `--force` and redo this phase
using the old refinement log as a guide. When refinement reveals the ADO case itself
is broken (impossible order, missing AC), tell the user — the source of truth is
fixed in ADO, not silently patched here.

Two refinement assists:
- Consult the **page map** (`.agentex/page-map/`) first — element names, login
  landmarks, and gotchas already proven for these pages make concretization exact
  instead of guessed.
- A case too ambiguous to refine on paper routes to a live walkthrough:
  `/define-flow test/ado-suite-<suiteId>/tc-<id>-*.md` — the user answers each
  ambiguity while the step executes, and the proven spec it saves becomes the
  refined spec (record the walkthrough in the Refinement log).

---

## 3. EXPLORE — execute the manual cases with AgenTeX

Invoke the AgenTeX browser-testing skill exactly as a user would:

```
/execute-test ado-suite-<suiteId>/ [on <env>] [parallel]
```

Sequential (default) walks each scenario with user checkpoints; `parallel` dispatches
one qa-executor per spec file autonomously. Outputs land in
`executions/execu_<timestamp>/` (report.md, per-session screenshots/logs, bugs/).
Cases with `stepCount: 0` in the manifest are never dispatched — they go straight to
the final report's "not automated" list. Login-gated suites (most of this app) run
sequential or pre-authenticated — see below.

**Codegen harvest (this pipeline's addition).** The plugin's `.playwright-cli/`
scratch is cleaned at run end and selectors would be lost, so **the orchestrator —
this session, never a qa-executor** (executors may only write inside their own
`browser-sessions/<session>/` slice) — writes one note file per spec:

```
executions/execu_<ts>/codegen-notes/<spec-stem>.md
```

- **Sequential mode**: write each spec's note right after its last scenario, before
  the run-end session close, from your own snapshot/run-code calls. Snapshots return
  accessibility refs, NOT selectors — before filling the Elements section, dump each
  interacted element's id/name/data-qa/css path with one `run-code` call.
- **Parallel mode**: executors close their own sessions, so notes are written
  immediately after MERGE, from the executor reports and their session logs. To make
  those carry implementation data, inject harvest work as scenario-shaped steps in
  each dispatched `TEST_SPEC` **text** (never edit the `tc-*.md` files): prepend
  `0. run-code: attach page.on('request'/'response') logging, save to
  {{SESSION_DIR}}/logs/network.log` and append a final step `for each element you
  interacted with, run-code dump its tag/id/name/data-qa/css path to
  {{SESSION_DIR}}/logs/selectors.log` — both live inside the executor's sanctioned
  write slice. A report that comes back without implementation data means that spec
  is treated as explore-skipped for harvest purposes (its verdict still counts).

Template:

```markdown
# Codegen notes — <spec file> (TC <id>)
## Pages visited        <!-- URL → purpose; note existing pages/<X>Page.ts overlap -->
## Elements interacted  <!-- business name → best stable selector, per element-locators order: id → name → data-qa → relative xpath/css -->
## Network calls        <!-- METHOD url → candidate Apis<Domain> endpoint (seed/verify) -->
## Data & quirks        <!-- authentication challenge references only; never values, waits needed, iframes, RTL/Arabic text, dialogs -->
## Verdicts             <!-- per scenario PASS/FAIL + defect refs from report.md -->
```

A scenario that FAILS here is an **app defect candidate**, not a reason to stop:
record it (offer `/bug-report-azure` filing), and phase 4 still generates its test
(marked `test.fixme` + `allure.issue` when confirmed). If the whole environment is
unreachable, stop and report BLOCKED.

**Login-gated suites.** Logging in with the configured test users in
`environments/<env>.json` is sanctioned test-data usage — the browser-testing
skill's environment resolution ("login as <handle>" → `users.<handle>`) exists for
exactly this; the plugin's "no real signup/login" autonomy rule bans real personal
accounts, not these. But a literal qa-executor may still skip login steps, so:

1. REFINE must have bound every login step to a `users.<handle>` — a case whose
   login has no matching handle is NEEDS-DATA and is not dispatched (configure the required user handles in the consumer project).
2. Prefer sequential mode for login-gated suites, or pre-authenticate with
   `/optimize-login` first (honor `login.mode` in `config/project.json`).
3. Never lift credentials out of ADO step text into specs or notes.

**Record the run in the manifest** when the phase ends: add to
`test/ado-suite-<suiteId>/_suite.json`:

```json
"explore": { "run": "executions/execu_<ts>", "skipped": false }
```

That entry — never "the newest run folder" — is what later phases and resumed
sessions read. The user may skip this phase ("generate directly"): record
`"explore": { "skipped": true }`; phase 4 then works from the refined specs and
manifest steps alone and expects more VERIFY iterations.

**Merge into the page map.** After the notes are written, fold their durable facts
into `.agentex/page-map/<page-slug>.md` (create from `_template.md` when the page is
new) per that folder's README contract: verified selectors, landmarks, rendered
strings, endpoints, gotchas. Per-run noise (verdicts, screenshots) stays in
codegen-notes; only page-level facts that will still be true next month move up.

---

## 4. GENERATE — skill-first POM automation

Inputs: `_suite.json` (raw ADO steps + suggestions), the refined specs from phase 2
(the executable expression of each case), the `codegen-notes/` of the run recorded
in `_suite.json.explore.run` (reading them is the sanctioned exception to the "never
read executions/" rule — nothing else under `executions/` is ever read; a run
without notes means re-explore, not log mining), the git-tracked
`.agentex/page-map/` (selector, landmark, and rendered-string authority proven by
earlier runs), and the existing framework code as the living style reference.

**Route through the skills — never from memory** (CLAUDE.md's common-flow order):

**Reuse gate (2026-08-24 ruling) — before writing ANY new action or validation
method** in steps 3–4: build the method inventory once per GENERATE pass — grep the
public method surface across all three business homes (e.g.
`grep -rn "async [a-zA-Z]" src/pages/ src/apis/ src/dbs/`) — then, for each business step a case
needs, reuse or extend an existing equivalent per action-methods practice 8
(case/suffix-tolerant search, legacy `assert*` names included; parameterized actions
count as coverage). Create a new method only when nothing covers the intent, via the
owning skill. The PR description lists the methods newly created per case; the
independent framework-review re-checks every new method against the inventory.

1. `pom-architecture` — layer decisions; which pages/services exist vs. are new.
2. `test-data` — `resources/testData/<Feature>TestJsonFile.json`: inputs and expected
   values from the ADO steps (copy expected strings EXACTLY as the app renders them,
   not as ADO paraphrases them — the harvest notes are the authority, and the string
   must match the locale the environment actually renders: source wording may differ from the configured application locale), secrets to `process.env`. Mutable
   inputs land in per-case `tc<id>` clusters (id = the case's tms id from the
   manifest); record-creating bases carry the TC id inside the value where the field
   tolerates a suffix — format-constrained fields get distinct valid per-case values
   instead — and compose with the module timestamp (test-data practice 7). Shared
   read-only families (error messages, app-universal expectations) stay file-level.
3. `page-classes` + `element-locators` + `action-methods` + `validation-methods` —
   extend existing page classes first; new ones only when the journey enters a page
   no class covers. Selectors come from the harvest notes, re-ranked by the
   element-locators strategy order.
4. `service-classes` — every seed/cleanup that has an API/DB path (iron law 8: never
   seed through the GUI). Harvested network calls are the endpoint candidates; the
   `integration/` catalog and the named DB catalog `src/config/databases.ts`
   tell you what backends exist; `resources/Queries/` tells you what SQL the team already
   uses — source `<operation>_query` fields from it first (service-classes practice
   3: derive-only, `@param`-parameterized, never raw); `resources/apisCollections/`
   tells you what endpoints and payload shapes the team already uses — source
   `<operation>_serviceName` fields from it first (service-classes practice 3:
   derive-only).
5. `test-classes` + `test-methods` — one spec per ADO suite is the single-feature
   default, `tests/<Feature>Tests.spec.ts`. Naming resolution, in order:
   - `<Feature>` starts from the manifest's `suggestedFeature`. If that is the
     fallback `Feature` (non-Latin suite name), derive an English feature name from
     the cases' domain and confirm it with the user — never ship
     `FeatureTests.spec.ts`.
   - The target file already exists and its describe/feature matches this suite's
     domain → EXTEND it, adding only the manifest tms ids it lacks. It exists but
     covers a different app/feature (foreign describe title or tms ids) → pick a new feature-law name instead (e.g.
     `ApplicationLoginTests`).
   - A suite spanning multiple features splits into one spec per feature — the
     feature-naming law beats "one file per suite".
   - Record the outcome in the manifest: `"resolvedSpecFiles": ["tests/…"]`.

   One test per test case (skip `stepCount: 0` cases — they go to the report's
   "not automated" list). Each test's first body lines:
   `allure.feature('<describe title>')` then `allure.tms('<TC id>')` — the ADO id
   from the manifest, one per test. A parameterized case (manifest `dataTable`)
   becomes one test per data row, titled with the distinguishing param value, all
   rows sharing that case's tms id, the rows an array INSIDE that case's `tc<id>`
   cluster — a record-creating row composes its distinguishing param value into the
   base before the timestamp, so sibling rows never collide. Tags from
   the ADO tags where they map to the repo's tag set. Login strategy for the spec
   (beforeEach login vs storage state) is a test-classes decision — surface the
   choice to the user when the suite is login-gated.

Environment note: the generated spec runs against `playwright.config.ts`'s `baseURL`.
If that differs from the environment the cases target (`_suite.json.target`), page
navigation must go through the page-class URL fields — raise the mismatch to the user
rather than hardcoding URLs in tests.

Before leaving this phase, the diff must pass an **independent framework review**:
invoke the `framework-review` skill with a fresh subagent as the reviewer (never the
session that generated the code), handing it the explicit changed-file list from
`git status --porcelain` — generated files are still UNTRACKED here and invisible to
a bare `git diff`. CHANGES-REQUIRED loops back into this phase — fix via the owning
skills, re-review the delta; **two CHANGES-REQUIRED verdicts on the same finding
class ⇒ stop and put the disagreement to the user** (it is probably an open
decision), never a third silent loop. Only an APPROVE verdict releases VERIFY.

---

## 5. VERIFY — run the generated spec until honestly green, twice in a row

From the repo root (data files are CWD-relative), non-interactive:

```powershell
$env:AUTO_ALLURE_OPEN='false'; $env:PW_TEST_HTML_REPORT_OPEN='never'; npx playwright test tests/<Feature>Tests.spec.ts --project=chromium
```

(Bash: `AUTO_ALLURE_OPEN=false PW_TEST_HTML_REPORT_OPEN=never npx playwright test …`.
Without those vars the HTML report server BLOCKS the terminal and the Allure report
pops open a browser window after every run.)

**Green means green twice (2026-08-24 ruling).** A single passing run proves the
script works once; it does not prove the tests are reusable. Greens are counted **per
case**: a case earns a green each time a run EXECUTES it and it passes — a sibling's
failure, a `fixme` skip, or a terminal-red sibling never blocks it. After the spec
first passes, run the SAME command once more with no intervening edits — the
confirmation run (sanctioned and required; the guard only warns about identical FAILED
reruns, never a rerun after a pass). When a terminal-failing sibling makes a
full-spec pass impossible, confirm the remaining cases with the guard-sanctioned
variation `-g "<test title>"` — a `-g` run still executes and greens the selected
case. Green-earning runs use retries 0 (the chromium project's local default): a
result that passed only on retry (Playwright reports it "flaky") is NOT a green —
classify it. Pass-then-fail
⇒ classify the failure (the data-reusability row below is the usual culprit), fix,
and re-earn both greens; if the confirmation run fails on a no-edit classification
(environment), the case is BLOCKED — once the environment is restored, re-enter with
a varied command (`-g "<title>"`), which satisfies the guard and still counts toward
greens. The confirmation run never consumes a fix round.

For each failure, classify before touching anything:

| Class | Signal | Action |
|---|---|---|
| Script defect | wrong/brittle locator, timing, wrong test data, strict-mode violation | Fix via the matching skill (element-locators for locators, etc.), re-run |
| Data reusability (script-defect family) | passed an earlier run, now fails with already-exists / duplicate / unique-constraint / leftover-record symptoms — typically on the confirmation run | Fix via the test-data reusability ladder (practice 8): per-case + per-run unique data → API/DB seed-and-cleanup (consult `resources/apisCollections/` / `resources/Queries/`) → assertion-free GUI cleanup ONLY when no lower-layer path exists (flag it in the PR). Record as `script-defect` with note `data-reusability: …` |
| App defect | EXPLORE phase saw the same failure on the manual path | Keep the assertion; `test.fixme` + `allure.issue`; offer `/bug-report-azure` |
| Environment | connectivity, credentials, seed API down | Report BLOCKED to the user; do not "fix" the test around it |
| Unclassifiable | EXPLORE was skipped, no manual-path data | After the final round, reproduce the failing step once manually in a scratch playwright-cli session: reproduces → app defect; doesn't → report UNCLASSIFIED with both hypotheses |

**Track rounds on disk.** Keep `test/ado-suite-<suiteId>/_verify-state.json` — per
TC id: fix rounds used, consecutive greens, classification, last run result
(`{ "cases": { "<tcId>": { "status":
"passed|failed|blocked|fixme|pending-confirmation", "rounds": n, "greens": n,
"classification": "app-defect|script-defect|environment|unclassified",
"note": "…" } } }` — the exact contract `scripts/publish-ado-results.mjs`
consumes; use those classification values verbatim, the marking logic matches on
them). `greens` counts consecutive runs in which the CASE executed and passed since
the last behavior-file edit affecting its spec; a case that passed its latest run but
holds `greens: 1` is recorded `"status": "pending-confirmation"` (unmapped in the
publish script — skipped, never published as Passed or Failed); record
`"status": "passed"` ONLY when `greens ≥ 2` (the rerun-reusability gate). A failure
of the case, or an edit to its behavior files — its spec, its paired data JSON, or
any `pages/`/`apis/`/`dbs/`/`utils/` file (conservatively: any such edit resets the
whole spec's greens; documentation and `resources/Queries/README.md` /
`resources/apisCollections/README.md` index/ledger edits never do) — resets its
`greens` to 0. A state file without a `greens` field is
legacy single-green state — re-earn the confirmation run before treating its
`passed` as terminal. The cap is **at most 3 fix rounds per test, cumulative across
sessions and `/loop` iterations** (read the file before fixing, update it after
every run); confirmation runs never count as fix rounds; a TC at 3 recorded rounds
whose case STILL FAILS is terminal — report it, never retry it (a case whose third
fix worked keeps its free confirmation run: rounds stay 3, greens proceed 1 → 2).
Terminal cases — 3 rounds exhausted and still failing, blocked-environment,
app-defect awaiting triage, unclassified — form the **NEEDS-HUMAN QUEUE**, derived
live from `_verify-state.json` by `node scripts/harness-metrics.mjs` (no separate
ledger to maintain): a terminal case is never retried, it is queued for a human.
Debugging aids: `--headed`, `-g "<test title>"`, `--trace on`.
Hard rules: never weaken/delete a validation to pass, never add `waitForTimeout`,
never mark `test.skip` just to go green. Remaining failures are REPORTED as failures
— a red report that tells the truth beats a green one that lies.

**Red flags — stop and classify instead of rerunning a FAILURE** when you catch any
of these in your own reasoning about a red run: "should pass now", "probably the
environment", "probably flaky", "close enough". (The current advisory guard warns about
rerunning an identical failed `playwright test` command with no intervening edit.)
The one sanctioned "one more run to be sure" is the required confirmation run after a
PASS — that is the reusability gate, not flake-chasing.

**Every locator repair feeds the drift ledger**: append `old → new + cause + date`
to the page's row in `.agentex/page-map/<page>.md`. Three drift entries for one
element = flag it in the next framework review — that selector strategy is wrong,
not unlucky.

---

## 6. DELIVER & REPORT

Generated code is not delivered until it is merged and ADO reflects reality. The
delivery chain, in order — each step's failure is reported to the user, never
silently skipped:

1. **Lint gate**: `node scripts/check-conventions.mjs --changed` must show 0 new FAILs
   (--changed includes staged and untracked files).
2. **Traceability table** (2026-08-27 ruling): write
   `test/ado-suite-<suiteId>/_traceability.md` — one section per test case, one row per
   executable step: `| # | Step | Method | Class | Layer | Why this layer |`
   (Layer = UI / API / DB), mapping every refined step to the business method that
   implements it (composed calls listed together; nested plumbing like a token fetch
   noted once at the top). **Why this layer** is filled ONLY on API/DB rows (UI rows
   get `—`): a code from the closed vocabulary plus one short clause —
   `per-ADO` (the case itself specifies the channel) · `seed` (state built below the
   GUI, iron law 8) · `oracle` (the expected result is only observable in that
   channel) · `cross-check` (second channel strengthening a UI assertion) ·
   `reroute` (the original observable is unreachable; the clause MUST name what it
   replaces — the detailed story stays in the spec's Refinement log). Codes combine
   with `+` (`oracle+reroute`); extending the vocabulary is a design-conventions
   change, never a per-file invention. Skipped/blocked cases get a one-line entry
   stating why. **Correction:** `test/` is fully gitignored by this framework's
   delivery convention — `git ls-files test/` is empty, and no suite delivery ever
   commits a `test/ado-suite-*/` folder. This file is therefore local-only, NOT a
   committed/versioned artifact — its content reaches the PR only via the
   description matrix + the posted comment thread (step 5 below). framework-review
   still cross-checks it against the spec, just locally, never from a git diff.
3. **Commit ONLY the pipeline's artifacts** on the `automation/ado-suite-<suiteId>-*`
   branch: the generated `tests/` / `pages/` / `apis/` /
   `dbs/` / `resources/testData/` files, `.agentex/page-map/` updates, and the
   class-ledger row. `test/ado-suite-<suiteId>/` (including `_traceability.md`,
   `_verify-state.json`, `_suite.json`) stays local-only per the gitignore — never
   `git add` it, never force-add against the ignore rule. Run `git status --porcelain`
   first — anything else in the tree is REPORTED to the user, never swept into the
   suite PR. Message: suite, cases automated, verify matrix. Never on master (the
   harness guard warns about master pushes; remote branch policy must enforce them).
4. **Push**: `git push -u origin <branch>`.
5. **Pull request**:
   ```
   node scripts/ado-pr.mjs --title "Automate ADO suite <suiteId> — <suiteName>" --description-file <path> --json
   ```
   Record the result in the manifest: `"pr": { "id": <n>, "url": "..." }` in
   `_suite.json`. The description carries: the TC ↔ test ↔ verify-status matrix, a
   pointer to the (local-only) `_traceability.md` (the full TC ↔ step ↔ method ↔ layer
   matrix does NOT live in the diff — `test/` is gitignored — so
   **Azure DevOps caps PR descriptions at 4000 characters
   and silently truncates beyond it**, so keep the description under the cap and
   never inline the full table). Then post the full table as a **PR comment thread**
   so it renders on the Overview tab (comments take ~150K chars):
   `POST {orgUrl}/{project}/_apis/git/repositories/{repo}/pullrequests/<id>/threads?api-version=7.1`
   with `{ "comments": [{ "parentCommentId": 0, "commentType": "text", "content": <table md> }], "status": "closed" }`
   — status `closed` so the thread never blocks a comment-resolution merge policy.
   The description also carries: defects found during EXPLORE (with evidence paths),
   what was NOT automated and why, the suite's current NEEDS-HUMAN QUEUE entries
   (from `node scripts/harness-metrics.mjs` — terminal cases must not hide in run
   reports), the methods newly created per case (the
   reuse-gate output), any
   assertion-free GUI-cleanup last-resorts (reusability-ladder step 3 flags), and
   the framework-review verdict. Exit 3 means the branch isn't pushed; exit
   2 means the PAT lacks Code Read & Write — tell the user, hand them the branch
   name, stop.
6. **Publish outcomes to ADO** (opt-in, confirm with the user first — it writes to
   the shared plan; once per pipeline, never per loop iteration):
   ```
   node scripts/publish-ado-results.mjs --suite <suiteId> [--dry-run first]
   ```
7. **After the PR is merged** (merged is not "PR opened" — check the PR's status via
   its recorded URL or the REST API before this step):
   ```
   node scripts/publish-ado-results.mjs --suite <suiteId> --mark-automated
   ```
   This sets the project's custom `Custom.Automation` picklist to "Automated" (plus
   the standard `Microsoft.VSTS.TCM.*` automation fields) on every case whose
   **script works** — VERIFY-passed, or failing on a classified `app-defect` (a
   valid assertion correctly detecting a real bug counts as automated; team ruling
   2026-08-22). Script-defect and environment failures are never marked. The team's
   rule is that a case is "Automated" only once its script is on master. Record
   `"markedAutomated": true` in `_suite.json` afterwards. **Resume
   contract**: a session that finds `pr` recorded but no `markedAutomated` checks
   the PR's merge status and runs this step if merged; a session ending before merge
   hands the user this exact command as the remaining step in its final message.

**Report to the user** (also the PR description's source):
- Matrix: TC id → title → EXPLORE verdict → generated test title → VERIFY status → note.
- Artifacts: `test/ado-suite-<suiteId>/`, `executions/execu_<ts>/report.md`, the
  generated spec + data files, PR link, Allure TMS links (wired via `allure.tms`).
- Defects: list app defects with evidence paths; offer `/bug-report-azure` (requires
  az CLI) or manual filing with the prepared defect blocks.
- What was NOT automated and why (blocked cases, missing backends, NEEDS-DATA), the
  methods newly created per case, and any GUI-cleanup last-resorts awaiting a
  backend path.
- The suite's NEEDS-HUMAN QUEUE (`node scripts/harness-metrics.mjs`): every
  terminal case — rounds exhausted, blocked, app-defect awaiting triage,
  unclassified — listed by TC id so none hides in the run report.
- Optionally generate the interactive dashboard: `/extent-report` over the recorded
  explore run.

**Learning step (closes every pipeline — run at session end regardless of merge
state).** Scan the run for durable knowledge and route each item once. The
discriminator: if an existing skill already implies the rule, it is a **gap** →
one ROW in the framework-review class ledger (date, class, file, scope
`pipeline-learning` — the three-row proposal mechanism then works unchanged); if no
skill takes a stance, it is a **decision** → flag it for a Decision-records row
(the team rules, you don't). Page facts → `.agentex/page-map/`; a broken ADO case →
tell the user to fix it at the source. "Nothing durable this run" is a valid result
— never manufacture learnings.

---

## 7. Looping until green (`/loop` integration)

For long convergence (flaky app, many cases), the user can hand the verify loop to
the loop skill:

```
/loop /automate-suite <planId>/<suiteId> verify
```

Each iteration re-enters this pipeline at VERIFY. **In loop mode the `verify`
keyword's continue-through-DELIVER rule is suspended: each iteration ends after
updating `_verify-state.json`.** DELIVER runs exactly once, after
`TERMINAL — matrix converged` (as the terminal iteration's tail, or as a fresh
`/automate-suite <ids> deliver`); outcome publishing is once-per-pipeline opt-in,
never per-iteration. **At VERIFY entry read `_verify-state.json` first**: when every
case is green with `greens ≥ 2` (the rerun-reusability gate) or terminally classified
(fixme'd app defect, BLOCKED, or round cap reached with the case still failing),
print `TERMINAL — matrix converged` and make NO further runs or edits. A case at
`greens: 1` (`pending-confirmation`) is NOT terminal — the iteration's job is its
confirmation run; when a terminal-red sibling blocks a full-spec pass, confirm the
remaining cases with `-g "<title>"` runs (greens count per executed case). In
`/loop` dynamic mode that line is the stop condition — end the loop; in
fixed-interval mode tell the user to stop it. The 3-round cap is cumulative via
`_verify-state.json`, so a loop iteration never re-earns fix attempts on a terminal
test. Deliberate flake-retries inside a loop must vary the command (the guard's
sanctioned forms: `--retries=1` or `-g "<title>"`) — an identical failed command
with no intervening edit violates the workflow; the current hook is advisory.

---

## 8. State on disk (resume rules)

| Phase considered done when | Artifact |
|---|---|
| BRANCH | current branch is `automation/ado-suite-<suiteId>-*` (never master) |
| FETCH | `test/ado-suite-<suiteId>/_suite.json` exists (with ≥1 case) |
| REFINE | every spec in the suite folder ends with a `## Refinement log` section, and every prose precondition is resolved per [prerequisite-dictionary.md](prerequisite-dictionary.md) (seed steps, GUI-chain expansion, or NEEDS-FIXTURE) |
| EXPLORE | `_suite.json.explore` names a run whose `codegen-notes/` has one file per dispatched spec, or `explore.skipped` is true; missing stems → re-explore only those specs |
| GENERATE | every file in `_suite.json.resolvedSpecFiles` exists and, across them, every manifest tms id appears in an `allure.tms` call (grep `tests/*.spec.ts` before declaring a partial), AND the framework-review verdict is APPROVE |
| VERIFY | `_verify-state.json` shows every case green with `greens ≥ 2` (two consecutive passing runs — the rerun-reusability gate) or terminally classified; a fresh session with no such file runs the spec (twice when green) to establish state |
| DELIVER | PR exists for the branch (`_suite.json.pr` records its id/url); outcomes published when the user opted in; `--mark-automated` run only after merge |

No phase keyword in the arguments → start at the first incomplete phase. `refetch`
forces phase 1 (refined specs survive it unless `--force`, and the fetch script
carries the pipeline keys — `explore`, `resolvedSpecFiles`, `pr`, `markedAutomated`
— forward automatically; diff the new `_suite.json` against the old one, report what
changed in ADO, and redo REFINE only for changed cases). `refine` forces phase 2
over the existing fetch.
