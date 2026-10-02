# For AI agents

This is the **Playwright POM Harness** — a portable, versioned Claude Code harness
(convention skill library + lifecycle hooks + ADO pipeline scripts) for
Playwright/TypeScript Page-Object-Model test-automation repos.

If you are an AI agent asked to install, configure or update this harness in a project:
follow the **"For AI agents"** section of [README.md](README.md) exactly. It resolves one
release tag, downloads and verifies the archive, and runs
`npx --yes --package "<archive>" pom-harness setup`. After installation, follow the
`harness-setup` skill to configure, update or roll back.

After adoption, the managed block in the project's `AGENTS.md` and `CLAUDE.md`, plus the
skills linked under `.claude/skills/` and `.agents/skills/`, become your operating
contract there: skill-first routing for every framework task, the ongoing feature branch,
delivery through pull requests.
