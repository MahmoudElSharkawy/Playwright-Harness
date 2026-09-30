# M3 adoption, consumer state and local sources

The package owns canonical instructions, templates and scripts. The consumer owns
configuration, specifications, application code, reviewed knowledge and runtime data.
Resolve a linked skill to its real path before following references. Never derive
consumer storage from a skill installation directory.

## Adoption and upgrades

From a separate consumer directory:

```sh
node ../playwright-pom-harness/scripts/adopt-project.mjs --project-root . --environment qa --mode test --dry-run
node ../playwright-pom-harness/scripts/adopt-project.mjs --project-root . --environment qa --mode test
```

Adoption creates native Codex directory links (junctions on Windows), not copied
rule libraries. Launch Claude from that consumer using `--plugin-dir` with the same
package directory. Keep the package at that location while consumers use its links.
An upgrade at a new location requires reviewing and relinking existing package links;
custom directories are never removed automatically. Native discovery failures remain
incomplete gates. The M3 Windows proof does not certify Linux link behavior.

The command appends a small managed block to AGENTS/CLAUDE instructions and missing
ignore entries. Existing settings, app code, team imports and configuration are
preserved. A changed managed block or customized skill stops migration before writes.
Review the difference against the canonical rules, preserve useful consumer additions
in the consumer's instructions or distinct project skills, and resolve the collision
explicitly before retrying. Do not silently replace customized skills.

Known legacy Markdown is replaced only when its newline-normalized digest matches
the recorded original. Review ledgers, prerequisite facts, tracker registries/history
and page maps migrate to consumer locations. Original state files remain available;
`.harness/installation.json` records source fingerprints and destinations. On rerun,
an unchanged legacy source does not overwrite a newer destination. Changed sources or
conflicting destinations require review. Migration does not itself promote unreviewed
facts: preserve their prior review status and sanitize before any later promotion.

Planning validates conflicts before writes. Application also detects changed planned
files; it is not a filesystem transaction. After an interruption, inspect the summary
and retry; do not discard existing consumer work.

## Deliberate profiles and separate targets

`.harness/project.json`:

```json
{
  "version": 1,
  "defaultEnvironment": "qa",
  "environments": {
    "qa": {
      "environmentMode": "test",
      "apiTargets": ["qa-api"],
      "databaseTargets": ["qa-db"]
    }
  }
}
```

`.harness/targets.json`:

```json
{
  "api": {
    "qa-api": {
      "baseUrl": "https://api.example.test/v1",
      "credentialRef": "env:API_TOKEN"
    }
  },
  "databases": {
    "qa-db": {
      "engine": "sqlserver",
      "connectionRef": "env:DB_CONNECTION",
      "schema": "dbo"
    }
  }
}
```

Fresh adoption starts with empty target lists and registries. Add target definitions
and their references together. Supported engine labels are `sqlserver` and
`postgresql`; these labels do not claim that database drivers exist in M3.
Credentials remain environment-variable references; no secret value is resolved or
serialized by these tools. Keep private destinations/configuration out of the public
package. API base URLs cannot embed user credentials, queries or fragments.

Profiles record the approved policy intent:

| Mode | Intended operation policy for later executors |
|---|---|
| `test` | Ordinary API reads/mutations and DB SELECT/DML, including dynamic exploration |
| `protected` | Read-oriented by default; mutation capabilities explicitly configured |
| `custom` | Capabilities deliberately configured for this environment |

DDL/admin remain disabled by default. Optional `capabilities` is a flat object of
boolean overrides: `apiReads`, `apiMutations`, `apiExploration`, `dbSelect`, `dbDml`,
`dbExploration`, `ddl`, `admin`. Unknown fields, environments and target references
fail. Changing an existing profile is a reviewed configuration edit; rerunning the
adopter with a different mode refuses to change it silently.

M3 validates and loads configuration only. It does not compute an execution policy,
resolve credentials, dispatch requests or implement drivers. Later executors must
apply the approved profile defaults, target limits and supported capabilities.
Nothing here authorizes unsupported operations or bypasses native host controls.
No catalog registration or repeated mutation approval is introduced.

## Local scenario sources

Store versioned inputs in the consumer, for example `.harness/sources/synthetic.json`:

```json
{
  "version": 1,
  "id": "synthetic-suite",
  "title": "Synthetic local observations",
  "scenarios": [{
    "id": "case-1",
    "title": "Observe the landing page",
    "steps": [{
      "action": "Open the configured landing page",
      "expected": ["The welcome heading is visible"]
    }],
    "externalReferences": [{"system": "team-tracker", "id": "example-1"}]
  }]
}
```

```sh
node ../playwright-pom-harness/scripts/load-local-source.mjs --project-root . --source .harness/sources/synthetic.json --environment qa --out .harness/runs/source.json
```

The loader preserves actions, expectations and optional references and records a
relative source path plus SHA-256 of the bytes parsed. Sources are bounded to 2 MiB,
1–500 unique scenarios and 1–1000 steps per scenario. Each scenario needs at least
one expectation; a setup step may have an empty expectation array. Unknown fields
and malformed/empty scope fail. Credential-like literal checks are conservative
mechanical checks, not a guarantee that arbitrary prose contains no sensitive data.
Errors do not echo source content. Output creation refuses an existing destination.

No ADO settings, network or external-reference resolution is needed. `LOADED` and
`executed: false` mean the source was loaded, not that a test passed. Refinement
creates a separate consumer artifact and preserves every source assertion and
reference; it must not overwrite source intent. Execution/generation integration
remains later work.

## Consumer-owned state

| Path | Treatment |
|---|---|
| `.harness/project.json`, `.harness/targets.json` | Consumer configuration; secret references only |
| `.harness/sources` | Versioned scenario input |
| `.harness/knowledge` | Reviewed, sanitized project knowledge |
| `.harness/knowledge-candidates` | Unreviewed observations, ignored |
| `.harness/state/review` | Review finding history, ignored |
| `.harness/state/tracker` | Plan registries/history, ignored by default |
| `.harness/state/hooks` | Session-specific advisory hook records, ignored |
| `.harness/runs` | Outputs and evidence, ignored |
| `.harness/installation.json` | Migration receipts, ignored |

Templates under canonical skill assets never become live state. Review/sanitize
knowledge before versioning it; promotion affects later work, not active run inputs.
Team libraries remain immutable sources for derived helpers, inline definitions or
optional catalogs. Cleanup follows intent and ownership: temporary fixtures normally
clean up, required restorations are explicit, and intentional persistent outcomes
may remain. M3 does not implement any of those operations.

Tracker and metrics commands accept `--project-root` and default to the consumer's
current directory. Tracker templates come from the installed package; output goes
to consumer `reports/tracker`. Initialize a real registry from the canonical
`plan-tracker/assets/registry-template.json`; an empty report is not test coverage.

## Optional compatibility hooks and ADO commands

Existing host settings are never overwritten. To enable legacy Claude hooks, merge
only the desired hook entries from the package template and point each command at
the installed `scripts/hooks/guard.mjs`, quoting the path where needed. Do not copy
the broad permissions block as an automatic installation step. Hook payload `cwd`
selects the consumer; session records stay in that consumer. Verify startup and state
placement. Hooks remain advisory/fail-open and are not execution-policy enforcement.

Legacy ADO commands accept `--project-root`; they keep their original legacy config
format and workflow. Configure them only for an authorized ADO workflow. Live ADO
writes and complete adapter restructuring are outside M3. The local-source route
operates without them.
