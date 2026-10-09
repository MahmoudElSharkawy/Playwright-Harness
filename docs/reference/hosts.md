# Hosts, discovery and parity

Claude Code and Codex use one maintained convention library and the same deterministic
runtimes. Native packaging, discovery and hooks adapt interfaces without forking
POM rules or domain execution. See [architecture](../architecture.md) and
[getting started](../getting-started.md) for ownership and adoption.

## Canonical skills and roots

Package `.agents/skills/` is canonical. Claude metadata points to it; consumer
`.claude/skills/` and `.agents/skills/` link to the same content. Resolve links before
following relative references. Use the name actually discovered by the host; Codex
may report a qualified name such as `playwright-pom-harness:element-locators`.

`resolveSkillRoots({packageRoot, projectRoot, runRoot})` in `scripts/lib/skill-roots.mjs`
requires explicit absolute roots. Consumer run storage stays outside immutable package
content, even when installed within node_modules. Resolved links must preserve
containment. Custom skills/instructions/settings are preserved; conflicts require
review. Mutable sources, knowledge and evidence belong to the consumer.
See [ROOTS.md](../../.agents/skills/ROOTS.md).

Discovery alone is not behavioral proof. A host must actually load/read the canonical
skill and references, execute the requested task and leave package content unchanged.
Final prose claiming reads does not replace successful native receipts with contents.

## Optional Graphify evaluation

A consumer project may evaluate standalone Graphify for cross-file relationship
questions that remain costly with focused source search. Compare the same real tasks:
find a business method to reuse, identify callers affected by a change, and trace a
test through its business methods to utilities. Check source references, missed
relationships, setup effort and graph refresh effort.

For an evaluation, follow the
[official setup guidance](https://github.com/Graphify-Labs/graphify#install), selecting
project-scoped registration and reviewing its instruction and hook changes. Verify
graph results against current files. Generated indexes are not approved knowledge;
review and sanitization are required before promoting any facts. POM conventions and
review/execution gates continue to apply.

Graphify's absence never affects harness installation or readiness. Harness setup
does not install Graphify or configure an adapter or hooks for it.

## Optional hooks and permissions

[host.mjs](../../scripts/hooks/host.mjs) translates native events into the advisory
guard. Claude shell/edit/failure events differ from Codex command/text/apply_patch
payloads; unknown events claim no action. Configure only requested hooks in the
consumer using installed paths while preserving settings. Setup enables none.

The guard is advisory and fail-open, not an execution-policy security boundary.
Codex pre-command denial uses structured `permissionDecision: "deny"` at exit 0;
Claude uses its native exit-2 denial. Proof must show the denied command did not run.
Post-tool hooks cannot undo effects. Sandboxing, approval and trust remain host-native;
equal harness capabilities do not make host controls equivalent.

Permitted ordinary CRUD needs no repeated harness prompt; host controls still apply.
Codex proof hooks need native trust. Use `--reviewed-hooks` only for a person-authorized
one-run proof after review, or trust hooks in the native interface. This does not bypass
approval/sandboxing. See official [Codex hooks](https://learn.chatgpt.com/docs/hooks)
and [Claude hooks](https://code.claude.com/docs/en/hooks).

## Semantic parity

[host-parity.mjs](../../scripts/lib/host-parity.mjs) reconstructs frozen inputs and
reassesses evidence. Saved verdicts disagreeing with validated records are rejected.
Comparison retains scenario intent, definition/source versions, capabilities, policy,
assertions, outcomes/stability, failure classes, attempts, output producers, effects,
lifecycle and required evidence. IDs normalize by relationships; generated values
normalize only through declared producer slots. Equal business numbers do not
automatically become equivalent generated IDs.

Timestamps/durations and evidence paths/hashes are excluded from semantic equality;
each run verifies its own files. Only ephemeral loopback ports normalize. Remote
destinations, database/schema scope, credential references, limits, knowledge and
stable definitions remain comparable. Protected values stay opaque. Missing, empty,
duplicate or reordered scope fails. Equivalent controlled failures can prove parity
while remaining failed test results.

## Native proofs

Development proofs need Node 24 and authenticated native host executables. Sign-in
stays with the hosts, never arguments, fixtures or public receipts. Use the host's
configured model unless explicitly selecting a supported model. Windows Claude proofs
use its native executable rather than an npm shim.

```powershell
node scripts/prove-skill.mjs prepare-library
# Use the returned private stateFile as $state.
node scripts/prove-skill.mjs discover $state
node scripts/prove-skill.mjs codex $state
node scripts/prove-skill.mjs claude $state $claudeExecutable
node scripts/prove-skill.mjs assess $state
```

`prepare` is locator-only; `prepare-library` requires full discovery while behavioral
scope remains six representative locator cases. Both hosts use one prepared state;
new attempts require fresh preparation. Plugin validation checks packaging, not behavior.
Unit `test:roots`/`test:skill-proof` checks do not replace authenticated native proof.

Execution `probe:hosts` additionally needs Docker, locked dependencies, pinned browser
and disposable databases. Separate consumer workspaces and exact installed-file/link
inventories are checked before and after. Native startup, chronological paired commands,
edits and harmless denial must agree in one session with actual resulting digest/count.
Drift, refusals and unavailable prerequisites fail, not pass. Owned cleanup is mandatory.

The fixture covers API, both databases, browser, effects/retention, partial setup,
assertion/cleanup failures, recovery, uncertain mutations, missing responses, capability
refusal and restoration conflicts. Full generation/review/two-run workflow proof is
separate. Commands and platform prerequisites live in [contributing](../contributing.md).
Archived [skill proof](../archive/milestones/M2-SKILL-PROOF.md) and
[host parity](../archive/milestones/M11-HOST-PARITY.md) retain exact reproduction;
their validation records identify tested host/platform versions rather than claiming
universal parity.
