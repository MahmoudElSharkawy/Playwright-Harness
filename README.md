# Playwright POM Harness

Conventions, skills and tools that help Claude Code and Codex write and maintain
Playwright/TypeScript Page Object Model test automation in your project. Start
from local scenarios or Azure DevOps cases, explore the application, then obtain
reviewed code and two scoped green runs. You can also execute ADO manual cases
and produce verified reports without generating automation.

The harness fits teams starting a test project or extending an existing one. It
preserves your code and customizations, keeps test data outside business classes,
and organizes UI, API and database testing into clear layers. Azure DevOps is
optional for local automation. Version: [VERSION](VERSION); changes and upgrade
actions: [CHANGELOG.md](CHANGELOG.md).

## Expected automation structure

This is the POM structure the harness helps you author in **your project**. Names
are illustrative; API/DB layers and team libraries are used only when needed.

```text
your-test-project/
├── tests/                          # Specs orchestrate business flows
│   └── LoginTests.spec.ts          # May also be grouped one folder deep
├── src/
│   ├── pages/                      # UI locators, actions and validations
│   │   └── LoginPage.ts
│   ├── apis/                       # Optional API business services: Apis<Domain>
│   ├── dbs/                        # Optional DB business services: Dbs<Domain>
│   ├── utils/                      # Technical facades, assertions and reporting
│   └── config/                     # Environment coordinates and runtime settings
├── resources/
│   ├── testData/
│   │   └── LoginTestJsonFile.json  # One paired JSON per spec
│   ├── apisCollections/            # Team API knowledge; derive-only
│   └── Queries/                    # Team SQL knowledge; derive-only
├── .harness/                       # Consumer-owned configuration and workflow state
│   ├── vendor/                     # Committed release archive
│   ├── sources/                    # Versioned local scenarios
│   ├── project.json                # Selected environments
│   ├── targets.json                # Destinations and secret references
│   └── runs/                       # Generated evidence (ignored)
├── .agents/skills/                 # Codex links to the installed skills
├── .claude/skills/                 # Claude Code links to the same skills
├── AGENTS.md / CLAUDE.md           # Your instructions plus a managed harness block
├── playwright.config.ts           # Test runner and reporters
├── global-setup.ts                 # Run hygiene, not business setup
├── .env                           # Local secrets (ignored)
└── reports/                        # Generated reports (ignored)
```

Specs call page and service methods; those methods use technical utilities.
Shared behavior uses composition, with no base page classes. Setup supplies a
minimal configuration-and-utilities starter when Playwright is absent. Pages,
services, specs and paired data are created or reused for the scenarios you
automate. See [architecture](docs/architecture.md) for ownership, optional layers
and code conventions.

<a id="components-and-compatibility"></a>

## Harness structure

This repository supplies the reusable harness. Its internal tests and examples
are separate from the application tests in your project.

```text
Playwright-Harness/
├── .agents/skills/                 # Canonical conventions and workflow skills
│   └── <skill>/                    # SKILL.md, references and optional templates
├── .claude/skills/                 # Compatibility entrypoints for the same library
├── .claude-plugin/plugin.json      # Native Claude plugin packaging for proofs
├── scripts/
│   ├── cli.mjs                     # pom-harness command entrypoint
│   ├── lib/                        # Adoption, execution, generation and reporting
│   ├── hooks/                      # Optional advisory host hooks
│   ├── ci/                         # Package and installed-consumer gates
│   └── probes/                     # Opt-in live validation fixtures
├── harness-tests/                  # Harness regression tests and fixtures
├── examples/                       # Starter source and illustrative POM code
├── resources/                      # Team-library contracts
├── docs/                           # Task guides, references and historical archive
├── .github/workflows/              # Harness validation CI
├── AGENTS.md / CLAUDE.md            # Repository and agent instructions
├── package.json / npm-shrinkwrap.json # Package interface and locked dependencies
└── VERSION / CHANGELOG.md          # Release version and upgrade actions
```

Installation adds an exact development dependency to your project and links
skills for both hosts. The installed package stays immutable; your configuration,
code, knowledge and run outputs belong to your project. Hooks are optional and
setup does not enable them.

## Get started

You need **Node 24**, git, and Claude Code or Codex. Open your project and ask:

1. **"Install the harness from https://github.com/MahmoudElSharkawy/Playwright-Harness."**
   The agent resolves one release, verifies its checksum and runs setup. Review
   the diff. Reload skills in Claude Code or restart Codex if discovery needs refreshing.
2. **"Here is my project information; configure the harness and use it."**
   Supply application URLs and environments, plus any API/DB targets you need.
   The agent asks whether runs may change data in each environment, records the
   approved modes, and adds empty `.env` keys for you to fill in.
3. **Choose a workflow below.** The agent uses the matching skills and configured targets.

Without AI, download the archive and checksum from the
[latest release](https://github.com/MahmoudElSharkawy/Playwright-Harness/releases/latest),
verify them, then run from your project:

```sh
npx --yes --package "<full path to the .tgz>" pom-harness setup
npx --no pom-harness check
```

Teammates and CI use `npm ci` to install the committed archive and restore skill
links. For updates, ask **"Update the harness and preserve my project customizations."**
See [getting started](docs/getting-started.md) for installation details, readiness,
conflict recovery and rollback.

<a id="how-automation-works"></a>
<a id="capabilities"></a>

## Choose your first workflow

Generate durable automation from local scenarios or configured ADO cases:

```text
/automate-test local .harness/sources/<name>.json on qa
/automate-test suite <id> [plan <id>] on qa
/automate-test story <id> on qa
```

The [automation workflow](docs/PIPELINE.md) preserves scenario expectations through
exploration, POM authoring, independent review and two separate scoped green runs.
Required cleanup follows scenario intent and ownership. Repairs have three cumulative
rounds per source batch; PR delivery or ADO publication needs explicit authorization.

For live manual execution of ADO cases:

```text
/execute-test suite <id> [plan <id>] [on qa]
/execute-test story <id> [on qa]
```

The [manual execution guide](docs/manual-execution.md) covers verified dashboards,
evidence and defect lists, with optional bug filing and suite outcome publication.

<a id="package-validation-and-release"></a>

## Documentation

| Need | Guide |
|---|---|
| Configure environments, targets, secrets and knowledge | [Configuration](docs/configuration.md) |
| Connect ADO, retrieve cases or deliver results | [Azure DevOps](docs/azure-devops.md) |
| Find reports, Allure and plan progress | [Reporting](docs/reporting.md) |
| Understand shared runtimes or develop the harness | [Documentation hub](docs/README.md) · [Contributing](docs/contributing.md) |
| Inspect dated implementation and validation records | [Archive](docs/archive/README.md) |

See [security](SECURITY.md), [provenance](docs/PROVENANCE.md), and the
[license](LICENSE) for protection and distribution guidance.

## For AI agents

<details>
<summary>Installation and update protocol for agents</summary>

Once installed, follow the `harness-setup` skill. To install or update:

1. Resolve "latest" to one release tag: `tag_name` from
   `https://api.github.com/repos/MahmoudElSharkawy/Playwright-Harness/releases/latest`,
   or the tag the user named.
2. From that same tag, download `playwright-pom-harness-<version>.tgz` and
   `playwright-pom-harness-<version>.tgz.sha256` into the project folder:
   `https://github.com/MahmoudElSharkawy/Playwright-Harness/releases/download/<tag>/<file>`.
3. Verify the archive's SHA-256 against the `.sha256` file.
4. From the project folder, run `npx --yes --package "<absolute path to the .tgz>" pom-harness setup`.
   Never use a bare path.
5. Show the summary and `git status`. If setup stopped, show its reasons and ask the
   user; never work around them.
6. If the skills are not listed yet, ask the user to run `/reload-skills` in Claude Code,
   or to restart Codex.

Rules:

- Never extract the archive or copy package files by hand. Never ask for secret values:
  secrets go into empty `.env` keys that the user fills in.
- In Codex, approve network access and the npm cache for the download and the install.
- Preserve the project's instructions, code, settings and imported team libraries.
  Files in `resources/Queries` and `resources/apisCollections` are derive-only sources.
- `VERSION` and `CHANGELOG.md` belong to the harness; a project never bumps them.
- Changes to a project's `scripts/conventions-baseline.json` need a team decision.
- `npx --no pom-harness check` reports readiness. A link is not proof that a host loaded
  a skill: confirm that the skill is discovered in the actual host.
- Commit, push, publish or deliver only with the user's authorization.

</details>
