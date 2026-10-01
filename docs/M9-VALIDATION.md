# M9 validation record

M9 is accepted on 2026-10-01: required checks passed and independent review approved
the corrected implementation. No finding was waived. M10 has not started.
The [sequential guide](M9-SEQUENTIAL.md) describes the interface and limits.

## Scope and frozen review

The implementation starts from `b7a17362024dd33bef30a79e2b5bc8832bc77e68` on the
existing `main` branch. M9 connects the existing browser, API and SQL Server runtimes
through four ordinary callbacks: setup, exercise, verify and cleanup. They share
identity, typed producer bindings, effects, evidence, required lifecycle obligations,
sensitive-value screening, cancellation and one final M5 assessment.

Cleanup remains conditional on scenario intent and ownership. Persistent outcomes
remain valid without forced before-images. Catalogs, helpers, inline definitions and
permitted exploration retain their existing authorization. There is no phase replay,
new browser command language, SQL compiler, general workflow engine, scheduler,
host adapter or PostgreSQL driver. Package metadata is aligned at 3.0.9; dependencies,
consumer examples and convention baselines are unchanged.

The final review-02 implementation diff contains 22 files, 909 additions and 128
deletions, SHA256
`b1c97e6e03af3aff61e76f3a71fd2def3faed0375f5774bd6d9c49e7e3bc66a6`.
The reviewer verified all 210 frozen publication source hashes. Frozen patches,
original failures, synthetic reproductions and command receipts remain in protected
local audit storage. Only this acceptance document changed after approval; separate
final documentation and publication checks verify that delivery change.

## Package validation

Checks-03 passed all 16 commands. The exact local launcher was
`node <node-install>/node_modules/npm/bin/npm-cli.js run <script>`; the whole suite
used `node <node-install>/node_modules/npm/bin/npm-cli.js test`. The bundled npm CLI
was necessary because the ordinary local launcher is unavailable. Receipts retain
actual exit status, standard output and standard error.

| Command | Result and actual scope |
|---|---|
| `npm run check:syntax` | PASS: 69 JavaScript files |
| `npm run check:json` | PASS: 20 files, 19 parsed records |
| `npm run check:links` | PASS: 91 Markdown files, 361 local links |
| `npm run check:conventions` | PASS: 15 example files, 60 rule applications, zero findings |
| `npm run test:core` | PASS: 82 tests, zero skipped |
| `npm run test:browser` | PASS: 11 tests, zero skipped |
| `npm run test:api` | PASS: 61 tests, zero skipped |
| `npm run test:database` | PASS: 57 tests, zero skipped |
| `npm run test:sequential` | PASS: 13 tests, zero skipped |
| `npm test` | PASS: 384 tests, zero skipped; includes the focused suites above |
| `npm run test:fetch` | PASS: 15 self-test checks, 3 parsed synthetic nodes |
| `npm run typecheck:examples` | PASS: 18 example TypeScript files |
| `npm run check:privacy` | PASS: 210 publication candidates |
| `npm run check:secrets` | PASS: 210 publication candidates |
| `npm run check:provenance` | PASS: 210 candidates, 226 dependency records |
| `npm run check:publication` | PASS: 210 candidates, 207 packed files |

JSON parsing is not schema validation. Remote links and Markdown anchors were not
checked. The changed-file convention check has no applicable POM runtime scope;
that is not a passing coverage claim. The nonzero example gate passed without rule
weakening or baseline expansion. Local tests cover contracts, refusals and real
loopback HTTP; they are not browser/database integration proof.

## Real mixed and standalone validation

| Proof | Client | Mixed SQL cases | Browser regression cases | Other cases | Result |
|---|---|---:|---:|---:|---|
| Windows-04 | Windows, Node 24.15.0 | 12 | 8 | 0 | PASS: 20/20, zero skipped |
| Linux-02 | Linux, Node 24.21.0 | 12 | 8 | 13 focused | PASS: 33/33, zero skipped |
| Database-01 | Windows, Node 24.15.0 | 0 | 0 | 39 existing real SQL cases | PASS: 39/39, zero skipped |
| Browser-02 | Windows, Node 24.15.0 | 0 | 26 existing live checks | 0 | PASS: 26/26 |

The actual mixed commands were:

```sh
node scripts/probes/sqlserver.mjs --mixed
node scripts/probes/sqlserver.mjs --mixed --linux-client --browser-client-image=sha256:89ded7e03fc0859f989e6205c530bbe9ec343b5e0250a156b43673ee8f3b3057
```

Standalone commands were `node scripts/probes/sqlserver.mjs` and
`node scripts/probes/browser.mjs <fresh-external-consumer>`. The fresh consumer path
is intentionally omitted from public documentation. The eight new browser controls
also passed directly through `node --test harness-tests/mixed-browser.integration.mjs`;
the retained platform receipts rerun them as part of the full mixed suite.

Both final mixed probes used node-mssql 12.7.2 and SQL Server 16.0.4295.3 from:

`mcr.microsoft.com/mssql/server@sha256:4402d880dd4c34bfa7d8705e56a86cd6c88da80a1f6bbbe741f999e76264a090`

The exact browser graph remains Playwright CLI 0.1.22 and
Playwright/playwright-core 1.64.0-alpha-1790635538000. The native adapter validates
the M4 lock digest, versions and effective owned profile before dispatch. Linux used
the immutable browser-client image named above; it copied only publication sources,
installed the root lockfile with lifecycle scripts disabled and used that image's
pinned CLI graph. No checkout, Git history, private audit material or database volume
was mounted. SQL Server ran in a disposable Linux container for both clients; this
does not claim a native Windows SQL Server installation.

The two client runs repeat the same behaviors; their counts are not distinct coverage.
The 12 mixed SQL cases cover:

- Database setup, native UI exercise, API verification and database cleanup.
- API setup, native UI exercise, database verification and API cleanup.
- API setup/exercise followed by database verification with intentional persistence.
- Protected API before-state, database mutation and API verification followed by
  guarded restoration; a separate concurrent-change case preserves the conflict.
- Partial database/API setup failure, blocked later verification and cleanup of the
  fixture that was created.
- Uncertain API mutation with confirmed-effect, missing-required-response and
  inconclusive reconciliation outcomes; no duplicate mutation and database cleanup.
- Required API cleanup failure preventing a clean pass, and preservation of an
  independently established assertion FAIL.
- Confidential API output refused by a later public database extraction.

All assessed runs use real registered evidence and M5 integrity checks. The native UI
uses the official CLI and the same SQL-backed synthetic application as API/database
verification. Setup and cleanup execute under configured capabilities without repeated
harness approval. The fixture application has its own driver connection; its server
code is not a harness executor bypass.

The 39 standalone SQL cases were rerun before the browser-specific review correction.
Their API/database/shared-state/driver code remained identical in the final freeze;
both final mixed probes reran the corrected coordinator. The full standalone browser
proof was rerun after correction, including assertion failures, recovery, authentication,
cancellation, deadlines, owned lifecycle and unrelated-session preservation. Package
immutability passed and its external consumer was removed.

All final mixed receipts confirm owned database/client/network cleanup. A separate
post-run inventory found no M9 containers or networks. Deliberately retained or failed
business fixtures were removed when their disposable test database was destroyed;
that test-fixture teardown does not rewrite the tested scenario verdict.

## Independent review and corrections

The first Windows mixed attempt passed 10 of 12 cases. Two native-browser cases
exposed Windows short-path versus native-path identity mismatches before dispatch.
Physical root comparison now expands those aliases; final Windows and Linux proofs
pass. The original failed receipts remain preserved.

Independent review of the first frozen implementation returned CHANGES-REQUIRED for
one blocking class: `browser-sensitive-metadata-finalization`. A confidential API
value matching a fixed browser status or boolean could make automatic evidence throw.
A real reproduction showed a completed mutation losing its attempt record and required
business cleanup not running. A neutral control completed correctly.

The correction keeps fixed native facts separate from application values, screens
caller-supplied command names, omits raw callback exception fields, and continues strict
screening of public observations and outputs. Failed automatic observations retain the
real attempt, effect and resource bindings, mark the result indeterminate and allow
required cleanup. A started invocation with a broken record cannot be relabeled as
definitely unexecuted.

Eight real-browser regressions cover status/boolean collisions, command-name redaction,
a normal confidential value, callback diagnostics, rejected public observations and
outputs, and an injected automatic evidence-write failure after a real mutation. They
verify actual effects, recorded identities and actual cleanup. All pass on both clients.
The independent re-review checked the correction, frozen hashes, requirements,
architecture and retained receipts, independently reran the 13 local sequential cases
and nonzero convention gate, and issued APPROVE. It inspected live receipts rather than
claiming to rerun native browser or SQL itself. F1 is resolved; none was waived.

## Provenance, limits and remaining dependencies

No new dependency or copied third-party implementation was introduced. The 226 checked
license records remain 150 example, 3 Playwright CLI and 73 runtime dependencies.
Required notices remain intact. SQL Server, browser and container distributions remain
separate upstream software and are not relicensed under the project's MIT license.

Protected business-value storage remains consumer-provided. Explicit sanitization is
required for native artifacts; arbitrary encodings and undeclared confidential fields
are not automatically discoverable. Synchronous callback code still needs host process
limits. Invalid or incomplete result records fail validation rather than become a pass.

Historical credential revocation/rotation remains owner-dependent and unconfirmed.
M9 used generated disposable credentials only and did not read, reproduce or test any
historical value or create a secret-bearing recovery copy.

Full standalone browser regression on Linux, live Claude/Codex semantic parity,
external/Azure targets, PostgreSQL, generation/review integration, reporting and parallel
execution were not performed by M9. They are not implied by these platform proofs.
No public package release or release tag was created. M10 and later implementation
require the next authorization.
