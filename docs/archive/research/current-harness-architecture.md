> Historical record. Read the [current documentation](../../architecture.md) for present behavior. Statements and validation results below describe their original implementation period.

# Current harness architecture: sanitized research baseline

The input package contained 79 files, 13 skills, nine MJS scripts and 18 TypeScript
examples. Before M1, one checker draft and two research documents had been added.
The recovery/accounting record is private and excluded from publication.

## Responsibilities

| Component | Current responsibility | Later boundary |
|---|---|---|
| Convention skills | POM architecture and layer-specific rules | Shared canonical instructions |
| Automation skill | Agent-led refinement, exploration, generation and verification | Shared lifecycle policy |
| Claude instructions/hooks | Discovery and advisory workflow feedback | Thin host adapter |
| ADO scripts | Retrieval, result/work-item updates and delivery | Optional integration adapters |
| Example utilities | HTTP, SQL Server, assertions and technical helpers | Preserve sound reusable behavior |
| Tracker/knowledge | Consumer progress and application observations | Consumer-owned reviewed state |

Current exploration depends on AgenTeX. Generated regression uses Playwright Test.
Several scripts derive consumer paths from installation paths. Mutable tracking state
resides beneath skills. These are documented migration seams, not M1 refactoring work.

## Preserved doctrine

Strict POM responsibilities; no base classes; reuse before creation; source-intent
preservation; independent review; bounded repair; two scoped green runs; no weakened
assertions; deliberate delivery. Services/helpers and inline parameterized operations
remain valid automation sources; catalogs are reusable assets rather than permissions.

## Research limits

Original checks established syntax and selected self-test behavior, not host parity
or complete execution support. Original examples produced 11 convention warnings.
Original zero-scope checks could incorrectly succeed. M1 results supersede those
baseline observations in [the validation record](../milestones/M1-VALIDATION.md).

No private application names, incidents, endpoints, credentials or machine paths are
needed to explain these findings. See [the current reference](../milestones/HARNESS.md).
