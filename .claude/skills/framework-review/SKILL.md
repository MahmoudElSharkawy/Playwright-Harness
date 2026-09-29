---
name: framework-review
description: Use to review framework changes against the skill-library conventions and produce a verdict — "review this diff/MR against the conventions", "run framework review", the exit gate of automate-suite GENERATE, or any pre-commit conventions check. Runs the mechanical linter, classifies the diff by layer, walks design-conventions §6 with the owning playbook checklists, and emits a findings matrix with an APPROVE / CHANGES verdict. Convention-focused — for bug-hunting use the generic code-review instead.
---

# Framework Review (Conventions Verdict)

Turns the design-conventions §6 merged checklist into a runnable review with a
machine-usable verdict. Two iron rules borrowed from the adversarial-review contract:

1. **The reviewer is never the author.** When this skill gates work you produced in
   the same session, dispatch a fresh subagent (general-purpose) with the procedure
   file and the diff scope — prompted to REFUTE the work, not approve it. A
   self-review is a smoke test, not a review; label it as such in the verdict.
2. **A finding that cannot name its evidence is not a finding.** Every finding
   carries `file:line`, the violated rule's source (skill + section), and a concrete
   fix route. Unproven suspicions are listed separately as questions, never as
   findings — and an empty findings list is a valid, complete result.

Follow [references/procedure.md](references/procedure.md) step by step. Findings use
the fixed block format defined there; each finding also carries a `class` slug, and
[class-ledger.md](class-ledger.md) accumulates classes across reviews — **when a
class reaches three entries, propose a rule for `scripts/check-conventions.mjs`**
(or record why it cannot be mechanised). That is how reviews teach the enforcement
layer instead of repeating themselves.

## Boundaries

- Bug hunting (logic errors, race conditions) → the generic `code-review` skill.
- Fixing a failed box → the owning specialist skill (the procedure maps every §6 box
  to its owner); this skill never restates their content.
- The three open team decisions (`getBy*` stance, test-title grammar, raw-context
  retention) are flagged as OPEN-DECISION notes when touched, never as findings.
