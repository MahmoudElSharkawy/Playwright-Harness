# Playwright POM Harness reference

M3 provides one canonical 13-skill library, thin native host packaging, safe consumer
adoption, local-source loading and explicit environment-profile configuration. It
does not implement the later browser/API/DB executors or full lifecycle parity.

M4 adds [a pinned official CLI viability spike](M4-PLAYWRIGHT-CLI.md) with synthetic
Windows/Linux fixtures. Browser mechanics remain native; no new command language,
shared execution contract or scenario executor is introduced.

M5 adds [shared execution contracts](M5-EXECUTION-CORE.md) as deterministic library
functions. They freeze effective M3 configuration, record typed values and effects,
decide capability/recovery policy and validate complete evidence-backed results.
They do not invoke a host, CLI, API or database, or schedule scenarios.

## Package and consumer responsibilities

Canonical skills, references, templates and scripts live in the immutable package.
Codex discovers consumer links to `.agents/skills`; Claude loads the same content
through `.claude-plugin/plugin.json`. Old `.claude/skills` files are redirects.
Resolve links before opening sibling references; never maintain host-specific rule
copies. The separate consumer owns app code, local sources, `.harness` configuration,
reviewed knowledge, candidates, reports and session state.

The adopter preflights conflicts and merges instructions/ignore rules. It preserves
custom code, host settings and imported team libraries. Recognized legacy instructions
can become redirects; mutable records migrate with source fingerprints and conflict
refusal. See [the adoption guide](M3-ADOPTION.md) and the
[required protocol](../README.md#for-ai-agents-adoption-protocol).

## Sources and workflow

The local loader validates neutral scenarios, steps, expectations and optional external
references without ADO configuration or network access. It records a source fingerprint
and reports counts with `executed: false`. Environment modes and separate targets are
validated configuration. M5 computes effective capability decisions from it;
operation dispatch remains unimplemented.

Legacy ADO retrieval → refinement → AgenTeX exploration → POM generation → independent
review → scoped verification → authorized delivery remains compatibility guidance.
The local route currently supports loading/refinement inputs; integrating execution,
generation, review and verification remains later work. Preserve source assertions,
three cumulative repair rounds and two independent scoped green runs. Sequential
execution remains the default; harness parallel dispatch stays deferred.

Knowledge observations enter candidates and require review/sanitization before
promotion. Active-run inputs do not silently change. Catalogs, deterministic helpers
and fixed inline parameterized definitions remain valid peer execution sources for
later integration. Cleanup follows intent/ownership; before-state capture is conditional,
and intentionally persistent outcomes may remain.

## Existing tools and limits

- The convention checker enforces a mechanical subset of POM conventions. Use the
  installed script with `--root <consumer>`; file/rule counts must be nonzero.
  Unresolved Git bases and empty scope fail. Never expand baselines to hide violations.
- Tracker rendering and metrics read consumer state. Templates remain in the package;
  a rendered empty report is not substantive validation coverage.
- Optional Claude hooks use payload `cwd` (or the consumer working directory) and store
  session records under consumer `.harness/state/hooks`. Adoption does not enable hooks
  or copy broad host permissions. These helpers remain advisory and fail open.
- Legacy ADO scripts select a consumer root, keep their existing configuration/workflow,
  and require explicit authorization for external writes. They are not neutral adapters.
- API/DB utilities in `examples` remain examples. Typechecking and test listing do not
  prove browser/database execution against a configured system.

## Validation and future milestones

Node 24 is the supported package runtime. M1 establishes sanitized, owner-cleared
source and truthful validation. M2 proved six representative locator decisions through
both native hosts with actual skill/reference reads, immutable package checks and
semantic comparison. M3 extends discovery to all 13 canonical skills and tests consumer
adoption and local-source behavior. Native proof is specific to the tested hosts and
platform; it is not full generation/review/verification parity.

See [M1 validation](M1-VALIDATION.md), [M2 validation](M2-VALIDATION.md),
[the proof guide](M2-SKILL-PROOF.md) and [provenance](PROVENANCE.md).
See [M4 validation](M4-VALIDATION.md) for the pinned CLI gate and its scope limits.
See [M5 validation](M5-VALIDATION.md) for the minimal core's actual checks. Executors
remain later milestones. Keep native CLI
invocation/reply interpretation behind a narrow version-specific boundary; the
harness layer owns identity, policy, evidence, ownership and cleanup. No second
browser command language or generic workflow engine is introduced.
Public delivery remains separately authorized and subject to unresolved historical
credential revocation/rotation remediation.
