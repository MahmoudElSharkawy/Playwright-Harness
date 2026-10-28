# Reference and review contract

Ticket #128 extends the existing requirements, design and publication records. It does
not introduce another acceptance workflow or dependency graph. Source snapshots and
previous approvals remain immutable; older captures are readable without inventing
missing link or review evidence.

## Implementation decisions

- Preserve hyperlink text and destinations as separate, sanitized source metadata.
  Discover explicit work-item references and verified relationships. Deduplicate
  destinations while retaining every occurrence. Ordinary numbers are not IDs.
- Keep retrieved rules in design evidence, mapped to selected-story inventory entries.
  Fetch direct references and explicitly selected supplemental items only, with a
  bounded visited set. Deeper unresolved dependencies remain visible. Relationships
  alone do not authorize neighboring scope or attachment downloads.
- Reuse the existing inventory acceptance workflow. Acceptance of a delegation does
  not itself accept unseen rules. An existing owner decision can bind referenced
  identities, revisions and content; reuse that binding while it remains current.
  Classification and retrieval alone never accept requirements.
- Required or unresolved delegated references affect only their mapped requirements
  and cases. Coverage and delivery check their resolution, acceptance and freshness.
  Unaffected partial delivery and uncertain-write reconciliation retain their current
  contracts. Relevant dependency changes require new review and approval.
- Retain independent review output through bounded consumer storage, with its actual
  host run reference and source/proposal binding. Validate retained bytes at delivery.
  Names and hashes prove neither semantic judgment nor independence by themselves.
- Compare exact prerequisites, test data and ordered action/expectation pairs across
  proposed and captured cases. Diagnostics request a reviewer decision; they never
  automatically alter IDs, published cases or coverage mappings.
- Reuse project settings and selected business context first. A small optional
  consumer conventions profile supplies only otherwise homeless agreed defaults.
  Missing, conflicting or stale conventions do not accept rules or add locale scope.
- Preserve all case fields, counts, complete tables and existing handoff routes.
  Review must identify actor, starting state, target, inputs, actions, observable
  outcomes and necessary cleanup without guessing business information.

## Proof and delivery

Add failing synthetic regressions before changed behavior. Exercise scoped source,
acceptance, review, state and ADO fixture suites; requirements/provenance and context
selection; package syntax, JSON, links, privacy, provenance, publication and skill-root
checks. Inspect generated postcode cases and ambiguous-step correction independently.
Round-trip approved content through local automation intake and ADO execution parsing,
including checks that detect omitted actions or expectations. No live ADO mutation or
application execution is authorized or necessary. Deliver one implementation PR.
