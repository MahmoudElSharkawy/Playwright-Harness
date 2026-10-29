# Schema-backed DB query discovery (#134)

## Scope and decisions

Add the DB counterpart of observed API knowledge, using the existing database
operation schema, configured runtime, consumer paths and evidence verifier.
Initial discovery supports SQL Server ordinary tables and exact-key SELECT
lookups/verification. Existing PostgreSQL/MySQL execution remains available;
automatic discovery for those engines and generated MySQL services are unsupported.
This keeps discovery aligned with the established SQL Server `DBActions` service
path. No mutation recipes, SQL interception, new drivers or permissions are added.

The alternative was a general SQL generator across all three engines. It adds
dialect and generation claims beyond the first useful supported path. Instead,
derive one explicitly selected table's columns with a complete verified unique
key and typed bindings; inspect bounded keys/relationships but report joins,
unsupported types and ambiguous semantics as gaps. Review must establish tenant,
soft-delete and status semantics from source evidence; metadata cannot do that.

## Runtime and knowledge contract

1. Reuse business methods, supplied queries and current reviewed discoveries first.
   Missing query files do not block permitted exploration. API preparation and
   required GUI journeys retain their existing precedence.
2. The database runtime exposes bounded schema inspection, gated by the selected
   target, `dbSelect` and `dbExploration`. Unknown names use a bounded literal
   table-name hint in the configured schema before inspecting matched tables.
   Fixed metadata requests use the existing
   driver and its principal preflight, deadlines, cancellation and result limits.
   No caller-authored metadata SQL or row samples are accepted. Evidence binds
   the selected scenario, run, target fingerprint, engine and configured schema.
3. A query candidate is derived from that evidence and source-grounded intent.
   It contains parameterized SELECT SQL, explicit outputs and typed parameters,
   never current input/expected values or result rows. Checks use input slots.
   Candidates are immutable under `.harness/knowledge-candidates/db/records/`.
4. Review binds the exact operation, purpose, schema, inputs, extraction and
   business semantics to a retained review artifact. Promotion also requires a
   passing configured-runtime execution with source-grounded checks and complete
   required lifecycle. The authoritative record is immutable under
   `.harness/knowledge/db/records/`; Markdown is derived documentation only.
5. Reuse requires intact original metadata/review/verification evidence, the same
   configured target and a fresh matching relevant schema observation. A changed
   contract or schema fails visibly; prior records are retained.
6. Promotion writes `resources/Queries/<application>-discovered.md` atomically
   under an exclusive lock, validates existing ownership/integrity, deduplicates
   equivalent definitions, retains variants and rejects same-identity conflicts.
   Supplied exports are never changed. Interrupted locks require explicit recovery;
   they never justify overwriting an active writer or a valid document.

## Workflow integration

Both skills perform discovery during source refinement/exploration, before manual
execution or generation freezes its inputs. Discovery cannot mutate a frozen
manual step. A later missing operation returns to refinement. Standalone execution
may save knowledge but emits no POM code. Automation derives ordinary business
services and preserves independent review and two fresh scoped green runs.
Reports summarize discovery independently of case verdicts and readiness.
Current query selections retain fresh-schema receipts in reporting state; a prior
review or same operation name cannot label a new candidate or later run as trusted.

## Acceptance and proof

Regression tests cover capability/scope denial, unsupported engines/types,
schema/key ambiguity, typed binding, sanitization, review/evidence integrity,
schema drift, deduplication, conflicts, supplied-file preservation and atomic
concurrent/interrupted promotion. Native proof uses an external disposable SQL
Server consumer without supplied queries, source-defined expectations, new
per-run identities, reviewed promotion and fresh-invocation reuse. Its supported
generated service retains UI checks and cleanup, independent review and two
scoped runs. Run the fixed package checklist and report actual platform coverage
and any unperformed native gates without substituting mocks for live evidence.
