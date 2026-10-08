> Historical record. Read the [current documentation](../../contributing.md) for present behavior. Statements and validation results below describe their original implementation period.

# M17 — CI, evaluations and public readiness

M17 validates the distributed package and its existing execution architecture.
It adds no scenario engine, browser command language, SQL compiler, approval
service or catalog requirement. Sequential execution remains the default.

## Installed package gate

Use Node 24 and its bundled npm. From the package checkout:

```sh
node scripts/ci/installed.mjs <new-external-workspace>
```

The workspace must be new and outside the package, including resolved links.
The command creates an actual npm archive, installs it with scripts disabled,
and installs the separately locked example and native CLI spike fixtures. The pinned
native CLI used for browser execution is part of the root dependency graph; the
spike's own copy serves only its tests. The root
`npm-shrinkwrap.json` is the canonical, distributable dependency lock. It replaces
the root `package-lock.json` without changing dependency versions. The runtime
provenance inventory and generation fingerprint use this same published lock.

The standalone `npm run check:ci` uses a new external temporary audit directory and
prints its private location. An explicit audit argument must also be outside the
package; an in-package argument is rejected before checks or fixture writes begin.

The installed graph may have duplicated/relocated npm nodes. Every installed
identity must match a cleared version, registry origin and integrity value, and
its actual package metadata must match the lock. Missing or additional identities
fail. Hashes of all installed files and shim targets must remain unchanged across
validation. No repository `node_modules` or maintained source copy substitutes
for an installation.

The fixed checklist runs syntax, JSON parsing, local links, privacy, secrets,
provenance, archive inspection, real configuration/source contract validators,
three nonzero convention scopes, example and external-consumer TypeScript, the existing retrieval
self-test and every package test file. Zero tests, skips, cancellations, missing
entries, process errors and timeouts fail. JSON parsing is not schema validation;
the separate contract check and runtime tests exercise the actual validators.
The TypeScript gate uses strict inference of the installed JavaScript APIs at depth
one, compiles both workflow helpers, and requires an invalid consumer argument to
fail. See [consumer settings](M13-GENERATION.md) before importing these libraries.

`installed.json` is a sanitized summary. Check logs, installation paths and
native artifacts stay in the private workspace. npm repacking explicitly excludes
nested dependencies even when npm has omitted the original ignore files.

## CI and native evaluations

The repository workflow runs on pushes to `main`, pull requests and explicit
dispatch, using read-only repository permissions and commit-pinned actions.
Windows and Linux each validate a clean installation and execute the existing
26-case native browser proof. Linux additionally provisions the pinned disposable
SQL Server and PostgreSQL fixtures and runs the existing sequential/parallel
comparison, including real API operations. Only sanitized summaries are uploaded.
Authentication, raw host transcripts, traces and database credentials are excluded.

```sh
node scripts/ci/native.mjs <installed-workspace> browser
node scripts/ci/native.mjs <installed-workspace> parallel
node <installed-package>/scripts/ci/timeout-proof.mjs <new-timeout-workspace> mixed
```

Both commands require a passing installed check. Native browser installation uses
the pinned CLI fixture's Playwright installer. The parallel proof requires Docker
and permission to run the existing owned development database containers, including
SQL Server Developer's terms. It tests temporary fixtures, intentional retention,
required restoration and conflicts, cleanup failures, browser isolation and
semantic result association. Controlled FAIL/NEEDS_REVIEW results are expected
test cases, never converted into passing scenario verdicts.

The native supervisor sends a bounded cooperative cancellation before stopping
its owned process tree. Protected identity receipts let recovery close only the
recorded browser session and owner-labelled database containers if the process
cannot finish cleanup. Browser receipts are replaced atomically and cover both
standalone and parallel run layouts. Missing or contradictory ownership remains
incomplete; recovery never guesses from a shared name prefix. A lost browser-open
receipt requires a confirmed live named-session close when no process identities
were saved. Sensitive runtime storage is retained if cleanup cannot be established.

The timeout evaluation uses actual resources for cooperative cancellation, forced
termination and interrupted browser-open bookkeeping. It checks that unrelated
sessions and containers survive, required cleanup completes, and the interrupted
process still reports failure. CI runs `mixed` on Linux and `browser` on Windows.
If the supervisor already stopped a browser whose PID bookkeeping was lost, the
test requires automatic recovery to remain incomplete and retain protected data.
Only then may the test owner use the fixture's separate authentic process receipt
for teardown. Both results remain recorded; the uncertain recovery is never
relabeled as successful.

Windows database and authenticated host gates are also required for milestone
acceptance even though public hosted CI does not provide those credentials or a
Linux Docker daemon on its Windows runner. Run them locally against the installed
archive. `test:autonomy` selects the existing API, SQL Server, PostgreSQL,
sequential and parallel regression suites; these are also included in the full
checklist. Unit fixtures do not replace real database/browser evidence.

## Authenticated host gates

The existing proof scripts accept an installed package without copying it:

```sh
node <installed-package>/scripts/probes/hosts.mjs prepare-installed <new-host-workspace>
node <installed-package>/scripts/probes/hosts.mjs run <state-file> claude <claude-executable> <available-model>
node <installed-package>/scripts/probes/hosts.mjs run <state-file> codex <codex-executable> --reviewed-hooks
node <installed-package>/scripts/probes/hosts.mjs assess <state-file>

node <installed-package>/scripts/probes/workflow.mjs prepare-installed <new-workflow-workspace>
node <installed-package>/scripts/probes/workflow.mjs run <state-file> claude <claude-executable> <available-model>
node <installed-package>/scripts/probes/workflow.mjs run <state-file> codex <codex-executable>
node <installed-package>/scripts/probes/workflow.mjs assess <state-file>
```

Use the same state file returned by each preparation. The hook flag requires
prior human authorization of those fixed proof hooks; native permissions remain
in force. Configure the hosts' own authentication locally. Never put it in package
files or public CI artifacts. Each proof uses synthetic targets and separate
consumer state. The workflow gate includes actual canonical skill discovery,
native authorship, a different reviewer, two scoped green processes and Allure 3
generation. Both hosts must pass their own evidence checks before semantic
comparison. Compare relationships and outcomes, not raw IDs or timestamps.

`scripts/ci/Dockerfile` supplies a pinned Linux validation client built from a
sanitized `harness.tgz` archive. It contains no sign-in. Authenticated local runs
may mount the required native host settings read-only, use protected consumer
storage and supply the Docker socket only to the owned fixture proof. Do not
publish that image or authenticated runtime artifacts. A client failure or
unavailable host leaves the corresponding gate incomplete.

For a Docker Desktop client, explicitly set
`HARNESS_PROOF_DOCKER_HOST=host.docker.internal` for the proof process so it can
reach the same loopback-published owned fixtures. The fixture helper accepts only
that gateway or its default `localhost`. For the gateway route it owns a loopback
forwarder to each exact provisioned fixture port, and closes its sockets during
cleanup. Runtime targets remain local and ephemeral; semantic comparison still
preserves arbitrary remote destinations and ports. Native Linux CI uses the
default. The image verifies
both pinned native CLI versions and explicitly completes Claude's local binary
placement after dependency installation. It installs both the pinned Playwright
Chromium build and the Google Chrome channel required by the generated-test fixture.
The Playwright installer is pinned; Chrome's downloaded stable release is recorded
as an observed version in the validation evidence, not described as pinned.

Windows consumers resolve their physical long paths before native tool allowlists
are constructed. Workflow compiler diagnostics remain in private failure receipts
so the author can repair actual source errors; public status stays sanitized.
Native command evidence accepts a literal unquoted POSIX current-directory prefix
only when it names the exact consumer. Expansion, foreign directories, extra shell
operations and unpaired or failed receipts remain invalid.
When a Linux native sandbox cannot create its namespace before an operation starts,
the proof may request normal host approval escalation for that exact operation.
A rejection remains a blocker; hook denials and commands that actually started are
not replayed. Normal native approval remains required for each escalated operation.

## Acceptance and release boundary

Required evidence includes clean installed checks on both platforms; native
browser/API/two-database behavior; host hooks and full lifecycle semantic parity;
normal mutation autonomy; required cleanup and intentional retention; independent
implementation review; and reviewed privacy, secret, provenance and package
contents. Record exact scope, counts and failed attempts in the validation report.
Unavailable checks are not passes. Preserve each attempt rather than replacing
failure evidence with a later green result.

The owner confirmed historical credential revocation or rotation on 2026-10-01;
deleting its value alone would not have established that status. A green workflow
is not permission to tag, publish an npm package, redistribute third-party
installations or create a release. Those
actions still require explicit authorization. [The release guide](../../RELEASING.md) attaches
only the archive and checksum that a passing `main` run uploaded as `release-archive`.
