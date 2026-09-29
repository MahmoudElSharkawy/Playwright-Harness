# Playwright POM Harness reference

This document describes the M1 baseline and the representative M2 skill work. Canonical
POM rules live in the skill library. It does not claim that the later provider-neutral
executors or host integrations already exist.

## Components

- Thirteen skills: twelve remain in `.claude/skills`; `element-locators` is maintained
  in `.agents/skills` with compatibility redirects at its previous locations.
- A Claude plugin manifest exposes the representative canonical skill. Native Codex
  discovery uses a consumer link to that same directory in the isolated M2 proof.
- Nine original Node scripts for convention checks, Claude hooks, ADO operations,
  metrics and tracker rendering, supplemented by M1 package-validation tooling.
- Optional synthetic TypeScript framework examples in `examples`.
- Empty review/prerequisite/knowledge templates and derive-only resource contracts.

## Existing lifecycle

Source retrieval → refinement → AgenTeX exploration → observation capture → POM
generation → independent review → scoped Playwright Test verification → delivery.
This is predominantly agent/skill orchestration, not an implemented neutral workflow
runtime. ADO and AgenTeX remain dependencies of the existing automate-suite path.
The convention skills can be used independently of that path.

Preserve source intent, independent review, bounded repairs and two scoped green runs.
API/DB services and utilities retain their responsibilities; tests orchestrate intent.

## Current boundaries and limitations

- Hooks are advisory, fail-open helpers, not a security boundary. Their command-text
  parsing does not enforce every shell spelling. CI and remote branch policies remain
  necessary. No historical live-hook certification is claimed by this package.
- The convention checker enforces a documented mechanical subset, not full TypeScript
  semantics. It reports the files and rule applications actually evaluated.
- API/DB utilities are examples, not the proposed future executors. Review their
  runtime logging, retry and connection policies before using them with real systems.
- Example specs require a deliberately configured application/database; listing or
  typechecking them is not evidence that browser/database execution passed.

## Convention checker

Use `node scripts/check-conventions.mjs --root examples` for this package and the
consumer framework root after adoption. `--files` takes paths relative to that root.
`--changed` accepts `--base-ref`; failure to resolve Git state and zero relevant
scope are errors, not passes. `--fail-on-warn` is used by the package gate.
Baseline entries require a team decision and may not hide introduced violations.

## Data and recovery

Runtime outputs and private source imports stay ignored. Public templates contain no
consumer data. Imported team resources are immutable; derive services/helpers or
catalog candidates without copying sample identities. Knowledge promotion is reviewed.
Cleanup follows scenario intent and ownership; intentionally persistent outcomes may
remain. Before-state capture is only required for a defined restoration obligation.

## Runtime and installation

The validated package baseline is Node 24. Read the [adoption protocol](../README.md#for-ai-agents-adoption-protocol)
before installing into a fresh repository or an existing framework. Package maintenance
must not overwrite an adopter's framework or team customizations.

## M1, representative M2 proof and later work

M1 addresses privacy, provenance and truthful validation. M2 separates package,
consumer and run roots and tests one canonical skill through native host mechanisms.
The proof tooling is not a production adapter or execution context. It compares six
locator decisions and actual reference reads, not raw host artifact equality.
See [the proof guide](M2-SKILL-PROOF.md), [M2 validation](M2-VALIDATION.md),
[M1 validation](M1-VALIDATION.md) and [provenance](PROVENANCE.md).

Bulk migration remains gated on both hosts passing M2 and authorization for M3.
UI/API/DB executors and ADO restructuring remain later milestones.
