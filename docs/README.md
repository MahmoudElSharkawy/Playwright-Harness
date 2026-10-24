# Documentation

For a quick introduction, see the [harness workflow and phases](../README.md#harness-workflow-and-phases)
in the main README.

Start with [getting started](getting-started.md) to install and configure the
Playwright POM Harness in your own project. The [architecture guide](architecture.md)
explains how the harness and the automation it helps you author fit together.

## Adopt and use

| I want to… | Read |
|---|---|
| Install, check readiness, update or roll back | [Getting started](getting-started.md) |
| Understand the expected POM code and project ownership | [Architecture](architecture.md) |
| Configure environments, targets, secrets and project knowledge | [Configuration](configuration.md) |
| Retrieve or refresh project/application context with traceable sources | [Project context](project-context.md) |
| Review requirements in chat, preserve accepted/unresolved rules and approve story comments with requested team mentions | [Requirements analysis](requirements-analysis.md) |
| Design/revise cases from selected requirements, review complete coverage and publish approved ADO operations | [Test case design](test-case-design.md) |
| Draft/review a bug from story context or execution evidence, adapt project fields and deliver approved attachments | [Bug reporting](bug-reporting.md) |
| Identify affected areas and recommend regression scope for a story, bug fix or technical change | [Change impact analysis](impact-analysis.md) |
| Diagnose failures, repair automation or resume blocked tests | [Maintenance](maintenance.md) |
| Turn local scenarios or ADO cases into reviewed automation | [Automation workflow](PIPELINE.md) |
| Run ADO manual cases without generating code | [Manual execution](manual-execution.md) |
| Connect Azure DevOps and deliver results or code | [Azure DevOps integration](azure-devops.md) |
| Find reports, Allure output and plan progress | [Reporting](reporting.md) |

Automation accepts local scenarios, ADO suites and ADO stories. Standalone manual
execution currently accepts ADO suites and stories. Azure DevOps is optional for
local automation. The [workflow skills](../.agents/skills/README.md) route an agent
to the appropriate procedure and code conventions.

## Technical reference

These references explain the shared runtimes used during exploration and manual
execution. Generated POM tests use the consumer project's Playwright framework.

| Topic | Reference |
|---|---|
| Evidence, outcomes, effects, lifecycle and sequential/parallel execution | [Execution model](reference/execution-model.md) |
| Native CLI, owned sessions and browser evidence | [Browser runtime](reference/browser.md) |
| HTTP operations, credentials, bindings and recovery | [API runtime](reference/api.md) |
| SQL Server and PostgreSQL operations | [Database runtimes](reference/databases.md) |
| Claude Code, Codex and optional advisory hooks | [Hosts and hooks](reference/hosts.md) |

## Develop and maintain

- [Contributing](contributing.md): source setup, package checks, probes and native proofs.
- [Releasing](RELEASING.md): validate and publish a release archive.
- [Security](../SECURITY.md), [provenance](PROVENANCE.md) and
  [third-party notices](../THIRD_PARTY_NOTICES.md): protection and distribution boundaries.
- [Changelog](../CHANGELOG.md): version changes and upgrade actions.
- [Documentation archive](archive/README.md): dated milestone guides, validation
  records and research, with a map to the current documentation.

The topic guides describe current behavior. Archived records describe what was
implemented and verified at a particular time; they do not define today's capabilities.
