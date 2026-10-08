# Develop and validate the harness

This repository develops the reusable package; adopted projects own their test code
and state. Read [ROOTS.md](../.agents/skills/ROOTS.md) and route framework changes
through [pom-architecture](../.agents/skills/pom-architecture/SKILL.md) and its specialists.
Use the ongoing feature branch and deliver through a PR. See [architecture](architecture.md).

## Development setup

Use Node 24 and its bundled npm. Root npm-shrinkwrap.json is the distributable lock;
examples and development CLI spike have separate locks:

```sh
npm ci --ignore-scripts
npm ci --prefix examples --ignore-scripts
npm ci --prefix scripts/spikes/playwright-cli --ignore-scripts
```

Package tests inspect the pinned CLI without browser download. Live probes separately
need browsers, Docker or authentication. Do not mutate examples as a consumer;
installed proofs create external consumer workspaces. Canonical skills live under
.agents/skills; runtime plumbing belongs in scripts/lib, CLI entrypoints in scripts,
and consumer examples in their POM layers. Optional hooks are advisory, never setup-enabled.

## Checks for a change

Run focused checks for touched behavior, then the fixed package checklist before delivery:

```sh
npm run check:syntax
npm run check:json
npm run check:contracts
npm run check:links
npm run check:conventions
npm run typecheck:examples
npm test
npm run test:fetch
npm run check:privacy
npm run check:secrets
npm run check:provenance
npm run check:publication
```

check:ci runs the fixed checklist with logs in a fresh private external audit directory;
explicit in-package audit paths fail before writes. It also checks nonzero generation/
workflow convention scopes and strict external-consumer TypeScript. JSON parsing is
separate from schema contracts. Local links exclude remote URLs/anchors, so review
Markdown rendering/fragments separately. Publication is an offline pack dry-run,
not npm publishing. Empty scopes/unresolved Git bases fail; do not expand baselines
or weaken rules to hide new violations.

| Area | Focused npm scripts |
|---|---|
| Conventions/routing | test:conventions, test:roots, test:skill-proof |
| Setup/local sources | test:adoption, test:local-source |
| CLI/core | test:cli-spike, test:core |
| Runtimes | test:browser, test:api, test:database, test:postgresql, test:sequential, test:parallel |
| Hosts/workflow | test:hosts, test:workflow |
| ADO | test:integrations, test:fetch |
| Generation/reporting | test:generation, test:reporting, test:allure |
| Manual execution | test:execute |

Use `npm run <name>`. Focused counts are subsets, not added coverage. Independent
[framework review](../.agents/skills/framework-review/SKILL.md) checks conventions and
semantic ownership. Retain exact findings/attempts; unperformed/unavailable gates stay incomplete.

## Installed package and platform checks

A green checkout does not prove the distributed archive:

```sh
npm run test:installed -- <new-external-directory>
```

It packs/installs the archive with lifecycle scripts disabled, installs locked fixtures,
and runs the fixed checklist. Identity/version/origin/integrity/actual metadata must
match cleared records. Duplicate/relocated npm nodes are supported; missing/extra
identities fail. Installed bytes/shim targets stay unchanged. Checkout dependencies
or source copies cannot substitute. Zero tests/skips/cancellations/missing checks/
errors/timeouts fail. Only sanitized installed.json is shareable; private logs/artifacts remain outside.

Repacking excludes nested dependencies. Releases use npm 11 because npm 12 omits
the shrinkwrap from archives. Consumer npm 12 adoption flows are supported; readiness
reports when shrinkwrap comparison is unavailable. See [getting started](getting-started.md).

CI runs main pushes, PRs and dispatch with read-only repository permissions and
commit-pinned actions. Windows/Linux check clean installs and the native browser;
Linux adds real SQL Server/PostgreSQL/sequential/parallel API fixtures. Uploaded summaries
are sanitized, excluding credentials, auth, raw transcripts and traces. Native commands:

```sh
node scripts/ci/native.mjs <installed-workspace> browser
node scripts/ci/native.mjs <installed-workspace> parallel
node <installed-package>/scripts/ci/timeout-proof.mjs <new-timeout-workspace> mixed
```

Native evaluation requires passing installed validation. Browser installation is pinned.
Database/parallel proofs require Docker permission and SQL Server Developer terms.
Timeout CI uses mixed on Linux/browser on Windows. Hosted Windows does not establish
database or authenticated-host gates without separate available prerequisites.

## Live probes and authenticated hosts

| Probe script | Purpose/prerequisites |
|---|---|
| probe:cli, probe:browser | Pinned native viability/browser fixtures |
| probe:database, probe:postgresql | Owned disposable real engines; Docker |
| probe:mixed | SQL-backed HTTP/UI; Docker and browser |
| probe:database-neutrality | Same scenarios across engines; optional -- --linux-client |
| probe:generation, probe:reporting | Live consumer authoring, actual independent review, scoped runs |
| probe:workflow | Native source-to-authoring/review/two-greens/reporting |
| probe:parallel | Isolated bounded batch vs sequential semantics |
| probe:execute | Installed-archive manual-execution proof |

Use required subcommands/arguments from command output and runtime references.
Interactive author/reviewer proofs are not unattended fixture tests. test:autonomy
selects existing regression suites already included in the full checklist.

Supervision first requests bounded cooperative cancellation, then stops only recorded
owned trees with creation identities. Missing/contradictory ownership stays incomplete.
Unrelated resources survive; cleanup must finish; interruptions still fail. Retain
protected storage when cleanup is uncertain. Controlled negative scenarios can prove
the gate while retaining FAIL/NEEDS_REVIEW verdicts.

Host execution parity and complete workflow parity are separate. They need authenticated
native Claude/Codex, Node 24 and runtime prerequisites. Use returned state files and
protected external consumers; never copy sign-in values into package/public artifacts.

```sh
node <installed-package>/scripts/probes/hosts.mjs prepare-installed <new-host-workspace>
node <installed-package>/scripts/probes/hosts.mjs run <state-file> claude <claude-executable> <available-model>
node <installed-package>/scripts/probes/hosts.mjs run <state-file> codex <codex-executable>
node <installed-package>/scripts/probes/hosts.mjs assess <state-file>

node <installed-package>/scripts/probes/workflow.mjs prepare-installed <new-workflow-workspace>
node <installed-package>/scripts/probes/workflow.mjs run <state-file> claude <claude-executable> <available-model>
node <installed-package>/scripts/probes/workflow.mjs run <state-file> codex <codex-executable>
node <installed-package>/scripts/probes/workflow.mjs assess <state-file>
```

Trust proof hooks natively; add reviewed-hooks only after explicit person review/
authorization for one run. It bypasses neither approval nor sandboxing. Denials and
missing prerequisites leave proof incomplete. Exact native escalation after namespace
failure is distinct from replaying started/denied operations. Paired chronological
pre/post receipts, actual edits/commands and resulting digest/count are required;
final prose is insufficient. Reassessed semantic parity normalizes only declared
generated slots and loopback ports, not business differences/missing scope.

The pinned Linux Docker client has no sign-in. Authenticated local proofs can mount
host settings read-only and protected consumer storage, with Docker socket only for
owned fixtures. Never publish authenticated images/artifacts. Docker Desktop may
use HARNESS_PROOF_DOCKER_HOST=host.docker.internal; exact-port forwarders are owned/
closed. Downloaded Chrome stable is observed, distinct from pinned Playwright.
See [hosts](reference/hosts.md) for detailed hook/permission behavior.

## Evidence and release

[Archives](archive/README.md) retain dated versions, platforms, attempts and limits.
Skill/CLI/hook/runtime/workflow/adoption/manual checks establish their own scopes,
not every host, OS, tenant or UI adaptation. Record failures/repairs alongside final
outcomes with exact counts, prerequisites, omitted gates and independent findings.

Use [provenance](PROVENANCE.md), [security](../SECURITY.md) and required notices for
dependency/package/artifact changes. Local validation does not authorize external
delivery. The npm package remains private. Tagging/publishing/releases require owner
authorization. Follow [releasing](RELEASING.md), attaching only archive/checksum from
a passing main workflow release-archive artifact. Green checks alone do not authorize release.
