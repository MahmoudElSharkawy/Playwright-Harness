# M11 — Execution and host parity

M11 proves execution behavior through native hosts. It does not claim the complete
generation, independent review, verification, reporting and delivery workflow parity
scheduled for M15. Execution remains sequential. There is no new workflow engine,
browser command language, SQL translation or host-specific domain executor.

## Semantic comparison

[`host-parity.mjs`](../scripts/lib/host-parity.mjs) recreates each immutable run and
reassesses its observations through M5, including artifact integrity checks. A
saved verdict that differs from the validated records is rejected before comparison.

The comparison retains scenario selection, expectation intent, operation definitions
and sources, effective capabilities, policy decisions, reliable assertions, statuses,
stability, failure classes, every attempt, typed outputs and producer relationships,
effects, required lifecycle outcomes, intentional retention and evidence coverage.
Versions and attempt numbers remain meaningful. Reliable failures are never retried
to green, and reconciliation cannot supply missing response assertions.

Run/attempt/resource identities are mapped by their relationships. Generated scalar
values differ only through explicitly declared producer slots: every slot belonging
to one symbol must hold the same value. A business output with another producer is
not normalized merely because it happens to equal a generated ID. Retry producers
retain the invocation and attempt number. Business differences remain differences.

Timestamps, durations and artifact locations/hashes are excluded from equality;
each run still verifies its own artifacts. Only ephemeral loopback destination ports
are ignored. Remote destinations, URL paths, database/schema scopes, credential
references, limits, reviewed knowledge and stable definitions remain comparable.
Native diagnostic wording is not a verdict. Protected references remain opaque and
must use the same fixture identity; sensitive values are never read for comparison.

Empty, missing, duplicate or reordered proof scope fails. Two equal failed scenarios
may demonstrate parity; neither is relabeled PASS as a test result. The proof gate
and the scenario verdict are separate facts.

## Host hooks and permissions

[`host.mjs`](../scripts/hooks/host.mjs) translates native payloads to the existing
advisory convention guard. Claude Bash/PowerShell, Edit/Write and failure events
and Codex Bash, text-block responses and apply_patch paths have distinct mappings.
Unrecognized events do not claim an edit or command occurred. The legacy guard is
still fail-open and is not a security boundary or the source of runtime permission.

Configure optional hooks in the consumer, using absolute installed-package paths
at adoption time. Do not copy maintained hook implementations into each consumer
or overwrite existing host configuration. Adoption still enables no hooks by default.
The fixed probe builds only disposable consumer settings.

The native hosts have different permission systems. A hook denial does not establish
an equivalent sandbox. A post-tool hook cannot undo an executed effect. Runtime
capabilities still authorize normal configured CRUD without per-mutation harness
approval; native command approval and hook trust remain separate host controls.
See the official [Codex hook contract](https://learn.chatgpt.com/docs/hooks) and
[Claude hook reference](https://code.claude.com/docs/en/hooks).

The proof retains native SessionStart, pre-command denial, successful command,
file-edit and post-execution receipts. Pre/post receipts must pair in chronological
order by nonempty native tool identity in one session. An edit must have an actual
success/file-list mapping. Final agent prose is insufficient: the exact reviewed
command must complete successfully, and both its native output and post-hook
receipt must contain the digest and case count of the resulting manifest.

## Fixed native proof

Install the root dependency lock and the separate pinned M4 CLI lock, and provision
the matching browser cache. Docker, authenticated local Claude and Codex CLIs and
Node 24 are required. No authentication values are supplied on command lines or
copied into proof files. Database credentials are newly generated and exist only in
the owned fixture process environment and disposable containers.

```sh
npm run test:hosts
npm run probe:hosts -- prepare
node scripts/probes/hosts.mjs run <state-file> claude <claude-executable> <available-model>
node scripts/probes/hosts.mjs run <state-file> codex <codex-executable>
node scripts/probes/hosts.mjs assess <state-file>
```

Use the returned private state path. Each host has its own consumer and fresh
database instances. Public package content is copied separately from protected
receipts, so a native sandbox can read installed code. Every installed file, including
the two dependency trees and controlled internal links, is inventoried before use.
Additions, removals, redirected links and changed bytes fail integrity checks after
execution and again during assessment. Consumer records must refer back to
that exact consumer/package/run scope. No run overwrites an earlier attempt.

Codex requires native trust for the three proof hooks. Review and trust them through
its native interface. A person-authorized invocation may instead use the documented
one-run hook-trust option, exposed by the proof as `--reviewed-hooks`. This option
does not bypass command approval or sandbox permissions. Never enable it implicitly.
On Windows the fixed browser command requests normal automatic approval review for
signed-in-user access to protected browser binaries and process ownership. Refusal
or unavailable native prerequisites leave the proof incomplete.

The 19 cases include API temporary fixtures, retention, no-obligation writes,
conditional restoration/conflicts, assertion failures, required cleanup failures,
partial setup, safe read recovery, uncertain/reconciled mutations, missing required
responses, capability/target refusal, native DML on both databases, and native
browser success/assertion failure. A mixed case shares generated identity bindings
across SQL setup, a native browser edit, API verification and required SQL cleanup.
Catalogs, helpers, inline definitions and dynamic
exploration remain peers. The same callbacks and official Playwright CLI mechanics
run under both hosts. The temporary synthetic application is torn down after
retention has been verified; its teardown does not invent a scenario cleanup duty.

Private evidence stays outside publication. Owned process and database cleanup
must complete. An ownership-inspection failure remains a failed proof even if the
directly spawned host is stopped; an empty process tree cannot establish cleanup.
Native runs on other operating systems, other host versions, and the
full workflow are not inferred from local Windows evidence.
