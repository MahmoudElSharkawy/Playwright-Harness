# Harness and POM architecture

The harness is a reusable package of conventions, workflow skills and execution tools.
Your consumer project contains the application-specific Playwright automation it helps
you author. The two annotated layouts are shown in the [main README](../README.md).

## Harness source

| Location | Responsibility |
|---|---|
| `.agents/skills/` | Canonical routing, conventions, specialist playbooks and templates |
| `.claude/skills/` | Compatibility entrypoints to the canonical library |
| `.claude-plugin/plugin.json` | Native Claude plugin packaging used in proofs |
| `scripts/cli.mjs` | Installed `pom-harness` command entrypoint |
| `scripts/lib/` | Adoption, configuration, execution runtimes, generation, reporting and ADO adapters |
| `scripts/hooks/` | Optional advisory host hooks |
| `scripts/ci/` | Package, contract and installed-consumer checks |
| `scripts/probes/`, `scripts/spikes/` | Opt-in live proofs and focused experiments |
| `harness-tests/` | Synthetic regression fixtures and tests for the harness |
| `examples/` | Minimal starter source plus illustrative POM code |
| `resources/` | Team collection/query library contracts |
| `docs/` | Current guides and dated [archive](archive/README.md) |

## Consumer POM layers

| Location | What belongs here |
|---|---|
| `tests/` | Specs that orchestrate business flows and metadata; optionally grouped one folder deep |
| `src/pages/` | Page/skeleton-area locators, actions and `verify*` validations |
| `src/apis/` | Optional `Apis<Domain>` API business services |
| `src/dbs/` | Optional `Dbs<Domain>` DB business services |
| `src/utils/` | Technical interaction, transport, assertions, reporting and lifecycle mechanics |
| `src/config/` | Environment coordinates, timeouts and reporting configuration |
| `resources/testData/` | One paired JSON per spec: `LoginTests.spec.ts` → `LoginTestJsonFile.json` |
| `resources/apisCollections/`, `resources/Queries/` | Team knowledge used as immutable derive-only input |

Specs call business methods on page/service objects; those methods delegate technical
work to utilities. Business classes stay readable and straight-line. Shared behavior
uses composition, with no base page or service classes. Add a layer or method only
when a current test needs it. Setup creates configuration and utilities when Playwright
is absent, not a full tree of empty layers or demo tests.

Page classes organize locators, construction, actions and validations in the canonical
order. Actions name business operations and own Allure steps. Validations use `verify*`
names and the appropriate UI/API/DB observation layer. Tests use isolated Playwright
fixtures by default, explicit expected values, and unique per-case/per-run resources.
Setup and teardown remain ordinary hooks with scenario-appropriate cleanup and ownership.
Secrets remain local references; test inputs and expected values belong in paired data.

The [canonical design conventions](../.agents/skills/pom-architecture/references/design-conventions.md)
and owning specialist skills define the exact naming, class layout, locator priority,
metadata and code review rules. This guide explains their structure, without replacing
their checklists. Start framework work with the
[architecture skill](../.agents/skills/pom-architecture/SKILL.md), then follow its routing.

## Package and consumer ownership

Setup installs an exact archive dependency under the consumer's `node_modules` and
links each skill for both hosts. The package's skills, templates and scripts remain
immutable. The consumer owns code, configuration, local sources, reviewed knowledge,
candidate observations, reports and workflow state. Native discovery links share one
rule library; do not maintain host-specific copies.

Separate roots make this boundary explicit: `packageRoot` for immutable assets,
`projectRoot` for consumer files, and `runRoot` for consumer evidence. Never infer output
storage from a skill installation directory. Setup preserves custom rules and code,
preflights conflicts, and journals writes for recovery; see [getting started](getting-started.md).

## Workflows and shared runtimes

The [automation workflow](PIPELINE.md) loads local or ADO sources, preserves their
expectations through refinement and exploration, authors POM code, obtains independent
review and earns two scoped green runs. Generated POM tests run in the consumer's
Playwright framework. The exploration runtimes establish observations and evidence
before authoring; they are not a replacement framework for generated tests.

[Standalone manual execution](manual-execution.md) runs ADO suites/stories through
the same browser/API/DB runtime boundaries and produces verified reports without
generating code. [Execution contracts](reference/execution-model.md) own frozen scope,
typed values, effects, recovery, evidence and verdicts. The native Playwright CLI owns
browser mechanics; concrete HTTP and database adapters own their respective protocols.
There is no second browser command language or generic dependency-graph engine.

Sequential execution is the default. Explicit bounded batches can run independent
scenario lifecycles concurrently, including required cleanup and browser shutdown.
They do not change generated Playwright worker settings. Cleanup follows intent and
ownership: temporary fixtures need cleanup, explicit restoration needs guards, and
intentional persistent outcomes can remain.

## What checks establish

Mechanical convention checks cover a subset of the code rules; nonzero scope and
independent review still matter. Typechecking, test listing and empty tracker/report
output do not prove successful application execution. Evidence integrity checks
verify association and bytes; they cannot independently prove an observation truthful.

Optional host hooks are advisory and fail open. They do not enforce execution policy,
grant permissions or replace native-host proof. External ADO writes and source-control
delivery are separate authorized steps. See [hosts](reference/hosts.md),
[Azure DevOps](azure-devops.md), [reporting](reporting.md), and
[contributing](contributing.md) for the relevant operational boundaries.
