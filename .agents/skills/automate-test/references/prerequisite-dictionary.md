# Consumer prerequisite knowledge

Read `<projectRoot>/.harness/knowledge/prerequisites.md`, created from the immutable
[template](../assets/prerequisite-dictionary-template.md). Record reviewed facts in
that consumer file, never here. Place observations awaiting review under the consumer's
`.harness/knowledge-candidates` directory. Cleanup/restoration follows scenario intent
and ownership; intentional persistence is valid and before-state capture is conditional.

For API routes, reuse framework business methods first, applicable supplied collections
second, and reviewed, configured-runtime-verified discoveries for missing operations.
Follow [observed API knowledge](../../../../docs/reference/api.md#observed-api-knowledge);
neither a collection nor its serialization is a prerequisite. Record the reviewed
definition and provenance, required inputs, authentication, effects and supported
cleanup/restoration. A create observation does not establish a delete endpoint.

Keep API/DB preparation where suitable lower-layer paths exist, shared preconditions
in `beforeEach`, and case-owned data at the start of its case. Preserve the source's
GUI journey and UI checks. Discovery needed before the first seed uses only permitted
setup/exploration paths; without a usable route or fixture, retain the prerequisite
gap. Never seed business data in global setup or use captured values as test data.
