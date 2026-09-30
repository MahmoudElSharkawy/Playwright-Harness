# Sequential API runtime

M7 exposes `defineApiOperation` and `createApiRuntime` from
[`scripts/lib/api/index.mjs`](../scripts/lib/api/index.mjs). Services/helpers and
either host import the same deterministic library. It needs Node 24, explicit
consumer roots and M5 run inputs; it does not load an AI host, AgenTeX, Playwright,
Allure or a catalog service. The existing example facade remains a compatibility
example; generation and reporting integration are later milestones.

## Define, freeze, execute

This example assumes `environment` was loaded from the consumer configuration and
`roots` contains absolute package, consumer-project and fresh consumer-run locations.
Imports below are relative to a caller beside the installed package. A normal service
method can delegate to `runtime.execute` with the same definition and typed bindings.

```js
import {createRun} from '../playwright-pom-harness/scripts/lib/execution-core/index.mjs';
import {defineApiOperation, createApiRuntime} from '../playwright-pom-harness/scripts/lib/api/index.mjs';

const find = defineApiOperation({
  id: 'find-record', target: 'qa-api',
  source: {kind: 'helper', reference: 'record-service', version: '1.0.0'},
  request: {method: 'GET', path: '/records'},
  effects: {readOnlyContract: 'record-list-is-read-only'},
  checks: [{id: 'status', select: {from: 'status', path: []}, equals: 200}],
  extract: [{name: 'count', type: 'number', sensitivity: 'public',
    select: {from: 'json', path: ['count']}}]
});
const run = createRun({environment, operations: [find], scenarios: [{
  id: 'case', expectations: [{id: 'status', description: 'Record lookup succeeds',
    operationId: find.id, invocationId: 'find-call', requiredEvidence: ['response', 'assertion']}]
}]});
const api = createApiRuntime(run, roots);
const attempt = await api.execute({operation: find, invocationId: 'find-call'});
api.selectOutput(attempt, 'count');
const result = api.finish();
```

Stable `catalog`, `helper` and `inline` definitions are frozen in `createRun`.
`exploration` definitions are created at runtime and recorded with a fingerprint;
they are not inserted into the active catalog. Enabled exploration can dynamically
construct GET, POST, PUT, PATCH and DELETE definitions without catalog registration.
Reusing a run-local operation ID with different content is refused.

The environment profile, destinations, credential-reference identities, definitions,
expectations and typed initial values remain immutable during the run. A reviewed
catalog operation cannot exceed its target/capabilities. `test` enables ordinary CRUD;
`protected` needs explicitly configured mutations; `custom` uses configured capabilities.
No environment-name inference or per-mutation approval is introduced.
Only GET definitions with an explicit read-only contract use `apiReads`. A declared
GET mutation, or GET without established read-only semantics, requires `apiMutations`.

## Requests, assertions and outputs

`request` contains `method`, target-relative `path`, optional scalar `query`, optional
allowlisted `headers`, and optional JSON `json` body. `{recordId}` in paths binds and
encodes an input. `{$input: 'recordId'}` in query/body/header/expected-value definitions
binds a typed value structurally. Inputs must come from frozen run values or earlier
outputs, with their producer identities intact. Renaming a binding preserves provenance.
Sensitive wire-field names such as `password` accept only reference templates backed
by sensitive typed inputs. The shared JSON validator permits that exact plain-data
reference shape while continuing to reject literal secrets and accessor-bearing slots.
Concrete sensitive inputs are copied into a bounded invocation-local memory snapshot
once; every retry uses that snapshot, even if protected storage changes later.

Destinations must stay inside both the configured origin and base-path prefix. Absolute
URLs, path traversal and ambiguous encoded separators are refused before credentials
are resolved. Redirects are never followed, even to another configured destination.
Requests have no implicit retry, cookie jar or proxy inheritance. Each native request
owns and closes its socket; HTTPS retains Node's normal certificate verification.

Checks compare exact typed values from status, JSON paths, text or headers. They must
match the invocation's frozen expectation IDs. Non-2xx responses are ordinary observed
responses and may satisfy expectations. Reliable failures are permanent and never
retried to green. Missing JSON fields are distinct from null. Extracted outputs declare
their type and sensitivity; a missing or mistyped required extraction cannot pass.

Supported request headers are `accept`, `content-type`, `if-match`, `if-none-match`
and `idempotency-key`. Credentials use the separate resolver. V1 supports bounded JSON
requests and buffered text/JSON responses; multipart uploads, streaming, automatic
decompression, custom TLS configuration and automatic redirects are not implemented.

## Credentials and evidence

Targets name an `env:` credential reference. The default resolver reads that variable
as a bearer credential. A custom `resolveCredential({reference, target, destination,
refresh, signal})` can return credential headers: `authorization`, `x-api-key`,
`api-key`, `x-auth-token` or `cookie`. Resolution/cache scope is the selected target;
returned header objects are copied. A refresh does not change the frozen reference.
V1 authorization schemes are Bearer and Basic; API-key and cookie headers are also
supported. Cookie values and decoded Basic credential components are screened, and
explicitly sensitive response selectors are classified before any assertion is saved.
Confidentiality applies to overlapping JSON ancestors/descendants and whole-body text
views; header matching is case-insensitive. A text view also receives recursive JSON
field screening when the response is JSON. It cannot bypass sensitive-field checks.

Credentials and unrestricted request/response payloads remain in memory. Saved response evidence
contains status and bounded transport metadata. Assertion evidence contains comparison
facts with sensitive fields and known credential values removed. Selected public
outputs are explicit, typed and screened; callers remain responsible for classifying
domain-sensitive values correctly. Diagnostics omit native errors, URLs and payloads.

Sensitive values require `resolveSensitive(ref, {signal})` and/or
`storeSensitive(value, {identity, name, signal})`. The storage callback returns an
opaque `protected:` reference; it must implement appropriate protected storage in the
consumer. The runtime provides no plaintext sensitive-value file store. Callbacks
must cooperate with cancellation. Async results after expiry cannot dispatch or enter
records; synchronous JavaScript needs host process limits.

Artifacts live under the fresh consumer `runRoot/evidence`; `finish()` validates their
actual sizes/hashes and associations through M5 before writing `observations.json`
and `result.json`. It refuses missing required scope or altered evidence. Package
storage is never used for runtime output. This is validated result persistence;
reporters and Allure integration remain later work.

## Effects and recovery

`effects.readOnlyContract` declares a known non-mutating GET endpoint. A GET verb alone
does not establish replay safety. Mutations normally declare `confirmedStatuses`,
`noEffectStatuses` and their `contractRef`. These are endpoint behavior contracts that
the definition's author must establish; a status number alone proves no universal
mutation behavior. An unclassified response or a lost transmitted mutation is uncertain.

Finite automatic retries default on and use the frozen M5 attempt limit. They apply
to transient transport/timeout failures and contracted authentication rejection only.
An unavailable connection before dispatch is `not-executed`. Once connected, a lost
mutation is conservatively uncertain. Invalid definitions, data/type errors and
reliable assertion failures are not retried. `retry: false` disables replay.

Optional definition contracts:

- `recovery.authentication: {statuses: [401], contractRef: 'auth-before-write'}`
  requires those statuses in `effects.noEffectStatuses`. A rejected attempt is
  retained, the credential is refreshed, and retry stays within the same budget.
  A 401 without this contract is evaluated normally and never silently replayed.
- `recovery.reconcile` contains a GET `request`, `readOnlyContract`, required `status`,
  a `select`/`equals` comparison and `whenEqual` (`confirmed-no-effect` or
  `confirmed-effect`). The probe goes through the same target, credential, timeout
  and size controls and requires read capability. Failure/mismatch is inconclusive.
- `recovery.idempotency: {contractRef: 'server-deduplication', input: 'requestKey'}`
  binds a stable key through the endpoint's supported `idempotency-key` mechanism.
  Merely adding a header does not enable replay. This v1 mechanism must match the
  server contract; unsupported idempotency schemes need an explicit future extension.

Only confirmed no-effect reconciliation or a supported idempotency contract permits
replaying an uncertain mutation. Confirmed effects are not replayed. Reconciliation
does not synthesize missing response assertions: finding a created record cannot
prove its lost response status. Unresolved effects give `NEEDS_REVIEW`; missing
required observations remain incomplete. A safely recovered run can be `PASS` with
`stability: recovered`, with every attempt and recovery proof intact.

## Scenario sequencing and lifecycle

M7 handles one sequential API scenario per runtime. Call `execute` with `phase`
(`SETUP`, `EXERCISE`, `VERIFY`, `CLEANUP` or `RESTORE`) in order. Concurrent calls and
late reuse are rejected. The caller sequences business work and uses `finally` for
required cleanup; this library is not a workflow engine. Run and cleanup deadlines
are finite; cleanup has a shared separate budget and can run after ordinary cancellation.

An optional invocation `resource` names `{id, output, ownership, intent}`. The output
supplies its identity; `ownership` is `harness` or `existing`; intent is `temporary`,
`restore`, `persistent` or `no-obligation`. Persistent/no-obligation effects have no
invented cleanup requirement. Writes without a tracked resource still record effect
certainty. Before-state capture is never automatic. Add `beforeStateRef` only when
the scenario needs protected restoration data.

Temporary fixtures normally receive a later invocation with
`lifecycle: {resourceId}` in `CLEANUP`, binding the original identity output. Restoration
uses `RESTORE`, `lifecycle: {resourceId, guard: 'version'}` and a concrete strong
`if-match` version; wildcards are refused. The endpoint must actually honor conditional
updates. Completion requires a successful observed confirmed effect. A no-effect
rejection does not complete cleanup/restoration, even if that response was expected.
Version conflicts remain visible without overwriting concurrent changes. Failed or
pending required obligations prevent a clean pass and never erase an established FAIL.

## Verification

`npm run test:api` executes real loopback HTTP fixtures and contract checks, including
CRUD, source equivalence, ordinary tester autonomy, target rejection, credential
refresh, safe and unsafe replay, redaction, output types, lifecycle and deadlines.
These fixtures use synthetic data and credentials generated in memory. They do not
claim live external-service authentication, database integration, host parity or
end-to-end generated POM validation. See [the validation record](M7-VALIDATION.md).
