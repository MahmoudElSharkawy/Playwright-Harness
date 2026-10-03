# resources/apisCollections/ — the team API-collection knowledge library

The Postman collection exports (v2.1) in this folder are the QA team's curated API
knowledge for the backends of the application under test: the endpoints that matter,
their methods, payload shapes, auth flow, and the variable-chaining recipes that string
them into working journeys (e.g. authenticate → create a record → confirm it). They are
the API counterpart of `resources/Queries/` — durable application knowledge the harness
consults instead of rediscovering. Governed by the 2026-08-26 "Team API-collection
library & configuration sources" ruling (design-conventions, Decision records).

## Ownership & lifecycle — curated on import (differs from `resources/Queries/`)

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

## How the harness consumes the library — derive-only

The library is **read, understood, and derived from — never replayed as-is**.
Consumption paths:

| Consumer | When | What it derives |
|---|---|---|
| automate-suite REFINE / prerequisite dictionary `api` routes | converting seed/verification intents to `api:` steps | proposed `integration/*_api.json` catalog entries (user-confirmed before EXPLORE) |
| automate-suite GENERATE / service-classes | authoring `Apis<Domain>` classes | `readonly <operation>_serviceName` fields, request payload shapes (typed parameter objects), auth flow |
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
5. **Auth is the chained `{{token}}`** from the Token request — in the framework this
   is an `Apis<Domain>` action whose response feeds subsequent calls; in native execution
   it is the target credentialRef and protected input indirection. Literal tokens never appear
   anywhere.
6. **Internal-host requests** (ops/back-office endpoints on internal IPs) are ops
   levers, not customer-facing endpoints — treat them as seed/fixture material with
   the same care the automate-suite triage applies to anything hard-to-reverse.

## Index

| Collection | Request | Method & path | Notes |
|---|---|---|---|
| Acme - QC (example — replace) | Token | GET `{{tokenBaseUrl}}/api/token` | Auth bootstrap; test script stores the raw body as `{{token}}` (collection-level bearer) |

### Sanitization ledger

Append one dated subsection per import/re-export
(`### <collection-slug>.postman_collection.json (imported <date>)`) recording exactly
what the import ritual changed — filename normalization, dropped junk requests,
renamed requests, stripped secrets/cookies/vault artifacts, host parametrization —
so the diff against the team's next export stays explainable. Bodies, scripts,
descriptions, and item order are never touched, and each entry says so.
