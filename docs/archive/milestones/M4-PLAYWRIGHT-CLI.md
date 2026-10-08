> Historical record. Read the [current documentation](../../contributing.md) for present behavior. Statements and validation results below describe their original implementation period.

# M4: pinned official CLI viability spike

M4 is a development experiment, not a harness executor. The official
[Microsoft Playwright CLI](https://github.com/microsoft/playwright-cli) and its
installed `skills/playwright-cli/SKILL.md` own browser mechanics. The fixed probe
uses native commands directly. It does not define another navigation/click/fill
language, dispatch consumer scenarios, or integrate the execution core.

## Exact tested dependency graph

The separate [spike manifest](../../../scripts/spikes/playwright-cli/package.json) and
[lockfile](../../../scripts/spikes/playwright-cli/package-lock.json) pin:

| Package/component | Version |
|---|---|
| `@playwright/cli` | 0.1.22 |
| `playwright` and `playwright-core` | 1.64.0-alpha-1790635538000 |
| Chrome for Testing | 155.0.8059.12, Chromium revision 1247 |
| Node runtime family | 24 |

The transitive Playwright build is an alpha. The viability decision applies to this
exact resolved graph and invocation profile, not arbitrary CLI updates. Install with
`npm ci`, retain registry integrity values, and repeat the spike before changing pins.
These dependencies are installed separately and excluded from source publication.
No global CLI installation or `npx` fallback to a floating version is used.
Scoped Git attributes preserve LF in the spike lockfile on both platforms, so
checkout newline conversion cannot change its frozen byte fingerprint. npm retains
the lockfile and scoped Git attributes, and omits `.npmignore` controls.

## Native profile preflight

The fixed spike refuses inherited `PLAYWRIGHT_MCP_*`, `PLAYWRIGHT_CLI_*` and
`PWTEST_*` settings and any existing native global CLI configuration. It checks
existence without reading configuration or authentication values. A refusal exits
with `BLOCKED` before creating a run or launching a browser; use a neutral account
or environment for this development experiment. Existing user configuration is
never moved, deleted or rewritten.

Child CLI processes receive a frozen allowlist of necessary system settings plus
the configured browser installation path and noninteractive flags. The exact
pinned native configuration resolver verifies isolated, owned, headless Chromium,
the pinned channel, timeouts and protected evidence location before launch and
again before each `open`. Its version-specific resolver is used only for this M4
preflight; browser mechanics still use public CLI commands. A pin update must
revalidate this internal inspection point as part of the spike.

## Native invocation findings

- Spawn the installed CLI entrypoint using Node, `shell: false` and an argument array.
  This preserves paths with spaces and URLs containing `&` on Windows.
- Set `CI=1` and `NO_UPDATE_NOTIFIER=1` for every process. An initial Windows help
  invocation without these flags encountered a Node/libuv assertion. The supported
  package flags disable its update notifier; vendor source was not patched. The
  noninteractive profile passed subsequent complete probes.
- Use `--json` and explicit `-s=<owned-name>` for operations. Native errors can be
  represented in JSON and/or a nonzero process exit. Neither is a successful result.
  Deadline expiry, spawn failure and malformed JSON remain distinct probe failures.
- This version's `eval` response has a JSON-encoded value inside `result`. Decode
  that value only after the surrounding native reply has passed error/exit checks.
- Open the destination named session before `state-load`; then navigate and verify
  authentication in that session. A saved file alone does not prove restoration.
- Native snapshots supply current references. A removed-element reference fails;
  obtain a new snapshot before interacting with its replacement.
- Native tracing produces `.trace`, `.network` and resource files, not an assumed
  single ZIP. Validate the actual files, content, relative association and hashes.
- Killing a command process does not cancel its session daemon. After an outer
  deadline, stop only its recorded owned daemon/browser descendants, using process
  identity checks, and clean up that named session. Global `close-all` and `kill-all`
  are never used. Native close and repeated close are separately tested.

## Future integration boundary

Keep CLI process invocation and version-specific reply interpretation in one narrow
integration module when browser integration is authorized. That module translates
native process/daemon observations into shared harness results; it does not publish
another browser API. Agents continue to use the official skill/capabilities.

The later harness browser layer owns run/session identity, ownership, policy,
attempt history, evidence registration and required cleanup. Its intent records may
describe expected observations and evidence requirements, without reproducing the
CLI command surface. No M5 contracts or M6 executor are implemented by this spike.

## Reproduce the checks

From the package root on Windows, with Node 24:

```powershell
npm ci --prefix scripts/spikes/playwright-cli --ignore-scripts
$env:CI='1'
$env:NO_UPDATE_NOTIFIER='1'
$env:PLAYWRIGHT_BROWSERS_PATH=Join-Path (Get-Location) '.validation/m4/browsers-win32'
node scripts/spikes/playwright-cli/node_modules/playwright/cli.js install chromium
npm run probe:cli -- '.validation/m4/windows/final/run with spaces'
```

Use a new output directory for each attempt; existing run directories are refused.
Inside a development checkout, only Git-ignored `.validation/m4` storage is
permitted. Other output must be outside the complete installed harness package.
Both lexical paths and resolved ancestry are checked before creating directories;
aliases cannot redirect output into package `docs`, `scripts`, skills or other
source content. The standalone container permits external output only. Package
immutability covers all publication-source files and the spike's installed native
dependencies; private recovery and runtime storage are excluded from hashing.
The probe restricts Windows ACLs to the executing account and Linux directories to
mode 0700. Authentication state is synthetic, stored privately, and deleted during
cleanup. Never use this fixture as a place for real credentials.

The Linux proof uses the [Dockerfile](../../../scripts/spikes/playwright-cli/Dockerfile),
whose official Node Debian base is pinned by digest. It installs the same npm lock
and Playwright browser revision. Its root/headless profile disables the Chromium
sandbox; this is a contained test profile, not a production sandbox proof.

```powershell
docker build --tag playwright-harness-m4:0.1.22 scripts/spikes/playwright-cli
$m4Output=Join-Path (Get-Location) '.validation/m4/linux/final'
New-Item -ItemType Directory -Path $m4Output | Out-Null
$m4Owner=(whoami).Trim()
icacls $m4Output /inheritance:r /grant:r "${m4Owner}:(OI)(CI)F"
docker run --rm --init --network none --shm-size=1g --mount "type=bind,source=$m4Output,target=/evidence" playwright-harness-m4:0.1.22 '/evidence/run with spaces'
```

The container has no external network during the probe. Its synthetic application
binds loopback on a random port; no ports are published. Only the private ignored
evidence directory is mounted. `--init` reaps exited descendants.

```sh
npm run test:cli-spike
node scripts/spikes/playwright-cli/assess.mjs '.validation/m4/windows/final/run with spaces/report.json' '.validation/m4/linux/final/run with spaces/report.json'
```

The offline assessor requires both distinct platforms, all thirteen checks, explicit
identical version/lock pins, nonempty coherent native command history covering the
fixed success/error/deadline probes, complete cleanup facts and valid artifact
integrity. It also requires the fixed screenshot and initial reference snapshot,
native DOM trace observations and the associated network evidence. Missing required
categories, truncated/malformed content and matching hashes for unrelated content
cannot satisfy the evidence gate. Unit fixtures test rejection of empty, failed and incomplete receipts;
they are not browser integration evidence.
Actual outcomes and counts are in [M4 validation](M4-VALIDATION.md).

Install the separate spike dependencies with `npm ci` before running
`npm run test:cli-spike` or the complete package test suite. The focused profile
tests inspect the installed pinned native resolver using synthetic configuration;
they do not launch browsers or read actual user configuration.

Two development-only fixed fault injections exercise finalization:
`M4_PROBE_FAULT=sentinel-crash` kills the owned sentinel daemon;
`M4_PROBE_FAULT=cleanup-failure` injects one close-stage exception. Their expected
outcome is an **INCOMPLETE** receipt, while scoped process/data cleanup, temporary
auth deletion and fixture closure still proceed. Do not enable these flags for a
positive viability run. Cleanup errors remain failures and are never retried to green.

## Gate and deliberate scope limits

Mandatory failures or unavailable platforms leave the viability gate incomplete.
Compare equivalent observations and failure behavior, not artifact filenames, IDs,
durations or hashes between platforms. Each receipt validates its own artifacts.

This spike supports owned, isolated, headless Chromium sessions only. Attachment is
disabled: no CDP or extension attachment is enabled or claimed. Before adding that
capability, separately prove borrowed-resource detach/retention on both platforms.
Firefox/WebKit, headed desktop flows, independent physical Linux hosts, real SSO,
production sandbox configurations, visual testing and host orchestration were not
tested. Sequential executor integration and all later milestones remain deferred.
