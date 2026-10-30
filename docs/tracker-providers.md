# Azure and Jira providers

The harness uses one set of workflow scripts and skills. Select Azure DevOps or
Jira Cloud; for Jira, select Xray Cloud, Zephyr Scale Cloud, or no test-management
plugin. Provider adapters handle native reads, writes and identities. Review,
approval, execution, reporting, recovery and automation gates stay shared.

Existing Azure configuration, numeric IDs, saved state and compatibility scripts
remain supported. Existing consumers with Azure configured retain Azure as their
default. Local scenarios need no remote credentials.

## Choose the mode

| Mode | Case source and result destination | Story operations |
|---|---|---|
| Azure DevOps | Azure test cases, suites/plans and test runs | Azure work items, comments, tags, relations and bugs |
| Jira + Xray | Xray tests, test sets/plans/executions and native run/step results | Jira issues, comments, labels, issue links and bugs |
| Jira + Zephyr Scale | Zephyr cases, folders/plans/cycles and native execution/step results | Jira issues, comments, labels, issue links and bugs |
| Jira without a plugin | Local cases, execution/generation history and reports | Jira issues, comments, labels, issue links and bugs |

No-plugin mode does not invent Jira test cases, cycles, native results or remote
automation fields. Use the existing local source format and local handoff for
execution and automation. A Jira story link alone does not imply a test-management
capability. Test-source selection and bug-filing destination are independent;
keep both explicit in a mixed-provider project.

## Configure one selected provider

Keep consumer settings in `.harness/integrations.json`. Both providers can coexist:

```json
{
  "version": 1,
  "defaultProvider": "ado",
  "ado": {
    "organizationUrl": "https://dev.azure.com/your-org",
    "project": "Your Project",
    "credentialRef": "AZURE_PAT"
  },
  "jira": {
    "siteUrl": "https://your-site.atlassian.net",
    "project": "DEMO",
    "emailRef": "JIRA_EMAIL",
    "credentialRef": "JIRA_API_TOKEN",
    "testManagement": {"provider": "none"}
  }
}
```

Use `defaultProvider: "jira"` to select Jira by default. If omitted, an existing
Azure section takes precedence; a Jira-only configuration selects Jira. Commands
that accept `--provider ado|jira` override the default. Saved source/approval
bindings retain their provider and destination when the configured default changes.

Jira `siteUrl` is the HTTPS `*.atlassian.net` origin, with no path or credentials;
`project` is the exact project key. Classic API tokens use the default
`authType: "classic"`. Scoped tokens require `authType: "scoped"` and the site's
`cloudId` UUID; requests use the scoped Atlassian API route while provenance keeps
the same site URL. Jira Server/Data Center is outside this adapter's scope.

Replace only `jira.testManagement` to select a native plugin:

```json
{"provider":"xray","clientIdRef":"XRAY_CLIENT_ID","clientSecretRef":"XRAY_CLIENT_SECRET"}
```

```json
{"provider":"zephyr-scale","credentialRef":"ZEPHYR_API_TOKEN","region":"eu"}
```

Zephyr region is `eu` or `us`. These are separate plugin credentials; a Jira API
token is not an Xray client secret or Zephyr token. All integration references are
bare environment-variable names. Application targets still use `env:NAME`.
Add empty keys, let the user fill the ignored `.env` locally, and never put values
in requests, examples, screenshots, logs or receipts. Credentials resolve only
when the selected operation needs them; Jira-only work does not load plugin secrets.

Optional Jira mappings use stable native field/type IDs or verified type names:
`fields.acceptanceCriteria` and `issueTypes.bug`. Generic story/test-type overrides and
generic issue-to-test step mappings are not implemented and are rejected.
No acceptance-criteria mapping is required when the requirements are in Description.
Missing mappings never authorize invented rules. Configure native bug defaults in
`jira.bugs`; preview resolves current required fields and valid values.

Run `npx --no pom-harness check --add-env-keys`, then `check`. Readiness describes
configuration/access requirements; it is not evidence of a successful live operation.

## Capture and refresh requirements or context

Requirements use the same command and inventory in every mode. A Jira request is:

```json
{
  "version": 1,
  "project": "Demo product",
  "application": "checkout",
  "provider": "jira",
  "storyId": "DEMO-42",
  "sources": [],
  "attachmentIds": [],
  "includeHistory": true
}
```

```sh
npx --no pom-harness requirements prepare --id checkout --request requirements.json
```

Jira capture includes summary, Description, configured acceptance criteria and
paginated discussion; history is optional. ADF text, lists, tables and link
destinations retain provenance. Unsupported ADF nodes, incomplete pages and
unreadable attachments remain omissions. Only explicitly selected numeric Jira
attachment IDs belonging to that issue are downloaded; the default is none.
Shared readers sanitize text and enforce content-bound extraction receipts.

Native keys remain opaque. Freshness binds actual updated identity and selected
content, not an invented numeric revision. Irrelevant response fields such as
`lastViewed` do not invalidate evidence. Changed requirements, discussion, selected
attachments or relevant metadata require fresh review. Confirmed, exactly verified
owned links can be accounted for without hiding unrelated changes.

Business context uses the same `context` commands. Select a named Jira collection:

```json
{
  "version": 1,
  "contextId": "checkout-business",
  "identity": {"project": "Demo product"},
  "scope": {"application": "checkout", "environment": "qa"},
  "sources": [],
  "jira": {
    "sourceId": "backlog",
    "scope": {"issueKeys": ["DEMO-42", "DEMO-43"]},
    "includeDiscussion": true,
    "includeHistory": false,
    "attachments": []
  }
}
```

Use either fixed `scope.issueKeys` or `scope.jql`, such as
`{"jql":"issuetype = Story AND status != Closed"}`. JQL is a condition; project
scope is enforced by the adapter. Fixed keys stay fixed. Refresh reruns saved
criteria, includes new matches and checks membership. Optional type/state policy
uses current metadata; do not guess localized names or treat a failed query as an
empty project. Select attachments from returned `availableAttachments` using their
exact `id` and `attachmentId`; refresh retains that selection.

```sh
npx --no pom-harness context retrieve --request context.json
npx --no pom-harness context update --request context.json
npx --no pom-harness context update --id checkout-business
npx --no pom-harness context search --id checkout-business --work-item DEMO-42 --query confirmation
```

`retrieve` previews; `update` saves locally. Saved criteria take precedence over
later configuration defaults. Confirmed departures lose active support; unavailable
or partial sources retain their last valid evidence as stale/unverified. Preserve
history, omissions and owner decisions. Context capture never changes Jira or Azure.

## Design, execute and automate

Use the existing `test-case-design prepare/read/review/edit/assess/preview/publish/
reconcile/handoff` lifecycle. Its source request selects the tracker. `caseIds`
adds explicit native candidates (`"DEMO-300"` for Xray, `"DEMO-T25"` for Zephyr).
Reuse unchanged requires exact captured content; new cases retain temporary
`NEW-...` identities until a verified native identity is returned.

Native step `data` is optional. Preserve captured data when action and expectation
are unchanged. Changing a step with captured data requires an explicit reviewed
`data` value; an empty string clears it intentionally. Never silently drop inputs
while revising an action or expected result.

For Jira without a plugin, reviewed cases remain local. Optional `localCaseSource`
in the design selection reuses an existing validated local source. Approved local
handoff keeps Jira story references and enters either execution or generation.
No provider gets a separate case-design workflow or skill library.

Fetch ordinary native cases into the shared source format:

```sh
npx --no pom-harness fetch-story --provider jira --story DEMO-42 --source-out .harness/sources/checkout.json
npx --no pom-harness fetch-suite --provider jira --suite DEMO-100 --source-out .harness/sources/xray-set.json
npx --no pom-harness fetch-suite --provider jira --suite DEMO-R1 --source-out .harness/sources/zephyr-cycle.json
```

`suite` means an Xray test set or Zephyr cycle. Azure retains its suite/plan IDs
and configured plan default. Generic CLI actions dispatch through
`scripts/integration.mjs`; existing `fetch-ado-*`, `publish-ado-results`, tagging,
relinking and case-edit compatibility scripts remain Azure-specific.

Manual execution uses the same prepare/refine/freeze/run/report flow:

```sh
npx --no pom-harness execute prepare story DEMO-42 --provider jira --environment qa
npx --no pom-harness execute prepare case DEMO-T25 --provider jira --environment qa
npx --no pom-harness execute prepare local .harness/sources/checkout.json --environment qa
```

Jira native selectors also include `suite`, `plan`, `execution` and `folder` where
the chosen plugin supports them. Xray supports test sets, plans and executions;
Zephyr supports cycles, plans and case folders. Use `prepare local` for no-plugin
cases. No remote `--provider` or `--plan` applies to a local source.

Automation consumes the same neutral source through [the generation workflow](PIPELINE.md).
Preserve every action, data item and expectation, independent review, cumulative
repair history and two fresh scoped green runs. Neither native publication nor
an automation flag proves that a test passed. Durable automation metadata records
the actual test name, relative source storage, framework type and stable identity;
setting or clearing it preserves unrelated native content.

For fetched native automation, the shared `publish-results` action reads the exact
manifest and adjacent verification state. Preview first; delivery repeats the same
arguments with `--execute --approval <preview-fingerprint>`:

```sh
npx --no pom-harness publish-results --provider jira --manifest execution-tests/<captured-folder>/_suite.json --group DEMO-R1 --statuses statuses.json
npx --no pom-harness publish-results --provider jira --manifest execution-tests/<captured-folder>/_suite.json --mark-automated --test-map test-map.json
```

`test-map.json` maps captured case IDs to `{ "file": "tests/Checkout.spec.ts",
"title": "Customer completes checkout" }`; the file and literal title must match
the verified tests. For marking Automated, PASS requires two scoped greens; a
classified application-defect FAIL remains eligible under the existing Azure gate.
Both require the exact test mapping.
Use `--value "Not Automated"` to clear owned automation metadata. For local/no-plugin
automation, use `publish-results --source <source.json> --verification <state.json>
--mark-automated --test-map <map.json>`; the verification state must bind the exact
validated source and case IDs. This updates local metadata, with no Jira credentials
or remote test entities. Keep publication after the existing delivery/merge gate.
Publish native results before marking automation. Automation metadata changes the
native source fingerprint: a later clear or other publication needs a refreshed
source and verification for that source. Do not implicitly reuse a stale manifest.

The same generic `tag-workitem --id <key> --tag <label>`,
`relink-story --id <key> --story <key> [--link-type <id>]`, and
`edit-cases --input <proposal.json>` commands select Jira with `--provider jira`.
They preview by default and require the exact `--approval` with `--execute` for
native writes. Case edits require a test-management plugin and the captured native
revision; no-plugin story labels and links remain available.

## Deliver and recover

Preview concrete changes before authorized delivery. Requirements comments use
`requirements preview/post/reconcile`; test cases use the shared design commands.
Requested Jira mentions resolve real active account IDs in the selected project;
never guess an account from a display name or substitute plain `@Name`.

Native result publication requires an existing Xray execution or Zephyr cycle,
explicit valid native status mappings, and verified case/step outcomes:

```sh
npx --no pom-harness execute publish-results <exec> --group DEMO-R1 --statuses statuses.json --step-statuses step-statuses.json
npx --no pom-harness execute publish-results <exec> --group DEMO-R1 --statuses statuses.json --step-statuses step-statuses.json --approval <preview-fingerprint> --execute
```

Mapping files map neutral outcomes such as `PASS`, `FAIL`, `BLOCKED`, `NOT_RUN` and
`REVIEW_REQUIRED` to actual available native status names. Local-source publication
returns local outcomes/history instead of creating a remote run.

For bugs, select the destination independently of the test source:

```sh
npx --no pom-harness bug-report preview <report> --provider jira
npx --no pom-harness bug-report approve <report> --preview <plan-hash>
npx --no pom-harness bug-report file <report> --provider jira --approved <plan-hash> --execute
```

Keep source freshness tied to its original tracker. Show required/custom destination
fields, attachment eligibility and exact issue links. No cross-provider link or
default bug type is implied by an execution source. Jira has no Azure validate-only
write equivalent; metadata checks must not be described as proof that every server
rule will accept a write.

Shared receipts preserve exact intent, acknowledged identities and verified
readback. On partial or uncertain delivery, reconcile those identities or a unique
owned remote marker. Never recover by title alone, blindly retry a create, replay
completed writes, or call missing access an empty result.

Case-design `reconcile` is read-only by default. An explicit
`reconcile --id <id> --execute --approval <original-fingerprint>` may finish only
missing native steps or coverage links that readback and durable receipts prove
were never dispatched or were rejected without execution. Native result delivery
can similarly continue proven missing operations with the original approval and
`--execute`. An unknown dispatched effect is never permission to retry it.

## Allure and tracker identity

Xray checks tenant-qualified Jira project metadata returned by its native API.
Zephyr checks the project key and native/Jira project IDs, but those responses do
not prove the Jira site origin. Verify the selected Zephyr token/site pairing in
the disposable live acceptance project before claiming live support.

Keep the native key plus provider and site/collection. Same-looking keys from
different sites must not collide. Preserve source-provided external URLs:

| Reference | Destination |
|---|---|
| Azure work item | Existing configured collection/project work-item URL |
| Jira issue or Xray test | `https://your-site.atlassian.net/browse/DEMO-123` |
| Zephyr Scale case | Its native case URL, for example `https://your-site.atlassian.net/projects/DEMO?selectedItem=com.kanoah.test-manager__main-project-page#!/testCase/DEMO-T25` |

A single-provider project may use matching literal reporter templates. Never apply
a Jira `/browse/%s` template to Zephyr case keys. Mixed sites or case systems use
explicit links plus a stable site-qualified test identity, for example:

```ts
await allure.feature('Checkout');
await allure.testCaseId('xray:https://your-site.atlassian.net:DEMO-123');
await allure.link('https://your-site.atlassian.net/browse/DEMO-123', 'DEMO-123', 'tms');
```

Keep local `testCaseId` values from their source; add issue links only for real
associated items. Retain existing Azure templates and consumer reporter options.
No URL helper or duplicated test body is needed solely for provider selection.

The shared tracker supports source-bound registries and opaque case IDs; see the
[plan-tracker skill](../.agents/skills/plan-tracker/SKILL.md). Scope each registry and
history event to the selected provider/site/project/plugin or local source. Status
still means the existing evidence: done requires two scoped greens, and failed,
blocked or uncertain work remains visible.

## Required native case fields

Use `nativeFields` on a case in the existing design or `edit-cases` input. Xray
uses Jira field IDs and native values; Zephyr uses custom field names and native
values. For example:

```json
{"nativeFields":{"customfield_12345":{"id":"10001"}}}
```

```json
{"nativeFields":{"Risk":"High"}}
```

Optional `jira.testManagement.caseFields` supplies creation defaults in the same
format; each case's explicit values take precedence. Updates preserve existing
values unless the reviewed proposal changes them. Required fields cannot be
cleared. `Reuse unchanged`, Azure and local/no-plugin proposals do not accept
`nativeFields`; Azure keeps its existing native field checks.

Preview reports missing required fields, unsupported types, read-only/unknown
fields and invalid options before any write. Fields and schema are included in
the approval fingerprint. Changed inputs require a new preview and approval;
readback and recovery verify the approved values as well as case content.

Xray resolves the native Test issue type from existing native tests and reads
Jira's current create/edit metadata. An empty project needs an explicit
`jira.testManagement.testIssueTypeId`, checked against the available Jira issue
types. A type's display name alone does not establish an Xray Test. See the
[Xray createTest API](https://xray.cloud.getxray.app/doc/graphql/createtest.doc.html).

Zephyr's [public API](https://support.smartbear.com/zephyr-scale-cloud/api-docs/)
does not expose custom-field definitions. Before case writes, record the complete
current field list from the selected project's Zephyr settings in
`jira.testManagement.caseFieldSchema`:

```json
{
  "siteUrl": "https://your-site.atlassian.net",
  "project": "DEMO",
  "reviewedAt": "2026-10-30T00:00:00Z",
  "fields": [
    {"name":"Risk","type":"Select List (Single Choice)","required":true,"allowedValues":["High","Low"]}
  ],
  "requiredStepFields": []
}
```

Use the exact [Zephyr field types](https://support.smartbear.com/zephyr/docs/en/configuration/advanced-customization-options/custom-fields-for-test-cases,-cycles,-plans,-steps,-and-executions.html)
and complete choices for select lists. Include optional fields too; `fields: []`
explicitly records a reviewed project with no case custom fields. List all mandatory
step-field names in `requiredStepFields`; nonempty lists block case step writes
because custom step values are not supported. Do not infer an empty list from
sample cases or failed creates.

Missing or mismatched Zephyr schema blocks writes while read-only use remains
available. Update this reviewed snapshot whenever project settings change; the
API cannot detect unrecorded schema changes. Zephyr updates send the complete
custom-field map, preserving existing values and representing optional blanks as
`null`. Automation metadata updates use the same checks. Live acceptance must
confirm the snapshot against the actual tenant.

## Validation and native limits

Bug creation separately supports discovered required/custom Jira fields through
the same field-value checks.

The Jira adapters are covered by offline fixtures and shared Azure/local regression
tests. This does not establish live tenant permissions, plugin licensing, configured
field rules or successful Jira/Xray/Zephyr acceptance. Check the selected tenant
when authorized and report its actual result.

Unsupported called/shared/parameterized/dataset steps, attachments on native steps,
partial ADF or unavailable metadata remain explicit gaps. Do not flatten away their
meaning or claim feature parity by returning empty data. Use supported source-backed
refinement, local cases, or native review for the affected scope; preserve the same
readiness, approval, review and recovery gates.
