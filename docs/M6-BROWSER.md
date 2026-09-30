# M6: sequential browser integration

The [browser library](../scripts/lib/browser/index.mjs) connects the pinned official
Playwright CLI to M5 identities, capability decisions, attempt history, evidence,
effects and required session cleanup. It executes one browser scenario per run.
Call separate runs sequentially; parallel dispatch remains outside this milestone.

Browser mechanics follow the official `skills/playwright-cli/SKILL.md` installed
with `@playwright/cli`. Native argument arrays pass through unchanged. There is no
harness `navigate`, `click` or `fill` API, serialized browser command language, SQL
parser, host adapter or generic workflow engine.

## Installation and targets

Use Node 24 and the exact [M4 dependency graph](M4-PLAYWRIGHT-CLI.md). Install the
CLI and browser with the documented commands there. M6 reuses that installation
under `scripts/spikes/playwright-cli`; it does not install a second CLI, use a global
command, or fall back to floating `npx` dependencies. The version-specific adapter
checks all three package versions, the frozen lock hash and the effective native
profile. A version update must repeat the M4 gate before changing this adapter.

Add browser targets to existing consumer configuration by merging:

```json
{
  "environmentMode": "test",
  "apiTargets": [],
  "databaseTargets": [],
  "browserTargets": ["application"]
}
```

The corresponding entry in `.harness/targets.json` is:

```json
{
  "api": {},
  "databases": {},
  "browser": {
    "application": {"origins": ["https://app.example.test"]}
  }
}
```

Omitting browser configuration keeps existing consumers valid and grants no browser
target. `test` enables `browserReads`, `browserMutations` and `browserExploration`;
`protected` defaults to reads/exploration, with mutations explicitly enabled;
`custom` grants configured capabilities only. These are operation-intent capabilities,
shared by catalog, helper, inline and exploratory definitions. A catalog grants no
extra permission. Normal permitted writes do not prompt for harness approval.

Callbacks are trusted automation code. They must classify mixed or mutating work as
`browserMutations`. A read contract must establish absence of application effects;
an HTTP method, a navigation command or a command's success alone does not establish
replay safety. The adapter does not parse JavaScript or duplicate the CLI surface.
It guards direct destination arguments and applies native allowed origins with
service workers blocked. Native origin filtering is not a security sandbox and does
not cover every redirect or arbitrary code path. Host/network controls still apply.

## Using the library

1. Define browser operations with `defineOperation`: `family: "browser"`, a configured
   target, `browserReads` or `browserMutations`, source provenance and business intent.
2. Freeze those definitions, `browserLifecycleOperations(target)`, scope, environment
   and finite limits with `createRun`. Required expectations name their operation and
   invocation. Native session lifecycle operations are reserved for session ownership.
3. Call `runBrowserScenario(run, roots, options, async browser => { ... })` with fresh
   consumer `runRoot`, separate package/project roots and the selected target.
4. Await `browser.attempt({operation, invocationId, phase, inputs, retry}, callback)`.
   The phase defaults to `EXERCISE`; automatic retry defaults off. The callback uses
   `context.native(["goto", url])` or other native arguments from the official skill.
5. Record observations/assertions and effects, then await the result. The wrapper
   always attempts owned cleanup before M5 validates and derives the final verdict.

The attempt context provides harness responsibilities only:

| Function | Purpose |
|---|---|
| `native(args)` | Invoke the official CLI in the owned named session with bounded process output, deadline and cancellation |
| `evidence(kind, value)` | Register bounded sanitized JSON evidence with this attempt's identity and file integrity |
| `artifact(kind, filename, sanitize)` | Read a bounded native artifact from protected session storage and register explicitly sanitized bytes |
| `file(name)` | Get an owned protected filename for native artifact/state arguments; never serialize it as public evidence |
| `assertion(record)` | Record one frozen expectation's status, reliability and evidence references; an earlier assertion cannot be overwritten |
| `effect(record)` | Establish the operation's final known/uncertain effects after its last native command |
| `reconciliation(record)` | Associate explicit reconciliation facts and their actual proof artifacts |
| `output(record)` | Add a typed output with the actual producer identity |
| `selectOutput(reference)` | Select an existing typed output for the scenario result without changing its producer |
| `resource(record)` | Record business-resource ownership and lifecycle intent without inventing restoration requirements |
| `lifecycle(resourceId, update)` | Update an existing business resource's obligation from its actual cleanup/restoration attempt, preserving identity, ownership and intent |

The context exposes its attempt identity. `browser.ownership()` gives a copy of
owned process identities for diagnostics. It does not grant ownership of another
session. Native lifecycle/configuration overrides, dashboard commands and global close/kill commands
are refused. Attachment to existing browsers is disabled; borrowed-browser support
requires a separate proof.

Await every attempt, command and evidence operation. Parallel native commands and
attempts are refused.
Outstanding native work is accounted for before cleanup, and expired contexts cannot
dispatch more work or register evidence. Unawaited work prevents a clean pass.
Asynchronous callbacks, scenario bodies and artifact sanitizers share the applicable
deadline and cancellation window. Expired callbacks cannot register late evidence.
Synchronous JavaScript that blocks the event loop still requires host process limits.

## Failure, recovery and lifecycle

The M5 validators remain the verdict authority. Native process exit, JSON errors,
malformed replies, timeouts, cancellation and spawn failures are classified separately.
Per-attempt evidence records command names, classifications and dispatch facts without
persisting argument values, raw replies or local paths. Raw native replies remain
in-process; temporary native output stays protected.

Missing/unevaluated expectations remain explicit. Reliable assertion failures stay
`FAIL`, even when a later error or cleanup failure also occurs. A safely retried read
can finish `PASS` with `stability=recovered`; every attempt and native failure remains
in its evidence. M5 checks retry budgets, unchanged bindings, complete assertions,
earlier transitions and actual reconciliation files before replay.
If a body expires before reaching a known frozen invocation, that invocation records
its unevaluated expectations without claiming execution. Unknown exploratory
definitions are never invented to make an incomplete record pass validation.
A policy refusal can be recorded after expiry when authorization actually denies
the operation and the record establishes that it never executed. This does not
extend the deadline for permitted operations.

A dispatched mutation remains uncertain until the callback establishes its effects.
An effect claim made before a later native command does not cover that later command.
Uncertain transmitted work is not automatically replayed. Reconciliation cannot
substitute for a required response or observation that was lost.

Preparation verifies executable prerequisites before copying authentication state.
If acquiring fresh storage fails, it removes that owned storage before throwing.
The error's `preparation` receipt reports whether removal succeeded or remediation is
required; retained private material must be handled at the supplied consumer run root.
Precondition failures before acquisition create no run or browser result.

The owned browser session is a temporary harness resource and always has a cleanup
obligation. Business fixtures follow their own intent: temporary cleanup, guarded
restoration, intentional retention or no obligation. Before-state capture is optional.
An intentionally persistent business outcome can pass after the browser closes.
For a required business obligation, register the resource once in its originating
attempt. Its cleanup/restoration callback calls `lifecycle` with status and evidence
references; the wrapper supplies the current attempt identity. M5 verifies the same
resource association, successful cleanup and any required restoration guard.

Cleanup shares one finite scenario window, continues after ordinary cancellation,
and uses only recorded daemon/descendant identities. PID creation identity is checked
before forced termination. Global close/kill is never used. Cleanup failures remain
visible even if a later physical cleanup succeeds. If process ownership or stopping
cannot be established, protected runtime storage remains for remediation and no clean
pass is returned. Successful cleanup deletes temporary authentication and raw output.
An exhausted cleanup window records an unexecuted timeout and a failed obligation.
Any later scoped remediation has a separate receipt and leaves the failed run intact.

Pass an external `storageState` file only when restoration is intended. The adapter
copies it into protected owned storage, opens the destination named session and loads
it there. The source file is retained; the owned copy is removed at cleanup. The
scenario must verify actual authenticated behavior. Expired authentication does not
trigger an invented login or silent refresh.

## Evidence and validation

Native output and authentication files are kept under protected storage, with an
owner-only Windows ACL or mode 0700 on Linux. Native artifacts are never promoted
automatically: their producer must sanitize them. The core verifies every registered
artifact's association, required category, size, location and hash at assessment.
Structured-data checks cannot discover every secret inside text or images.

Run `npm run test:browser` for the focused contract/process tests. Run the opt-in live
proof with `npm run probe:browser -- <new-external-consumer-directory>` after installing
the pinned browser. It uses a synthetic loopback application and no real accounts.
Keep output outside the installed package and use a fresh directory each time.

The same proof can run in the existing pinned Linux image with a sanitized source
archive, the image's installed dependency graph, protected consumer output, `--init`,
`--network none` and no published ports. This is a container proof, not a physical
Linux-host or production sandbox claim. The Linux root/headless profile disables the
Chromium sandbox inside that container.

See [M6 validation](M6-VALIDATION.md) for actual counts, failures and review status.
API/DB executors, combined execution, full host parity, reporting integration, visual
testing and concurrency remain later milestones.
