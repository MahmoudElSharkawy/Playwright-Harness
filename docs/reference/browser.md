# Browser runtime

The browser library connects the pinned official Playwright CLI to the shared
[execution model](execution-model.md): owned sessions, policy, attempts, evidence,
effects and cleanup. Browser mechanics come from the official
`skills/playwright-cli/SKILL.md` installed with `@playwright/cli`. Native argument
arrays pass through a narrow adapter; there is no second navigation language.
Use [automation](../PIPELINE.md) for POM authoring or
[manual execution](../manual-execution.md) for the curated interactive protocol.

## Installation and targets

The native graph pins `@playwright/cli` 0.1.22, Playwright/Playwright Core
1.64.0-alpha-1790635538000 and Chrome for Testing 155.0.8059.12
(Chromium revision 1247). Claims apply to that graph; changing pins requires native
viability and integration checks. This exploration CLI pin is separate from the
generated-test verifier's Playwright Test pin.

Setup provisions matching Chromium; development checkouts use
`node scripts/ci/browsers.mjs`. Resolution uses the installed package without a
global/floating fallback. The fixed development probe refuses incompatible native
global configuration and inherited `PLAYWRIGHT_MCP_*`, `PLAYWRIGHT_CLI_*` or
`PWTEST_*` overrides without rewriting user settings.

Select a browser target through `browserTargets` in the environment; its `origins`
are explicit HTTP(S) origins. Optional `startUrl` and named user handles configure
manual login. See [configuration](../configuration.md). `test` permits reads,
mutations and exploration; protected mutations need explicit capability overrides.
Classify mixed/mutating callbacks as `browserMutations`. Callbacks are trusted code:
navigation, verbs and command success do not prove a read-only/replay contract.
Direct destinations/native allowed origins are checked and service workers blocked.
Origin filtering does not cover every redirect or arbitrary code path.

## Library protocol

Import `browserLifecycleOperations` and `runBrowserScenario` from
`playwright-pom-harness/scripts/lib/browser/index.mjs`. Freeze business definitions
and reserved lifecycle operations with `createRun` before acquiring a session.

```js
// run is a frozen single-scenario input with inspect and lifecycle operations.
// roots separates package/project storage from the fresh consumer run directory.
const result = await runBrowserScenario(run, roots,
  {target: 'application'}, async browser => {
    await browser.attempt({operation: inspect, invocationId: 'inspect-call'},
      async context => {
        const reply = await context.native(['goto', 'https://app.example.test/account']);
        await recordAccountObservation(context, reply);
      });
  });
```

The caller supplies `inspect` and grounded `recordAccountObservation`; this example
shows ownership wiring, not a fabricated assertion. An attempt defaults to `EXERCISE`
and `retry: false`; the mixed runner supplies its active phase.

| Context interface | Purpose |
|---|---|
| `native(args)` | Bounded CLI command in the owned named session |
| `evidence(kind, value)` | Register sanitized JSON with attempt identity |
| `artifact(kind, filename, sanitize)` | Promote explicitly sanitized protected bytes |
| `file(name)` | Obtain an owned protected filename, never public evidence |
| `assertion(record)` | Record a frozen expectation with reliability/evidence |
| `effect`, `reconciliation` | Record final effect certainty and actual proof |
| `output`, `selectOutput` | Produce/select typed values with provenance |
| `resource`, `lifecycle` | Record intent and associated lifecycle completion |

Await attempts, commands, evidence writes and sanitizers. Overlap, concurrent commands,
late context reuse and assertion overwrites are refused. Unawaited work prevents a
clean pass. `browser.ownership()` returns diagnostic owned-process identities.
The supported profile is owned, isolated, headless Chromium. Global close/kill,
session/config overrides, attaching an existing browser, borrowed-browser retention,
Firefox/WebKit and headed desktop behavior are outside this proven profile.

## Responses, evidence and recovery

The adapter launches the installed Node entrypoint with `shell: false`, argument
arrays, `CI=1`, `NO_UPDATE_NOTIFIER=1`, owned session names and JSON replies. Nonzero
exit and native JSON error fields both signal failure; malformed JSON, timeout,
spawn failure and cancellation retain distinct classifications. Pinned `eval`
contains another JSON-encoded result, decoded only after outer reply checks.

Refresh snapshots when refs become stale. Traces are `.trace`, `.network` and
resource files, not an assumed ZIP. Public command evidence retains command names,
classifications and dispatch facts, omitting arguments, raw replies and local paths.
Auth/raw output stays protected with Windows owner ACLs or Linux mode 0700.
Artifact promotion needs an explicit sanitizer; core integrity checks cannot detect
every secret in prose/images. See [reporting](../reporting.md) for native POM artifacts.

A dispatched mutation stays uncertain until effects are established after the last
command. An earlier effect claim does not cover a later command. Unknown effects
are never automatically replayed. Recovery checks unchanged complete history, finite
budgets and actual proof; reconciliation cannot replace a lost required observation.
Reliable failures remain FAIL after cleanup errors; a safely retried read may be
recovered PASS with all attempts retained.

## Owned cleanup and authentication

Acquisition checks prerequisites before copying auth. Preparation failure creates
no browser result; acquired storage gets a removal/remediation receipt. Optional
`storageState` is copied into protected owned storage: open the session, load it,
then navigate and verify authenticated behavior. The source stays intact and the
owned copy is removed. Expired auth does not invent login or refresh.

The browser always needs owned shutdown; business fixtures separately follow
temporary/restore/persistent/no-obligation intent. Cleanup uses the shared finite
window after ordinary cancellation. Killing a command does not stop its daemon.
Only recorded daemon/browser descendants may be stopped, with creation-identity
checks against PID reuse. Global close/kill is never used. Failed cleanup remains
failed even after later physical cleanup; uncertain ownership leaves protected
storage for remediation and preserves the original record.

## Manual host extensions

The live host uses curated commands, excluding raw JavaScript and global/session
controls. Bounded redacted replies are private communications, not evidence. Login
uses configured start URLs and user handles: username resolution stays host-side;
password aliases bind native protected secrets. Save/reuse needs an observed landmark
rechecked per scenario. Imported SSO/MFA state is supported. Reuse is execution-local;
report/stop removes saved state unless `--keep-login`, and cleanup removes native state.

Checks retain verified read artifacts/digests. Rendered text, form values and selected
dropdown labels use distinct readers. Open shadow roots/slots and unreadable frame
gaps are recorded; closed roots or incomplete coverage cannot establish absence,
equality or exact counts. Page-world evaluation is not tamper-proof. Visual judgment
needs screenshots. State changes stale refs and finalized PASSes; established FAILs
and preconditions remain historical. Ambiguity remains indeterminate.

Diagnostics default to end (last browser step and failed/indeterminate steps), with
per-step/off options. They retain console errors and failed/400+ request origin/path
without query values. End capture cannot recover logs cleared by earlier navigation.
`context.diagnostic` accepts console/requests only. Command errors/OUTPUT_LIMIT are
notices; timeout, cancellation and unavailability are execution failures. Diagnostics
never determine verdicts. Library `onBeforeExpire` closes dispatch and settles observed
evidence within a finite reserve; it starts no new action, diagnostic or screenshot.

Run `test:browser` or the native `probe:browser` with the pinned prerequisites in
[contributing](../contributing.md). Archived [CLI study](../archive/milestones/M4-PLAYWRIGHT-CLI.md),
[browser integration](../archive/milestones/M6-BROWSER.md) and
[manual execution validation](../archive/milestones/M19-VALIDATION.md) retain exact
reproduction and dated platform limits.
