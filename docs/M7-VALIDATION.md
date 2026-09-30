# M7 validation record

M7 is accepted on 2026-10-01: all required gates passed, and independent review
approved the corrected implementation with all six findings resolved. M8 is not
started. The [API guide](M7-API.md) describes the supported interface and limitations.

## Scope and frozen review

The existing `main` branch remains based on
`8a7af1ae317af999299afc3382de4786a4114dfc`. M7 adds one deterministic sequential API
runtime for catalog, helper, inline and exploratory definitions, with native HTTP(S),
typed bindings, effects, sanitized evidence, recovery and intent-driven lifecycle.
It adds no host adapter, database executor, workflow engine or parallel scheduler.

One narrow shared JSON validator correction permits an exact plain-data input-reference
slot under a sensitive wire-field name. Actual sensitive literals, accessors, extra
properties and malformed references remain refused. Concrete sensitive request inputs
are resolved once per invocation and remain only in memory. No new dependency or
third-party implementation was added; required notices remain unchanged. Package
metadata is aligned at 3.0.7, including the formerly stale root lockfile version.

The approved review-04 diff contains 18 files, 1,164 additions and 9 deletions, SHA256
`9bcbd26c7a7cffef2a8602f34aaa429964649a141cd2bbca9cfdb7b30841059f`.
The reviewer checked the frozen diff and all 191 source hashes. Frozen patches,
original reports, synthetic reproducers and validation receipts remain in protected
local audit storage. Only this acceptance document changed after approval; final
documentation/privacy/provenance/publication checks are recorded separately.

## Final package validation

Checks-04 passed all 14 commands. They ran through the Node installation's bundled
npm CLI because the local npm launcher is unavailable. The exact launcher pattern
was `node <node-install>/node_modules/npm/bin/npm-cli.js run <script>`; the whole
suite used `node <node-install>/node_modules/npm/bin/npm-cli.js test`. Receipts
preserve each exit status, standard output and standard error.

| Command | Result and actual scope |
|---|---|
| `npm run check:syntax` | PASS: 55 JavaScript files |
| `npm run check:json` | PASS: 19 files, 18 parsed records |
| `npm run check:links` | PASS: 87 Markdown files, 348 local links |
| `npm run check:conventions` | PASS: 15 example files, 60 rule applications, zero findings |
| `npm run test:core` | PASS: 82 tests, zero skipped |
| `npm run test:browser` | PASS: 11 tests, zero skipped |
| `npm run test:api` | PASS: 60 tests, zero skipped |
| `npm test` | PASS: 313 tests, zero skipped; includes the focused suites above |
| `npm run test:fetch` | PASS: 15 self-test checks, 3 parsed synthetic nodes |
| `npm run typecheck:examples` | PASS: 18 example TypeScript files |
| `npm run check:privacy` | PASS: 191 publication candidates |
| `npm run check:secrets` | PASS: 191 publication candidates |
| `npm run check:provenance` | PASS: 191 candidates, 153 dependency records |
| `npm run check:publication` | PASS: 191 candidates, 188 packed files |

JSON parsing is not schema validation. Remote links and Markdown anchors were not
checked. `check-conventions --changed` correctly refused empty POM scope; it is not
a passing coverage claim. The nonzero example baseline passed without changing or
expanding any convention baseline.

The original candidate's 298 passing tests did not establish acceptance: independent
review found missing cases. One later secret-scan failure was a false match on a
synthetic password-field equality expression. The test was rewritten to compare a
local value; the scanner and its baseline were unchanged. The final secret gate passes.

## Platform and transport evidence

| Platform | Runtime | API tests | Core-input tests | Outcome |
|---|---|---:|---:|---|
| Windows | Node 24.15.0 | 60 | 23 | PASS, zero skipped |
| Linux container | Node 24.21.0 | 60 | 23 | PASS, zero skipped |

The focused command was `node --test harness-tests/api-runtime.test.mjs
harness-tests/execution-inputs.test.mjs`. Linux attempt-04 used the existing pinned
development image with `--init --network none` and a publication-only source archive.
It mounted no checkout, private archive or Git history. The owned container was
removed after the result was captured. Both the host source and container package
retained this 191-file digest throughout the run:
`0094b93a6dfb23c219d87ae59b595c5dac4b8ed11b1c3391b6ead36b5458c092`.

API tests use real loopback HTTP requests, socket disconnects, stalled requests,
synthetic authentication and server-side effect counters. Other cases deliberately
prove zero dispatch or test contract validation. Each assessed run validates actual
artifact files and hashes through M5; evidence-tampering tests require refusal.
Temporary consumers and fixture servers are cleaned up by the tests. No real account
or external service was contacted.

Coverage includes all five CRUD verbs; source equivalence; typed body/query/path
binding and extraction; expected non-2xx; credential refresh without duplicate effects;
unavailable connections versus uncertain transmitted writes; finite safe retries;
no-effect/confirmed-effect/inconclusive reconciliation; endpoint-supported idempotency;
target/path/redirect refusal; immutable configuration and resolved replay inputs;
credential and selector redaction; setup, cleanup, conditional restoration and
intentional retention; cancellation/deadlines and sequential-only invocation.

## Independent review disposition

The independent reviewer reran 83 focused tests and 12 adversarial/control cases,
inspected final package/Linux receipts and approved the frozen corrected candidate.

| Finding | Resolution |
|---|---|
| Cookie/Basic credential components leaked under neutral fields | Supported credential components are classified before dispatch and screened in persisted values. |
| Sensitive response values reached assertion evidence | Sensitivity is established before evidence; overlapping text, JSON and case-normalized header selectors share confidentiality. Public text also screens parsed JSON fields. |
| Protected inputs changed across retries | Actual values are copied into a bounded invocation-local snapshot; retries reuse the same body and idempotency key. Credentials refresh separately. |
| Declared GET mutations used read permission | Only explicitly read-only GET uses read capability; known/unknown effectful intent requires mutation capability. |
| Safe sensitive-field templates were rejected | Exact input-reference slots are accepted; literal secrets, malformed slots and accessors remain rejected, and sensitive wire fields require protected bindings. |
| Cancellation after expiry produced an invalid result | Already-expired, unexecuted attempts normalize to TIMEOUT and produce a valid BLOCKED result. |

Original failing evidence remains preserved. The review ledger marks all six classes
resolved; no finding was waived. The approved architecture and source-peer policy
remain intact. Required cleanup failures and restoration conflicts stay visible;
reliable assertion failures are never erased by recovery.

## Limits and remaining dependencies

Live external API authentication, HTTPS integration fixtures, Claude/Codex execution
parity, database execution, generation integration and Allure reporting were not
performed in M7. HTTPS retains native certificate verification but was not exercised
by these HTTP fixtures. The M6 live browser probe was not rerun; its policy tests and
the expanded shared-core suite passed. Later milestones own the remaining integrations.

Historical credential revocation/rotation remains owner-dependent and unconfirmed.
No historical credential was read, reproduced or tested during M7. Protected sensitive
value storage is consumer-provided; the runtime supplies no plaintext value store.
No public package release, release tag or license/provenance shortcut is authorized
by this acceptance. M8 and later implementation require the next authorization.
