# Refinement contract

The draft is bounded JSON, version 1. Unknown keys are refused. Each scenario has
`id` and ordered `steps`; phases are SETUP, EXERCISE, VERIFY, CLEANUP or RESTORE
(existing-resource restoration is deferred). Each step declares `id`, `family`,
`target`, `capability`, `phase`, `sourceSteps`, `inputs` and `expectations`.

Preserve every source action and bind each expectation once, at or after its source
step. Splitting is allowed only when normalized condition texts joined with spaces
equal the original expectation. Never rewrite or weaken it. Drafts default to
observational conditions; choose a deterministic predicate when it can be checked.
REFINE must explicitly complete required login bindings, API/DB operation definitions,
check provenance and resource/cleanup declarations; the draft does not infer these.
Freeze reports the missing step/binding and returns scoped `readiness`. Configured
users without login produce guidance, without blocking unrelated scenarios.
Source/refinement/freeze aggregates permit 500 scenarios, 64 MiB, 2,000,000 JSON
nodes and depth 32. Other artifacts retain their separate limits. Non-secret expected
environment references use the consumer environment loader, including `.env`.

```json
{
  "text": "Save button is disabled",
  "predicate": "state:disabled",
  "subject": {"element": {"role": "button", "name": "Save"}},
  "expected": null,
  "precondition": false,
  "exact": false,
  "ambiguous": false
}
```

Predicates: present, absent, equals, state:enabled/disabled/checked/unchecked/visible/hidden,
url, count, observational. Subject is `"page"`, `{region:{name}}` or
`{element:{role?,name}}`; its name occurs in the condition text. State and
observational predicates use null expected values. Others use
`{source:"source-text",value:...}` (a source substring), `parameter:<name>`,
`reference:<name>` or `output:<name>`. File references need `{file,path?}`; env
references need `{env}`. A clean git-tracked file or non-secret env value is approved;
assumed reference data remains unresolved. No keyword-based language lint is used.

Declare `capability:"reads"` only with `readOnlyContract:{reason}`. Otherwise use
mutations. API/DB operations use the existing operation-definition schemas and
`checkProvenance:[{check,key,condition}]`, with one equality check per condition.
Condition indexes start at 1. The host gives them distinct core assertion IDs while
retaining their source key. Ambiguous and synthetic conditions are capped at review.
API reads additionally declare the runtime's read-only contract; DB reads use SELECT.

Inputs are `{name,source}` with parameter/reference/output/env sources. Names are
execution identifiers; aliases allow source parameter names with spaces. `env:`
inputs carry opaque protected references. Sensitive source parameter values are
withheld; bind them through protected environment references.

Login: `login:{user,landmark}` names a configured browser-target user and the
observable post-login landmark. It never embeds credentials.

Creation: `creates:[{resource,identityOutput,intent,cleanupStep?}]`, one per step.
Intents are temporary, persistent or no-obligation; ownership is harness.
Temporary resources require a CLEANUP step with `cleanupResource` and an input
bound to `output:<identityOutput>`. API/DB creation extracts that identity; browser
creation captures it and confirms the effect. Retained/no-obligation resources
use not-required with no lifecycle evidence or attempt. Missing identities and
failed cleanup require review. Existing/restore lifecycles are deferred.
