# M3 adoption, consumer state and local sources

The package owns canonical instructions, templates and scripts. The consumer owns
configuration, specifications, application code, reviewed knowledge and runtime data.
Resolve a linked skill to its real path before following references. Never derive
consumer storage from a skill installation directory.

## Adoption and upgrades

Since 3.1.0 a project installs the harness from its versioned release archive; see
[Get started](../README.md#get-started) and the `harness-setup` skill. Setup installs the
archive as an exact development dependency, committed under `.harness/vendor/`. It links
each skill into `.claude/skills/` and `.agents/skills/`: junctions on Windows, relative
symbolic links elsewhere. The links are recorded in `.harness/links.json`, so `npm ci`
restores them for teammates and CI. An update runs setup from the newer archive; nothing
depends on a sibling checkout or a `--plugin-dir` launch flag. The adoption engine stays
available from a package checkout as `scripts/adopt-project.mjs`.

Link ownership is checked first. Setup creates a link only where nothing exists, and
repairs only links that hold no content of their own: a link into an earlier harness
package, or a dangling link it recorded. A real folder or file, or a link to anything
else, is preserved and reported. Native discovery failures remain incomplete gates.

Setup appends a small managed block to the AGENTS and CLAUDE instructions, plus missing
ignore entries. Existing settings, app code, team imports and configuration are
preserved. A released managed block is replaced; an edited block or a customized skill
stops setup before any write. Review the difference against the canonical rules,
preserve useful consumer additions in the consumer's instructions or distinct project
skills, and resolve the collision explicitly before retrying. Do not silently replace
customized skills.

Known legacy Markdown is replaced only when its newline-normalized digest matches
the recorded original. Review ledgers, prerequisite facts, tracker registries/history
and page-map pages migrate to consumer locations; a legacy page map's README and
template stay behind, because the package ships them with `automate-suite`. Original
state files remain available; `.harness/installation.json` records source fingerprints
and destinations. On rerun, an unchanged legacy source does not overwrite a newer
destination. Changed sources or conflicting destinations require review. When tracked
data would move into the git-ignored `.harness/state/`, the legacy folder is kept and
reported, so the team decides before shared data becomes per-machine. Migration does
not itself promote unreviewed facts: preserve their prior review status and sanitize
before any later promotion.

Setup plans every change and reports all conflicts before it writes. It journals each
change under `.harness/state/setup/`, so an interrupted run can be rerun, which is
idempotent, or undone with `npx --no pom-harness setup --restore`. Do not discard
existing consumer work after an interruption.

## The starter for a new framework

In a project without Playwright, setup adds a minimal starter from `examples`:
`playwright.config.ts`, `global-setup.ts`, `allurerc.json`, `tsconfig.json`, the
`src/config` modules, the technical `src/utils` facades, `.env.example`, and
`README.md` when there is none. It creates missing files only, with no demo pages
or tests. The starter's exact development dependencies are installed with the
harness. `src/config/targets.ts` reads destinations from `.harness/targets.json`, so
they are entered once for both the harness and the tests.

Harness commands run as `npx --no pom-harness <command>` from the project folder; no
copied shortcuts need repointing. The convention checker checks the current folder by
default. The ADO commands still require explicit [M12 configuration](M12-ADO.md). Verify
that `npx --no pom-harness check-conventions` reports nonzero file and rule counts.

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

`npx --no pom-harness setup --environment qa --mode test` adds a profile; a new
profile starts with empty target lists, and no configuration exists until the first
one is added. The `harness-setup` skill asks the mode question for each environment. Add target definitions
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
fail. Changing an existing profile is a reviewed configuration edit; rerunning setup
with a different mode refuses to change it silently.

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
npx --no pom-harness load-source --source .harness/sources/synthetic.json --environment qa --out .harness/runs/source.json
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
| `.harness/vendor` | The installed release archive, committed so `npm ci` can install it |
| `.harness/links.json` | The managed skill links and pointer files, committed; no machine paths |
| `.harness/state/setup` | Setup run journals for `setup --restore`, ignored |

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

M12 now supplies [optional ADO adapters](M12-ADO.md), explicit consumer configuration
and write receipts. The following describes the original M3 adoption boundary;
use the M12 guide for current command behavior and `--execute` requirements.

Existing host settings are never overwritten. To enable the optional Claude hooks,
merge only the desired entries from `scripts/hooks/claude-hooks.example.json` into the
project's `.claude/settings.json`; its commands run the installed
`node_modules/playwright-pom-harness/scripts/hooks/guard.mjs`. Setup never enables them. Hook payload `cwd`
selects the consumer; session records stay in that consumer. Verify startup and state
placement. Hooks remain advisory/fail-open and are not execution-policy enforcement.

Legacy ADO commands accept `--project-root`; they keep their original legacy config
format and workflow. Configure them only for an authorized ADO workflow. Live ADO
writes and complete adapter restructuring are outside M3. The local-source route
operates without them.
