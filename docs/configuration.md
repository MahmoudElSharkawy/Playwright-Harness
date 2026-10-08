# Configuration and scenario sources

The consumer owns configuration under `.harness/`. Select the targets and operation
policy each environment needs, store secrets as environment references, and keep
local scenario intent versioned. See [getting started](getting-started.md) for setup.

## Environments and targets

`.harness/project.json` selects targets by identifier:

```json
{
  "version": 1,
  "defaultEnvironment": "qa",
  "environments": {
    "qa": {
      "environmentMode": "test",
      "browserTargets": ["qa-ui"],
      "apiTargets": ["qa-api"],
      "databaseTargets": ["qa-db"]
    }
  }
}
```

`.harness/targets.json` declares destinations independently:

```json
{
  "browser": {
    "qa-ui": {
      "origins": ["https://app.example.test"],
      "startUrl": "https://app.example.test/login",
      "users": {
        "tester": {
          "usernameRef": "env:QA_USERNAME",
          "passwordRef": "env:QA_PASSWORD"
        }
      }
    }
  },
  "api": {
    "qa-api": {
      "baseUrl": "https://api.example.test/v1",
      "credentialRef": "env:API_TOKEN"
    }
  },
  "databases": {
    "qa-db": {
      "engine": "sqlserver",
      "server": "localhost",
      "database": "Synthetic",
      "schema": "dbo",
      "connectionRef": "env:DB_CONNECTION"
    }
  }
}
```

Replace synthetic coordinates with your own consumer settings. Unused API/DB
registries and target lists can be empty. Browser targets are optional. Definitions
and references must agree; unknown fields, duplicate references and unknown targets fail.

Browser origins are explicit HTTP(S) origins without paths, wildcards or embedded
credentials. Optional `startUrl` must belong to an allowed origin. User handles map
to `usernameRef`/`passwordRef`, not values. API base URLs cannot embed credentials,
query strings or fragments. Database engines are `sqlserver` or `postgresql`; optional
destination fields include `server`, `port`, `database`, `schema`, `encrypt` and
`trustServerCertificate`. Engine support and query boundaries are in the
[database reference](reference/databases.md).

## Operation modes

| Mode | Default intent |
|---|---|
| `test` | Ordinary browser/API reads and mutations, DB SELECT/DML, and exploration |
| `protected` | Reads and read-oriented exploration; mutations need configured capability overrides |
| `custom` | Only deliberately configured capabilities |

DDL and admin default off. Enabling a capability does not add unsupported runtime
operations or bypass host controls. Ordinary permitted mutations in `test` need no
per-operation harness approval. Cleanup follows the scenario's intent and ownership.

Optional `capabilities` is a flat object of boolean overrides. The supported keys
are `apiReads`, `apiMutations`, `apiExploration`, `dbSelect`, `dbDml`, `dbExploration`,
`ddl`, `admin`, `browserReads`, `browserMutations` and `browserExploration`.
Review edits to existing profiles explicitly. Loading configuration validates it;
the [execution model](reference/execution-model.md) freezes the effective policy
and checks each operation against its target and runtime support.

## Secrets and readiness

Target references use `env:UPPERCASE_KEY`. Setup adds empty keys to the ignored `.env`;
you fill the values locally. Never put values into targets, scenario JSON, test data,
knowledge, review artifacts or reports. API targets may omit credentials when none
are required. Browser credentials are needed only for selected login steps; API/DB-only
manual runs do not need unrelated browser users.

An API variable holds a bearer token; a database connection variable holds JSON
with `user` and `password` fields. ADO's optional integration uses a bare variable
name instead; see [Azure DevOps](azure-devops.md#configure-the-connection).
To prepare empty keys for the default environment and ADO settings:

```sh
npx --no pom-harness check --add-env-keys
```

Run `npx --no pom-harness check` after configuration. Readiness, successful parsing
and typechecking are different from a live execution against the selected system.
See [browser](reference/browser.md), [API](reference/api.md) and
[database](reference/databases.md) references for runtime-specific checks.

## Framework configuration

The starter's configuration modules use browser target `app` and database target
`appDb`. If you use different identifiers, update the module references together
with the target definitions. Per-machine overrides derive from the target name,
such as `APP_URL` and `APP_DB_SERVER`. Existing frameworks retain their own
configuration modules; align harness targets with the destinations they actually use.

Test inputs and expected outcomes belong in paired JSON under `resources/testData/`.
Destinations and externally provisioned access belong in configuration and secret
references. See the [test-data skill](../.agents/skills/test-data/SKILL.md).

## Local scenario format

Save sources under `.harness/sources/`, for example `landing.json`:

```json
{
  "version": 1,
  "id": "landing-suite",
  "title": "Landing page observations",
  "scenarios": [
    {
      "id": "case-1",
      "title": "Observe the landing page",
      "steps": [
        {
          "action": "Open the configured landing page",
          "expected": ["The welcome heading is visible"]
        }
      ],
      "externalReferences": [{"system": "team-tracker", "id": "example-1"}]
    }
  ]
}
```

```sh
npx --no pom-harness load-source --source .harness/sources/landing.json --environment qa --out .harness/runs/source.json
```

Limits are 2 MiB, 1–500 unique scenarios, and 1–1000 steps per scenario. Every step
has an action and an `expected` array; setup steps can have an empty array, but each
scenario needs at least one expectation. Optional external references are preserved
without contacting or resolving their systems. Unknown fields and incomplete scope fail.

The loader records a relative source path and SHA-256 fingerprint. It refuses an
existing output destination. `LOADED` with `executed: false` proves only that input
was loaded. Refinement writes a separate artifact and must preserve every expectation
and external identity. Credential-like literal checks are conservative; review prose
for sensitive content. Errors do not echo source text.

Local sources support the full [automation workflow](PIPELINE.md) without ADO.
Standalone [manual execution](manual-execution.md) currently takes ADO suites/stories.
ADO retrieval can export this neutral format; see [Azure DevOps](azure-devops.md).

## Reviewed knowledge and team libraries

Reviewed, sanitized project knowledge lives under `.harness/knowledge/`. New observations
enter `.harness/knowledge-candidates/` and require review before promotion. Promoting
knowledge affects later runs; active inputs and reviewed candidates remain frozen.

Team collections in `resources/apisCollections/` and queries in `resources/Queries/`
are derive-only sources. Create narrowly scoped helpers or parameterized definitions
from them while preserving the originals. Catalogs, deterministic helpers and fixed
inline definitions are valid peers; catalog registration is not a prerequisite.

## Consumer-owned state

| Path | Contents and treatment |
|---|---|
| `.harness/project.json`, `.harness/targets.json` | Consumer settings with secret references only |
| `.harness/integrations.json` | Optional [ADO settings](azure-devops.md) |
| `.harness/sources/` | Versioned scenario inputs |
| `.harness/knowledge/` | Reviewed, sanitized knowledge |
| `.harness/knowledge-candidates/` | Unreviewed observations; ignored |
| `.harness/runs/` | Execution snapshots and evidence; ignored |
| `.harness/state/generation/` | Generation history, candidates and verification receipts |
| `.harness/state/review/`, `tracker/`, `hooks/` | Consumer workflow/session records; ignored by default |
| `.harness/state/setup/` | Setup recovery journals; ignored |
| `.harness/installation.json` | Migration receipts; ignored |
| `.harness/vendor/` | Committed release archive |
| `.harness/links.json` | Committed link/pointer manifest without machine paths |
| `reports/` | Generated output; ignored |

Templates remain immutable package assets, never live state. Package root, consumer
project root and consumer run root are distinct. Resolve output from the consumer,
not from a linked skill directory. See the [root contract](../.agents/skills/ROOTS.md)
and [architecture](architecture.md).
