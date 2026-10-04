---
name: harness-setup
description: "Use when installing, updating, repairing, configuring or rolling back the Playwright POM harness in a project — \"install the harness from <repository>\", \"update the harness and preserve my customizations\", \"here is my project information; configure the harness\", adding an environment, application URL, API or database target, Azure DevOps, secrets or a CI pipeline, or when the harness skills are missing."
---

# Harness setup

Resolve this skill to its real path before following references. Read the
[package and consumer boundaries](../ROOTS.md); mutable state belongs to the consumer.

Three requests cover the harness lifecycle. Follow
[references/playbook.md](references/playbook.md) for each:

1. **Install or update** — download one release, verify it, run `setup`, report the
   summary and the diff (§1).
2. **Configure** — turn the user's project information into harness configuration,
   empty secret keys and CI steps, then report `check` (§2–§3).
3. **Roll back** — detach the links, revert the commit, reinstall (§5).

Hard rules:

- Never extract the archive or copy package files into the project; `setup` does
  every change and stops, before writing, on anything it cannot merge safely.
- Never ask for, read, print or write a secret value. Add empty keys with
  `npx --no pom-harness check --add-env-keys` and let the user fill them in.
- Report setup stops and conflicts as they are and ask the user; never work around
  them by deleting or overwriting project files.
- After installation, run every command as the project's own installation:
  `npx --no pom-harness <command>` from the project folder.

## Boundaries

- Where framework code belongs, and the layer skills → [pom-architecture](../pom-architecture/SKILL.md)
- How `src/config` consumes the configured targets → [test-data](../test-data/SKILL.md)
- Automating story-linked cases, a suite or local scenarios once the harness is configured → [automate-test](../automate-test/SKILL.md)
