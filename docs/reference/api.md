# API runtime

`defineApiOperation` and `createApiRuntime` provide deterministic Node HTTP(S)
execution with shared [records and assessment](execution-model.md). They require
no AI host, browser, Allure or catalog service. Put POM business operations in
`src/apis/` and technical transport/reporting in `src/utils/`; follow the
[service-class skill](../../.agents/skills/service-classes/SKILL.md) and source
endpoints from the consumer's team collections first.

## Define, freeze and execute

The caller supplies a validated effective environment and separate absolute package,
project and fresh run roots. A read definition and its observation scope look like:

```js
import {createRun} from 'playwright-pom-harness/scripts/lib/execution-core/index.mjs';
import {defineApiOperation, createApiRuntime} from 'playwright-pom-harness/scripts/lib/api/index.mjs';

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
    operationId: find.id, invocationId: 'find-call',
    requiredEvidence: ['response', 'assertion']}]
}]});
const api = createApiRuntime(run, roots);
const attempt = await api.execute({operation: find, invocationId: 'find-call'});
api.selectOutput(attempt, 'count');
const result = api.finish();
```

Freeze catalog/helper/inline definitions before execution. Enabled exploration may
construct GET/POST/PUT/PATCH/DELETE definitions run-locally; changed content under an
existing ID is refused. Destinations, credential references and expectations stay
immutable. Only GET with an established `readOnlyContract` uses `apiReads`; other
GETs need `apiMutations`. Target/catalog names grant no permission. See
[configuration](../configuration.md) for profile defaults and overrides.

## Request and binding contracts

Requests specify `method`, target-relative `path`, optional scalar `query`,
allowlisted `headers` and an optional `json` or `form` body. Path `{recordId}` binds/encodes an input;
`{$input: 'recordId'}` structurally binds query/body/header/expected values. Inputs
come from frozen values or earlier outputs with type, sensitivity and provenance
intact. Sensitive fields require sensitive input references, not literals. Concrete
sensitive values resolve once per invocation; retries reuse that bounded snapshot.

Destinations remain within configured origin/base-path prefix. Absolute URLs,
traversal and ambiguous encoded separators fail before credentials resolve.
Redirects, implicit cookie jars and proxy inheritance are absent. Each request
owns/closes its socket and verifies HTTPS certificates. Headers are `accept`,
`content-type`, `if-match`, `if-none-match` and `idempotency-key`; credential headers
come through a separate resolver.

Checks compare exact typed status/JSON/text/header values and match frozen expectation
IDs. Non-2xx responses can be expected. Missing differs from null. Required extraction
declares type/sensitivity; missing/mistyped output cannot pass. Reliable assertion
failures never retry to green. Transport uses bounded JSON/form requests and buffered
text/JSON responses, without multipart, streaming, automatic decompression or custom TLS.

### URL-encoded form bodies

Use `request.form` for `application/x-www-form-urlencoded` endpoints. The same
definition works in catalog, helper, inline and enabled exploration sources:

```js
const submit = defineApiOperation({
  id: 'submit-record', target: 'qa-api',
  source: {kind: 'inline', reference: 'record-service', version: '1.0.0'},
  request: {
    method: 'POST', path: '/records', query: {view: 'summary'},
    form: {label: {$input: 'label'}, count: 0, enabled: false, note: ''}
  },
  effects: {confirmedStatuses: [201], contractRef: 'record-create-contract'},
  checks: [{id: 'created', select: {from: 'status', path: []}, equals: 201}],
  extract: [{name: 'recordId', type: 'string', sensitivity: 'public',
    select: {from: 'json', path: ['id']}}]
});
```

Bind `label` through the invocation's existing typed `inputs`. A value `a b+c&d`
produces `label=a+b%2Bc%26d&count=0&enabled=false&note=`; `view=summary` stays in
the URL query. Values are decoded input: `%2F` is literal text and becomes `%252F`,
not a slash. Native `URLSearchParams` encodes field names and values as UTF-8,
spaces as `+`, literal `+` as `%2B`, and reserved characters with percent escapes.

The form must be a flat field object. Each value is a string, finite number,
boolean, or `{$input: 'name'}` resolving to one of those types. Numbers and booleans
convert explicitly to text; empty strings, zero and false are retained. An empty
`form: {}` sends a zero-byte body with the form Content-Type and Content-Length 0.
Omitting both body fields leaves the body absent. JSON definitions need no migration.

`json` and `form` are mutually exclusive. GET bodies remain unsupported; POST,
PUT, PATCH and DELETE accept forms and retain mutation capability classification.
Null, undefined, non-finite numbers, nested objects, arrays, whole-form binding
slots, missing/mistyped inputs, duplicate names and multi-valued fields are
unsupported. A repeated field requires another API contract, not an array or a
comma-joined value. The shared execution-data restrictions on object keys still apply.

The default `content-type` is `application/x-www-form-urlencoded`. An explicit
header may use the same media type, case-insensitively, with an optional
`charset=utf-8` (also `charset="UTF-8"`). Conflicting media types, other charsets,
extra parameters and repeated charset declarations fail, including after header
binding. The **1 MiB (1,048,576-byte)** request limit applies after encoding field
names and values; percent expansion counts. Content-Length uses the final byte
count. Existing definition, input and metadata limits apply separately and may
reject a value earlier. Invalid definitions/bindings are refused before dispatch.

Sensitive fields such as `password` and `client_secret` must use protected input
bindings. Keep credentials in the existing target resolver or protected storage;
do not put them in form literals or public values. Known form-encoded secret echoes
are screened from comparisons and public outputs as well as ordinary URI-encoded
echoes. Raw request bytes remain in memory. Forms retain destination, timeout,
cancellation, retry/idempotency and cleanup contracts; a lost mutation response
still requires existing recovery proof before replay. This adds no OAuth flow,
token cache, multipart upload, raw-body mode or form-response parser.

For a frozen manual step, see [form API steps](../manual-execution.md#form-api-steps).

## Credentials and evidence

Default credential resolution reads the target's `env:` reference from shell
environment, falling back to ignored consumer `.env`, as a bearer token. Custom
`resolveCredential({reference, target, destination, refresh, signal})` may return
authorization, x-api-key, api-key, x-auth-token or cookie headers. Bearer/Basic,
API-key and cookie authentication are supported; caching stays target-scoped and
refresh retains the frozen reference identity.

`resolveSensitive(ref, {signal})` and `storeSensitive(value, {identity, name, signal})`
use caller-owned protected storage returning `protected:` references. There is no
plaintext sensitive-value file store. Async resolvers cooperate with cancellation;
late results cannot dispatch or enter records. Blocking synchronous callbacks need
host process limits.

Credentials/raw payloads remain in memory. Evidence contains screened bounded
transport/comparison facts and explicit typed public outputs. Known credentials,
decoded Basic components, cookies and sensitive selectors are protected, including
their URI-encoded and form-encoded representations,
overlapping JSON paths, case-insensitive headers and whole-body text. The caller must
classify domain-sensitive fields; heuristics cannot detect every encoding/value.
Raw errors, URLs and payloads are omitted from diagnostics.

`finish()` checks scope, evidence bytes/associations and lifecycle before writing
`observations.json` and `result.json`. Saved JSON alone is not authority for
[reporting](../reporting.md). Package storage remains immutable.

## Effects and recovery

`readOnlyContract` establishes a non-mutating GET. Mutations can declare
`confirmedStatuses`, `noEffectStatuses` and `contractRef` based on actual endpoint
behavior; a status number alone proves no universal effect guarantee. Unclassified
responses/lost transmitted mutations remain uncertain.

Finite retries default on within the frozen attempt limit for transient transport/
timeouts or contracted auth rejection. Before-dispatch failure is not executed;
lost connected mutations are uncertain. Invalid definitions, data/type errors and
reliable failures do not retry. `retry: false` disables replay.

| Optional contract | Recovery requirement |
|---|---|
| `recovery.authentication` | Statuses such as 401 also in no-effect statuses; actual auth-before-write contract; retain rejected attempt and refresh |
| `recovery.reconcile` | Read-only GET with required status/select/equals/whenEqual, producing actual proof under the same limits |
| `recovery.idempotency` | Stable bound request key and the server's actual supported deduplication contract |

A 401 without that contract is evaluated normally. Reconciliation requires read
capability; failed/mismatching probes are inconclusive. Only confirmed no-effect
proof or supported idempotency permits uncertain mutation replay. Confirmed effects
are verified. Adding a header is insufficient, and finding a record cannot replace
lost response assertions. Safe recovery retains history with `stability=recovered`.

## Lifecycle and verification

One runtime handles one scenario; await execution in phase order. Overlap and late
reuse are refused. Prefer the mixed sequential runner for multiple families.
Standalone callers sequence required cleanup in technical-layer `finally` blocks,
not exception handling in POM business classes. One cleanup budget survives ordinary cancellation.

`resource: {id, output, ownership, intent, beforeStateRef?}` binds originating identity.
Ownership is harness/existing and intent temporary/restore/persistent/no-obligation.
Persistent effects need no invented disposal/before-image duty. Cleanup binds original
identity in `CLEANUP` with `lifecycle: {resourceId}`. Restoration uses `RESTORE`,
`lifecycle: {resourceId, guard: 'version'}` and a concrete strong `if-match` version;
wildcards are refused. The endpoint must honor conditional updates. Only successful
confirmed effects complete obligations; expected no-effect rejection does not.

Run `npm run test:api` for real loopback CRUD, policy, bindings, refresh, recovery,
redaction, deadlines and lifecycle. This does not prove external auth or every host.
See [contributing](../contributing.md) and archived
[API details](../archive/milestones/M7-API.md) / [validation](../archive/milestones/M7-VALIDATION.md).
