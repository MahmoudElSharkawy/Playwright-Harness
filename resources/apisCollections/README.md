# resources/apisCollections/ — API knowledge from two origins

Postman v2.1 files in this folder have two distinct authorities:

| Origin | Filename | Authority |
|---|---|---|
| Supplied team export | `<collection-slug>.postman_collection.json` | The team's Postman workspace; import ritual below |
| Observed collection | `<application>-observed.postman_collection.json` | Reviewed, sanitized consumer run evidence and verified API definitions |

Search existing framework business methods first, then applicable supplied requests,
then reviewed and verified observations for missing operations. A collection is not
a prerequisite for execution or authoring. Both origins are derive-only knowledge;
neither grants target access or changes API/DB channel selection. The 2026-10-26
observed-API ruling extends the 2026-08-26 team-library ruling.

## Team exports — ownership and import

- **The source of truth is the team's Postman workspace.** Endpoint corrections happen
  there and arrive by re-export.
- **The checked-in copy is harness-curated** — unlike the Queries library, a raw
  Postman export is NOT committed verbatim, because exports capture point-in-time
  session state (live bearer tokens, session cookies, vault variable references,
  browser download suffixes in the filename). Every import/re-export goes through the
  **import ritual** below before it lands; request/response semantics (method, path,
  payload shape, scripts) are never altered by it.
- Reference a request by its `name` inside the collection, never by array position.

### Import ritual (each export / re-export)

1. **Normalize the filename** to `<collection-slug>.postman_collection.json`
   (e.g. `acme-qc.postman_collection.json`) — no spaces, no download counters.
2. **Strip point-in-time secrets**: hardcoded `Authorization: Bearer <jwt>` header
   values become `Bearer {{token}}` (the collection's own Token request chains it);
   `Cookie` session headers are deleted; Postman-vault variable artifacts
   (`*_api_key_*`-style names) are removed from headers and the
   `variable` block. A secret never survives into git, not even an expired one.
3. **Parametrize hosts** as collection variables (`{{baseUrl}}`, `{{tokenBaseUrl}}`,
   `{{internalBaseUrl}}`, …) with the export's literal hosts preserved as the variable
   values — environment coordinates stay visible but swap in one place.
4. **Drop empty junk requests** (unnamed/blank-URL placeholder entries).
5. **Keep everything else verbatim** — bodies, pre-request/test scripts, descriptions
   (including "Generated from cURL" provenance notes), sample values, and item order.
6. **Update the index below** and note anything odd for the team to confirm.

## Observed collections — review and incremental promotion

The shared browser boundary passively retains bounded, source-bound API candidates
under `.harness/knowledge-candidates/api/`. Capture is not verification. Raw traffic
stays in protected run storage; durable candidates remove scalar values and unknown
path segments. Only a fixed public route vocabulary is retained, with bounded
structures, ordering, provenance and explicit gaps. Opaque `{segmentN}` placeholders
do not establish parameter names or prove a parameterized route.
Unknown field names are removed under a conservative allowlist. Unknown request/query
names block reuse; unknown response names remain a limitation, and extraction must
refer to observed supported fields. See [API discovery](../../docs/reference/api.md#observed-api-knowledge).

Review establishes the actual route, purpose, inputs, authentication/session needs,
response extraction, effects and lifecycle from permitted evidence. A successful,
source-bound validation through the configured API runtime is required before
`reviewApiCandidate` writes immutable `.harness/knowledge/api/` records. A create
observation never proves a delete route; unresolved authentication, body formats or
cleanup remain gaps. This uses ordinary review and permitted execution, with no new
per-endpoint approval ceremony. Reviewed definitions can be used before collection
serialization through the existing catalog/helper/inline/exploration interfaces.

`promoteObservedCollection` writes the separate observed filename with a writer lock,
an integrity marker, stable request names, parameterized hosts/inputs, synthetic
response examples where supported, review/validation provenance and a sanitization
ledger in `x-harness-observed`. Equivalent reviewed definitions are deduplicated;
distinct request definitions remain separate. Repeated promotion is idempotent.
Authentication and chaining come only from established contracts; promotion adds no
Postman scripts or invented authentication recipe.

Supplied files remain unchanged. Review conflicts against applicable team requests
explicitly and record the resolution; an observed collection never replaces the
team contract. A changed owned collection or conflicting reviewed operation is
refused rather than silently reconciled. New evidence creates new candidate/review
records. Promote knowledge and collections before freezing a generation candidate;
later changes require the existing review/verification workflow. Keep referenced
sanitized evidence and review artifacts available for integrity checks.

## How the harness consumes the library — derive-only

The library is **read, understood, and derived from — never replayed as-is**.
Consumption paths:

| Consumer | When | What it derives |
|---|---|---|
| automate-test REFINE / prerequisite knowledge | resolving supported seed/verification intents | parameterized catalog/helper/inline/exploration definitions under existing permissions |
| automate-test GENERATE / service-classes | authoring `Apis<Domain>` classes | `readonly <operation>_serviceName` fields, request payload shapes (typed parameter objects), auth flow |
| test-data reusability ladder (step 2) | a rerun fails on consumed/stale data | the API seed/cleanup route that makes the case re-runnable |
| Manual execution / native API runtime | frozen operation definitions | derive collection requests into parameterized defineApiOperation definitions; source samples are never replayed |

## Adaptation rules (collection request → framework/catalog artifact)

1. **Endpoint paths become `<operation>_serviceName` fields** on the owning
   `Apis<Domain>` class (service-classes practice 3) — never inline literals. Writing
   an endpoint the collection already knows, from scratch, is a review finding
   (`collection-library-bypassed`).
2. **Base URLs are environment data, not endpoint data.** The `{{baseUrl}}`-style
   variables map to `playwright.config.ts` / config files for the POM layer and to
   the configured target baseUrl for native execution — never
   hardcoded in a class or spec. Note: an export may point its Token request at a
   **different host** than the business requests (e.g. a dev token host alongside qc
   business hosts) — preserve the distinction as separate variables
   (`{{tokenBaseUrl}}` vs `{{baseUrl}}`) and confirm with the team before relying
   on it.
3. **Sample literals never leave the library.** Customer/member ids, IBANs, phone
   numbers, emails, and record GUIDs in request bodies are
   point-in-time examples — never test data, never expected values, never defaults
   (leak = review finding `collection-sample-literal-leaked`). Payload values arrive
   as parameters from `resources/testData/*.json`.
4. **Pre-request/test scripts are recipes, not code to port blindly.** They document
   the data-generation rules (e.g. a reference number = N random digits; an id field
   with a fixed leading digit) and the response-to-request chaining (`token`,
   reference numbers, and names flow between requests). Derive the
   equivalent TypeScript in the framework's test-data/utils layers; never execute the
   JavaScript itself.
5. **Authentication follows the established contract.** If a supplied Token request
   documents chaining, derive the appropriate service action; native execution uses
   the configured target credentialRef and protected inputs. Observed collections
   do not invent token requests, session/CSRF flows or scripts. Literal tokens never
   appear in code or observed collections.
6. **Internal-host requests** (ops/back-office endpoints on internal IPs) are ops
   levers, not customer-facing endpoints — treat them as seed/fixture material with
   the same care the automate-test triage applies to anything hard-to-reverse.

## Index

| Collection | Request | Method & path | Notes |
|---|---|---|---|
| Acme - QC (example — replace) | Token | GET `{{tokenBaseUrl}}/api/token` | Auth bootstrap; test script stores the raw body as `{{token}}` (collection-level bearer) |

### Sanitization ledger

For team exports, append one dated subsection per import/re-export
(`### <collection-slug>.postman_collection.json (imported <date>)`) recording exactly
what the import ritual changed — filename normalization, dropped junk requests,
renamed requests, stripped secrets/cookies/vault artifacts, host parametrization —
so the diff against the team's next export stays explainable. Bodies, scripts,
descriptions, and item order are never touched, and each entry says so.

Observed promotion records its sanitization ledger inside the collection, keyed by
immutable reviewed identity. It states which captured data was removed and that
reviewed semantics and supplied files were preserved. Review this ledger with the
collection diff; capture does not claim complete API coverage.
