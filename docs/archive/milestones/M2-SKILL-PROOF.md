> Historical record. Read the [current documentation](../../contributing.md) for present behavior. Statements and validation results below describe their original implementation period.

# M2 representative skill proof

This experiment covers only `element-locators`. It does not implement host adapters,
browser mechanics, an execution core or bulk migration. See [actual results](M2-VALIDATION.md).

## One maintained source

The canonical [skill](../../../.agents/skills/element-locators/SKILL.md) and
[playbook](../../../.agents/skills/element-locators/references/playbook.md) live in `.agents/skills`.
The old Claude paths redirect there. The manifest's `skills` directory is
`./.agents/skills/`, using the native [Claude plugin mechanism](https://code.claude.com/docs/en/plugins-reference).
No host-specific copy of the locator rules is maintained.

Native [Codex discovery](https://learn.chatgpt.com/docs/build-skills) follows a link
from a separate consumer's `.agents/skills/element-locators` to the package skill.
The proof asks the native [app server](https://learn.chatgpt.com/docs/app-server) for
`skills/list` and requires exactly one enabled match resolving to the canonical file.
The tested Codex build reports the manifest-qualified name
`playwright-pom-harness:element-locators`; the runner uses the name actually discovered.

## Roots and ownership

`resolveSkillRoots` requires explicit absolute package, project and run roots at
runtime. The package and project are distinct. The run root is strictly inside the
consumer and outside package storage, including when the package itself is installed
under a consumer dependency directory. Links are resolved before checking containment.
Existing consumer skills are preserved; a conflicting target is an error.

`prepare` creates an isolated package snapshot and a separate consumer with its own
Git boundary. The consumer has synthetic cases and a discovery link; host evidence
and proof state stay under its `.harness/runs/locator-proof`. Every package file is
hashed before execution and checked afterward. Generated proof snapshots are ignored
test artifacts, not maintained host copies. They include no recovery archives or secrets.
This detects package changes; it is not a filesystem access-control implementation.

## Repeating the focused proof

Use Node 24 and authenticated native Codex and Claude Code executables. Each run defaults
to the host's configured model. Claude can receive an explicit model identifier as the
fourth argument after `claude`, the state file and executable. Select it from the
configured service's available models; aliases can resolve differently across CLI
versions. The override is recorded with the attempt and does not modify host settings. On Windows,
pass the native Claude executable rather than an npm command shim.

From the package directory, in PowerShell:

```powershell
node scripts/prove-skill.mjs prepare
# Use the stateFile printed by prepare as $state.
node scripts/prove-skill.mjs discover $state
node scripts/prove-skill.mjs codex $state
node scripts/prove-skill.mjs claude $state $claudeExecutable
# Optional: append an explicit supported model identifier to the Claude command.
node scripts/prove-skill.mjs assess $state
```

Run both hosts against the same prepared state. A repeat attempt needs a fresh
`prepare`; the runner refuses to overwrite host attempt evidence. Authentication
setup belongs to each native host. Do not put credentials in arguments, fixtures or
proof state. The Windows Codex invocation retains read-only filesystem policy and
explicitly configures the elevated Windows sandbox. Claude permits only Read, Glob,
Grep and Skill tools, disables hooks, ignores project/local settings and external MCP
configuration, and denies requests that would need a permission prompt. User settings
remain available for normal authentication. The proof does not require a browser or
access to application, API or database targets.

The isolated Claude test installation used version `2.1.285`; it is development
tooling, not a bundled package dependency. Use your normal authenticated host or an
isolated official installation. Native plugin validation is available with
`claude plugin validate .`; successful validation alone does not prove skill execution.

## Acceptance evidence

The six synthetic cases cover id/name/test-attribute priority, a dynamic card locator,
a collection and a raw file input. Each host must return all six exactly once, apply
the expected rules, preserve private encapsulation, avoid positional indexing and use
the correct element suffix. Required references and the fixture must appear in
successful native tool reads with their actual contents. A model's list of files it
claims to have read is insufficient.

Codex must discover the canonical skill. Claude must load the intended plugin and its
namespaced skill through its actual plugin loader. Both must explicitly read the
canonical `SKILL.md`, even if the host has already expanded it. Registration plus
reference reads alone cannot prove canonical skill consumption. Both must complete
successfully and leave the package unchanged. The assessor fails closed on invalid or
missing evidence, failed process/turn results, timeouts, missing cases and package drift.

Semantic comparison includes case identity, chosen strategy, encapsulation and index
usage. Each host separately validates names and evidence. Equivalent field names and
rationales may differ; execution identifiers, timestamps, filenames and durations do
not establish disagreement. This is six-case instruction parity, not browser behavior,
full execution parity or the later generation/review/verification lifecycle proof.

Unit tests cover root containment and false-pass prevention using synthetic tool
events. They are not substitutes for native authenticated host runs. The proof is
currently evaluated on Windows only; Linux host behavior remains unperformed.

## M3 library extension

Use `prepare-library` instead of `prepare` to exercise the M3 adopter in the isolated
consumer and require native discovery of every canonical skill on both hosts. The
remaining commands are unchanged. The six-case behavioral assessment stays focused
on element-locators; full-library discovery is not behavioral coverage of all skills.
Current references resolve to canonical `.agents/skills` siblings. Historical M2
results remain recorded against their original package snapshot.
