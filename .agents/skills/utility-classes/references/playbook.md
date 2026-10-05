# Utility Classes Playbook

The contract for everything in `utils/`. Both existing files — `src/utils/ApiActions.ts`
and `src/utils/DBActions.ts` — are **canonical**; there are no legacy variants in this
layer. Pattern-match on them. The root-level `global-setup.ts` / `global-teardown.ts`
lifecycle scripts are honorary members of this layer — practices 14–17. (Legacy patterns
you will meet upstream — public locators, `assert*` names, `/////////Assertions`
banners — belong to their own skills.)

## 1. Apply the litmus test before writing a line in `utils/`

**Rule:** utils code answers *how it's done reliably*; business code answers *what the
user/system does*. If a method mentions a domain noun (user, email, cart), an endpoint
path, a table name, or an expected value — it belongs in `pages/`, `apis/`, or `dbs/`.

**Why:** the architecture (design-conventions §1, iron law 1) hinges on this split; one
domain-aware helper in utils and the layering is gone.

✅ `ApiActions.post(url, options)` and `DBActions.query(queryText, params)` — generic
verbs, zero domain vocabulary (the verb shape is quoted in practice 13).

❌ `async createUser(name: string, email: string)` inside `ApiActions` — knows about
users and an endpoint; belongs in `src/apis/ApisUserManagement.ts`. Also never in utils:
business assertions and hardcoded expected values — a `verify*` method, or an `expect`
asserting a domain fact, belongs in `pages/`, `apis/`, or `dbs/`. (The domain-free
assertion-message facade `src/utils/Expects.ts` is the recorded exception — 2026-09-08
ruling; its contract is practice 18.)

## 2. Build one facade per external technology, named `<Noun>Actions`

**Rule:** wrap each raw driver (Playwright's `APIRequestContext`, an mssql
`ConnectionPool`, a future queue/file/mail client) in exactly one `<Noun>Actions`
class, and make it the only place that driver is touched. Business classes receive the
facade via their constructor and never call the raw API.

**Why:** the facade implements observability, redaction, and resilience once — a single
bypass call produces an invisible, unredacted operation. `src/utils/ApiActions.ts` states
its own purpose: Playwright "only surfaces API request/response payloads in the Trace
Viewer — never in the HTML/Allure reports … This wrapper fills that gap."

✅ `src/dbs/DbsUserManagement.ts` receives config, wires the facade, delegates everything:
`constructor(dbConfig: DBConnectionConfig) { this.dbActions = new DBActions(dbConfig); }`

❌ `this.request.fetch(url, …)` or `pool.request().query(…)` in a service class, page,
or spec — it works, but leaves no step, no attachments, no redaction.

## 3. Make every operation a named step — with an in-test guard

**Rule:** route each facade operation through one `test.step()` with a *technical*
title (`GET ${url}`, `DB QUERY …`), skipped entirely when no test is running.
Centralize the routing in a private `dispatch`.

**Why:** iron law 6 makes every operation a report step; the guard keeps the facade
usable in global setup where `test.step()` would fail.

✅ `src/utils/ApiActions.ts`:

```ts
/** Routes a call through a named `test.step` when inside a test; runs it plainly (no step/attachments) otherwise. */
private async dispatch(method: string, url: string, options?: FetchOptions): Promise<APIResponse> {
  const inTest = this.currentTestInfo() !== undefined;
  if (!inTest) return this.execute(method, url, options, false);
  return test.step(`${method} ${url}`, () => this.execute(method, url, options, true));
}
```

Utils steps use `test.step` from `@playwright/test`; business layers use `allure.step`
from `allure-js-commons` — the business step wraps the facade's technical step. Compact
long inputs for titles as `DBActions.stepTitle()` does (collapse whitespace, cap at 80).

## 4. Attach report payloads with `test.info().attach()` from inside the step body

**Rule:** create attachments only via `test.info().attach()` called *inside* the step
callback — never via the `step.attach()` handle.

**Why:** allure-playwright nests `test.info().attach()` inside the current step;
`step.attach()` lands outside the step in the Allure report (iron law 10).

✅ `src/utils/DBActions.ts`:

```ts
/** Attaches a payload as pretty-printed JSON to the current step (text/plain when truncated). */
private async attachJson(name: string, payload: unknown): Promise<void> {
  const { text, truncated } = this.clip(this.safeStringify(payload, 2));
  await test.info().attach(name, {
    body: text,
    contentType: truncated ? 'text/plain' : 'application/json',
  });
}
```

❌ `test.step('GET …', async (step) => { await step.attach('Response body', …); })`

Attachment names are report contract — keep the established vocabulary (`Request
details` / `Response details` / `Response body`; `Query details` / `Query results`) and
never rename casually.

## 5. Report best-effort: never throw from reporting, never swallow the real failure

**Rule:** wrap the reporting path in its own `try`/`catch` that only `console.warn`s;
the operation itself follows capture → report → rethrow, so the original failure always
surfaces after the report is written.

**Why:** a logging bug must never change a test's outcome — in either direction.

✅ Both halves, verbatim from `src/utils/ApiActions.ts`:

```ts
} catch (reportErr) {
  console.warn(`ApiActions: reporting failed for ${entry.method} ${entry.url}:`, reportErr);
}
// …and after reporting, execute() still surfaces the operation's own failure:
if (!response) throw failure ?? new Error(`${method} ${url} failed without a response`);
return response;
```

Every helper feeding the report holds the same line: `readBodySafely()` returns a
placeholder instead of throwing; `safeStringify()` "never throws — handles circular
references, BigInt, and Buffers". ❌ Letting `JSON.stringify` throw on a circular
payload, or returning `undefined` from a caught request error — both corrupt the verdict.

Practice 15 extends this contract to process level in the lifecycle scripts.

## 6. Redact secrets before anything leaves the facade

**Rule:** mask credential-shaped headers, body keys, and query params with `***` by
default, recursively (`redactDeep`, depth-capped), before attaching, console-logging,
or titling. `redact: false` is an explicit opt-out. Connection passwords never appear
anywhere (`DBConnectionConfig`: "The password never appears in any log or attachment.").

**Why:** iron law 7 — no secrets in step titles, logs, or attachments; utils is the
single enforcement point, so upstream layers can trust what they receive.

✅ The deny-lists, verbatim from `src/utils/ApiActions.ts`:

```ts
const REDACTED_HEADERS = new Set([
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'api-key', 'x-auth-token',
]);
const REDACTED_BODY_KEYS = new Set([
  'password', 'token', 'access_token', 'refresh_token', 'client_secret', 'secret', 'apikey', 'api_key',
]);
```

Redaction here does not license carelessness upstream: business step titles must still
never interpolate secrets (the known `LoginPage.login()` violation is
[action-methods](../../action-methods/SKILL.md)' counterexample).

## 7. Keep the facade usable outside a running test

**Rule:** detect test context by probing `test.info()` in a try/catch, and degrade
gracefully (no step, no attachments — console logging still works) when absent.

**Why:** the same facade serves global setup/teardown and ad-hoc scripts; `test.info()`
throws outside a test, so the probe is the one place that exception is expected.

✅ Both facades implement the identical probe, `currentTestInfo()` in
`src/utils/ApiActions.ts` and `src/utils/DBActions.ts`: `return test.info()` inside a
try/catch, `undefined` on throw — its JSDoc reads "Returns the active TestInfo, or
undefined when not inside a running test (test.info() throws there)." Both `dispatch`
and `shouldConsoleLog` branch on it.

> ❌ **Reporting anti-pattern:** unguarded reporting in `finally` can mask the
> request outcome; unguarded `test.info()` breaks non-test callers, and reading a
> response body twice loses the original observation. Keep reporting best-effort,
> preserve the operation error and capture the body once.

## 8. Resolve options constructor → env var → project metadata, with safe defaults

**Rule:** every behavior toggle lives in a `<Facade>Options` interface; resolve it as
explicit constructor option, then env var, then `test.info().project.metadata` — and
default every knob (`maxBodyLength` 50 000, `redact` true).

**Why:** callers get per-instance control, CI gets env-level control,
`playwright.config.ts` projects get per-project control — no layer hardcodes anything.

✅ `src/utils/DBActions.ts`:

```ts
/** Resolves the console-echo flag: constructor option, then DB_CONSOLE_LOGS env var, then project metadata. */
private shouldConsoleLog(): boolean {
  if (this.options.consoleLogs !== undefined) return this.options.consoleLogs;
  if (process.env.DB_CONSOLE_LOGS) return process.env.DB_CONSOLE_LOGS === 'true';
  return Boolean(this.currentTestInfo()?.project.metadata?.dbConsoleLogs);
}
```

Facade env toggles are opt-in: absent means off, and only the literal string `'true'`
enables (`API_CONSOLE_LOGS`, `DB_CONSOLE_LOGS`). The documented opt-outs
`AUTO_ALLURE_OPEN` / `ALLURE_HISTORY` (practice 16) are the sanctioned exceptions —
don't invent a third convention. True module constants in utils are `UPPER_SNAKE_CASE`
(`REDACTED_HEADERS`, `TEXTUAL_CONTENT`) per design-conventions §2.

## 9. Complexity is allowed here — and only here

**Rule:** loops, conditionals, `try`/`catch`, recursion, and type gymnastics are
legitimate inside `utils/` — and forbidden in specs, pages, apis, and dbs (iron laws
3–4). When a business class needs a branch or a loop, the answer is a new/extended
utils capability or a second intent-named business method.

**Why:** concentrating complexity in one reviewed, JSDoc'd layer keeps every other file
readable as plain business prose. ✅ `DBActions.redactDeep()` (recursion, depth cap),
`ApiActions.readBodySafely()` (nested try/catch). ❌ The same constructs in
`src/pages/LoginPage.ts` or a spec file.

## 10. Bound every attached payload

**Rule:** clip attachments and console bodies at `maxBodyLength` (append a
`…[truncated N of M chars]` note, switch contentType to `text/plain`), summarize
binaries instead of embedding them, and read response bodies exactly once.

**Why:** unbounded payloads bloat the Allure report and can hang serialization; each
`APIResponse` body read re-transfers the payload. ✅ `ApiActions.clip()`,
`readBodySafely()`'s `<binary body omitted: …>`, `extractRequestBody()`'s
`<Buffer N bytes>`.

## 11. Own the resource lifecycle: lazy open, idempotent close

**Rule:** stateful facades open their resource lazily on first use — single-flight, so
concurrent callers await the same in-flight connect — reuse it across operations, and
expose a `close()` that is a "safe no-op when never connected". One instance = one
resource; create more instances for more databases.

**Why:** tests must not pay for unused connections, parallel first-queries must not open
duplicate pools, and teardown must be callable unconditionally from `afterAll`.

✅ `DBActions.getPool()` — "Lazy singleton pool: returns the live pool, awaits an
in-flight connect, or starts one." It caches the in-flight promise in
`this.connecting`, clearing it on failure so a later call can retry; `close()` drains
both the live pool and any pending connect before closing, then resets state.

Lifecycle operations are report steps too (`DB CONNECT` / `DB CLOSE` with outcome
attachments). Where `close()` is *called from* is
[test-classes](../../test-classes/SKILL.md)' territory.

That resource (plus resolved options) is the **only** state a facade holds — facades
are stateless per-operation reporters: no accumulating log arrays, no `getLogs()`-style
buffers, no `fs` persistence. ❌ (illustrative counterexample) `ApiActions` kept a private `logs[]`
plus a `saveToFile('api-logs.json')` that wrote unredacted headers to disk — and was
never called by any test. The Allure report IS the log; a run-level artifact goes
through a Playwright reporter, never a facade field.

## 12. JSDoc every technical contract

**Rule:** in utils, document the class (purpose, guarantees, gotchas) and every method —
public and non-obvious private alike — including defaults, deviations, and driver quirks.

**Why:** iron law 12 exempts utils from "self-describing code over comments" precisely
because technical contracts (e.g. `DBActions`: "`GO` batch separators are client-side
syntax … not supported by the driver"; `trustServerCertificate` "deviates from the
driver default") cannot be carried by a method name.

## 13. Extend by pattern-matching the canonical facades

**New verb on an existing facade** — one-line delegation to `dispatch`, plus JSDoc:

```ts
/** Sends a PATCH request and logs it as a report step with attachments. */
async patch(url: string, options?: ApiRequestOptions): Promise<APIResponse> {
  return this.dispatch('PATCH', url, options);
}
```

**New facade (`<Noun>Actions`)** — build only when a test actually needs the technology
(iron law 11 — no speculative utils), carrying the full contract: `<Facade>Options`
with defaults, `dispatch` with in-test guard, structured log entry, never-throw
`report()`, `attachJson` via `test.info().attach()`, redaction deny-lists,
`safeStringify`/`clip`, `currentTestInfo()` probe, and — if stateful — the
lazy-open/idempotent-close lifecycle. Never write a driver API from memory: derive
types from the driver itself, as `ApiActions` does
(`type FetchOptions = NonNullable<Parameters<APIRequestContext['fetch']>[1]>`).

**Refine, don't rewrite (iron law 10):** a facade's versioned surface is its
report-facing behavior — (1) step-title format (`POST /api/…`, `DB QUERY …`),
(2) attachment names and order, (3) public verb signatures and return types. Internals
(step library, error handling, redaction, buffering) may be rebuilt freely as long as
that surface is preserved; validate by diffing an old vs new Allure report. ✅ The
demo→current `ApiActions` rewrite swapped allure-js-commons `step()` for guarded
`test.step()` and added redaction and clipping — yet kept the `${method} ${url}`
titles, the `Request details` / `Response details` / `Response body` attachment trio,
and every verb's `(url, options?) => Promise<APIResponse>` shape.

## 14. Global lifecycle scripts (`globalSetup` / `globalTeardown`) are honorary utils

**Rule:** `global-setup.ts` / `global-teardown.ts` live at the repo root — the accepted
Playwright convention, wired via `require.resolve` in `playwright.config.ts` (the
`playwright.config.ts` row of the
[pom-architecture layer map](../../pom-architecture/SKILL.md)) — but the utils rules
follow the role, not the folder: the full complexity license (loops, conditionals,
`try`/`catch`, `fs`, `child_process`) and the JSDoc duty apply. They run with **no test
context** — never `test.step()`, `test.info()`, or an Allure attachment.

**Why:** they execute once per run, outside any worker — before the first test and
after the last.

Scope is strictly run hygiene. ✅ Clear stale `allure-results` before the run
(`global-setup.ts`); generate the report, archive a timestamped copy
(`reports/allure-history/<timestamp>/index.html`), and optionally open it after
all reporters flush (`src/utils/AllureReport.ts`, reporter `onExit`). The archive
contains the generated HTML; it is distinct from optional Allure trend history.
❌ Business logic, and data seeding/cleanup of any kind — iron law 8 makes seeding
per-test (`beforeEach`, via API); these files run once per run and cannot honor it.

Ordering matters: Playwright runs globalTeardown BEFORE reporters' `onEnd`.
Generate from reporter `onExit` or a separate process after Playwright returns;
writing environment.properties early is not a substitute for the complete flush.
Register the generator before the HTML reporter: the viewer can keep its `onExit`
hook open during local terminal runs and prevent later exit hooks from running.
The example uses Node-based Allure 3 with an explicit single-file configuration.
No test, action method or Allure metadata call needs to change. See
[M14 reporting](../../../../docs/M14-REPORTING.md) for the pinned generator and
the independent authority of harness verdicts.

## 15. Lifecycle scripts never fail the run over report plumbing

**Rule:** practice 5, extended to process level: a teardown that only generates/opens
reports never `process.exit(1)`s or throws — catch, `console.warn`, return. Reserve
non-zero exits for failures that make the test results themselves untrustworthy. Setup
side, the same split: rethrow only when the failure would corrupt report integrity
(stale `allure-results` not cleared → the report silently mixes runs);
warn-and-continue for cosmetic preparation. (The shipped examples implement both
halves; a `global-setup.ts` scaffolded from an older package carries a deferred
"you might want to rethrow" comment — delete it, this rule is the answer it deferred.)

❌ (illustrative counterexample) `catch { …; process.exit(1); }` around `allure generate`/open: on a
headless CI runner the failed `open` command fails the whole build after every test
passed. The shipped teardown warns and returns instead — the tests alone decide the
exit code; a pipeline that treats the report as a mandatory artifact is guarded by
its own publish step, which fails when the file is missing (a deliberate ruling:
an earlier opt-in `ALLURE_STRICT` escape hatch was removed as redundant).

## 16. Lifecycle env toggles: documented opt-outs, desktop off in CI

**Rule:** `AUTO_ALLURE_OPEN` and `ALLURE_HISTORY` are **documented opt-outs**: by
default the teardown opens the report locally and archives a timestamped copy; set
either to `'false'` to skip — exactly as the runbook documents. Any behavior that
needs a desktop (opening a browser or GUI viewer) is *additionally* disabled
automatically when `process.env.CI` is set — CI must not depend on every pipeline
remembering an env var.

✅ `const autoOpen = process.env.AUTO_ALLURE_OPEN !== 'false' && !process.env.CI;`

Keep toggle conventions from multiplying: facades are opt-in `=== 'true'`
(`API_CONSOLE_LOGS`, practice 8); the documented opt-outs
`AUTO_ALLURE_OPEN` / `ALLURE_HISTORY` are the sanctioned exceptions — don't invent a
third convention.

## 17. Report paths: one source in code, lockstep copies in docs/CI

**Rule:** inside the codebase, lifecycle scripts share a constant with (or read) the
reporter config — never a second hardcoded copy of a path the reporter config owns.
Human-readable copies (the README report table, the CI artifact steps) cannot read the
config; they are updated in lockstep with any path change, per the design-conventions
**Report output contract**
([design-conventions](../../pom-architecture/references/design-conventions.md)).

**Why:** duplicated paths drift silently and keep "working" until the day they don't.

✅ (shipped example) `src/config/reporting.ts` — the allure paths, the history toggle,
and the `environmentInfo` object live in one module, imported by
`playwright.config.ts` and both lifecycle scripts.

❌ (illustrative counterexample) `global-setup.ts` cleared `./allure-results` while
`playwright.config.ts` carried a dead `outputFolder: 'reports/allure-results'` key on
the allure-playwright reporter — three files, two values, working only because the
reporter ignored the dead key and defaulted to `allure-results/`.

## 18. The assertion-message facade: `src/utils/Expects.ts`

The one sanctioned `expect` home in utils (2026-09-08 ruling — the practice-1 ban
narrows to *business* assertions). Playwright renders a value assertion's Allure step
as a bare `Expect "toBe"` — expected values reach only the trace, never reporters; the
custom-message 2nd argument is the sole channel, and it replaces the title verbatim
(discarding the `not`/`soft` markers). `Expects.ts` (shipped as
`examples/src/utils/Expects.ts`) implements the canonical grammar ONCE as generic
wrappers:

```ts
/** Asserts strict equality, titling the Allure step `Expect <subject> to be <expected>`. */
export function expectToBe<T>(subject: string, actual: T, expected: T): void {
  expect(actual, `Expect ${subject} to be ${fmt(expected)}`).toBe(expected);
}
```

Contract:

- **Domain-free** (practice 1 litmus): subjects and values arrive as parameters from
  the business layers; the facade knows verbs, not nouns.
- **Grammar lives here only** — `Expect <subject> to <verb phrase> <fmt(expected)>`;
  negation variants state `not` in the message (`expectNotToBeNull` → `… not to be
  null`); `fmt()` quotes strings, prints compact arrays (`[] (empty)`), clips objects;
  locator-backed wrappers end the message with `→` to delimit Playwright's appended
  selector tail (value/page receivers get no tail, hence no delimiter).
- **No extra step, no attachments** — the message-titled expect step IS the step
  (nesting identical to a bare expect, iron law 10); no `test.info()` probing needed
  (the message works outside tests too).
- **Delegation only**: locator/page wrappers pass the `Locator`/`Page` straight to
  native `expect` with `{ timeout }`/options pass-through — web-first auto-retry
  untouched; never resolve a locator's value eagerly.
- **Extend by need** (iron law 11): one wrapper per matcher actually used in the repo;
  a new matcher gets its wrapper (with the grammar verb) when the first call site
  needs it. Special report grammars get intent-named wrappers
  (`expectToBeOneOf(subject, element, allowed)` for inverted membership).
- **Secret-valued expectations use the secret variants**: when the expected value may
  be a credential (env-sourced logins/identities, a shared test account's IBAN, …),
  route it through `expectToContainSecretText` / `expectToHaveSecretValue` — the
  matcher asserts the real value while the title says only "the confidential expected
  text/value" (iron law 7 beats value visibility, always). Extend the secret family
  by need; never interpolate a credential into a subject either. With these, business
  classes carry NO direct `expect()` at all.
- Call-site rules (which assertions must use these wrappers, subject-phrase style) are
  [validation-methods](../../validation-methods/SKILL.md) practice 13's territory;
  enforcement is `check-conventions.mjs` `assertion-message` (warn,
  `dirs: pages/apis/dbs` — utils itself is out of scope, which also keeps the
  facade's own `expect` calls and non-asserting probe helpers legal).

## 19. Lighter-weight function-export facades

Not every technical concern needs the full `<Noun>Actions` contract (practice 13) —
`Expects.ts`'s plain-function-export style (practice 18) is also canon for a narrower
class of facade: a handful of independent helpers with no shared connection/lifecycle
state, each JSDoc'd with its technical contract. Shipped examples, each a
distinct shape worth pattern-matching:

- **`UiControls.ts`** — async-widget-race helpers. A third-party or framework-hydrated
  control that initializes asynchronously can wipe or drop input typed before it
  settles; each helper is a bounded retry loop that re-attempts the action until a gate
  signal (a button becoming enabled, a target becoming visible, a value sticking)
  confirms the widget actually settled, then falls through silently on exhaustion — the
  caller's own next assertion reports the terminal failure with full context, so the
  helper never swallows a real failure, only the noisy async-init race in front of it.
- **`PdfDocuments.ts`** — an external-library facade. Wraps a third-party parsing
  library (`pdf-parse`) behind the same thin-facade shape as `ApiActions`/`DBActions`:
  business classes hand in bytes and get back plain text/counts, and no parser type
  leaks upward (iron law 1).
- **`IdentityNumbers.ts`** — format-constrained synthetic-data generation. Some fields
  are checksum-valid (e.g. Luhn) without being checked against an external registry,
  and a successful use burns the value permanently — so per-run reusability comes from
  generating a fresh valid value each run instead of drawing from a reused pool
  (test-data practice 7).

## Boundaries

This skill does NOT cover: `Apis<Domain>` / `Dbs<Domain>` business wrappers and query
constants → [service-classes](../../service-classes/SKILL.md); business-titled
`allure.step()` wrappers → [action-methods](../../action-methods/SKILL.md); `expect()`
and `verify*` methods → [validation-methods](../../validation-methods/SKILL.md);
sourcing of env config, secrets, and JSON test data →
[test-data](../../test-data/SKILL.md); spec hooks that instantiate facades and call
`close()` → [test-classes](../../test-classes/SKILL.md); page classes and locators →
[page-classes](../../page-classes/SKILL.md) /
[element-locators](../../element-locators/SKILL.md).

## Review checklist — utility classes

- [ ] Passes the litmus test: no domain nouns, endpoints, table names, expected values, or business assertions (the `Expects.ts` generic wrappers are the recorded exception — practice 18)
- [ ] Facade named `<Noun>Actions`, one per external technology; the only place the raw driver is touched
- [ ] Every operation routed through a named `test.step` via `dispatch` with the in-test guard
- [ ] Attachments via `test.info().attach()` inside the step body — never `step.attach()`; established attachment names preserved
- [ ] Reporting try/catch only `console.warn`s; original failure rethrown after reporting (capture → report → rethrow)
- [ ] Secrets redacted by default (headers, body keys, params, connection password); `redact: false` is an explicit opt-out
- [ ] Works (minus attachments) outside a running test — `test.info()` probed in try/catch, never assumed
- [ ] Options resolve constructor → env var → project metadata, every knob defaulted; payloads clipped at `maxBodyLength`
- [ ] Stateful resources: lazy single-flight open, idempotent `close()`, lifecycle steps reported
- [ ] No per-run state on facades: no log buffers, no `getLogs()`, no `fs` persistence — the Allure report is the log
- [ ] Class and methods carry JSDoc; rewrites preserve the facade surface (step-title format, attachment names/order, verb signatures) — verified by diffing old vs new Allure reports
- [ ] Lifecycle scripts: run hygiene only (no business logic, no seeding); no `test.step()`/`test.info()`/attachments; JSDoc'd like utils
- [ ] Teardown never exits non-zero or throws over report generate/open; setup rethrows only for report-integrity failures
- [ ] Report generation waits for all reporters to flush (`onExit` or a subsequent process); environment information comes from the reporter; archives the report before opening the latest
- [ ] `AUTO_ALLURE_OPEN` / `ALLURE_HISTORY` opt-outs honored, desktop behavior auto-disabled when `CI` is set; facade toggles stay opt-in `=== 'true'`
- [ ] Lifecycle scripts share a constant with (or read) the reporter config — no second hardcoded path copy in code; README report table and CI artifact steps updated in lockstep with any path change
