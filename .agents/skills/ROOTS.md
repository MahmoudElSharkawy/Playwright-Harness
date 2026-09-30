# Package and consumer boundaries

The installed package contains immutable canonical skills, references, templates and
scripts. Resolve a linked skill to its real path before following relative references.
The current working consumer project owns its application code, configuration, sources
and mutable state. Never derive consumer paths from a skill's installation directory.

| Consumer path | Purpose |
|---|---|
| `.harness/project.json` | Deliberately selected environment profiles and target references |
| `.harness/targets.json` | Destinations and secret references; no secret values |
| `.harness/sources/` | Versioned local scenario specifications |
| `.harness/state/review/class-ledger.md` | Consumer review finding history |
| `.harness/state/tracker/` | Consumer plan registries and append-only history |
| `.harness/knowledge/prerequisites.md` | Reviewed prerequisite facts |
| `.harness/knowledge/ui/` | Reviewed UI facts |
| `.harness/knowledge-candidates/` | Unreviewed observations, separate from reviewed knowledge |
| `.harness/runs/` | Consumer run outputs and evidence |

Initialize or merge with the [adoption command](../../scripts/adopt-project.mjs),
following the [M3 guide](../../docs/M3-ADOPTION.md). Existing consumer instructions,
framework code, settings and imported team libraries must be preserved. A customized
skill requires a reviewed merge; do not replace it with a package link silently.
Templates in skill assets are starting points, never live state. Knowledge promotion
requires review and sanitization; observations do not silently update reviewed facts.

Reuse the ongoing feature branch and add commits; do not create a branch per milestone.
External delivery still requires authorization. Host permissions remain host-specific.
Configured environment profiles do not bypass host controls. M3 loads and validates
configuration and local sources; it does not execute browser, API or database operations.

Legacy command examples using `node scripts/...` refer to the installed package
script, not a consumer copy. Invoke `node <packageRoot>/scripts/<name>.mjs` from
the consumer. State tools accept `--project-root <consumer>`; the convention checker
uses `--root <consumer>`. Playwright test commands and framework paths refer to the
consumer. Adoption does not copy scripts or enable hooks automatically.
