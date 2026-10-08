> Historical record. Read the [current documentation](../../contributing.md) for present behavior. Statements and validation results below describe their original implementation period.

# M4 validation record

The original implementation and review history below are retained. A subsequent
independent Astra review found three blocking defects. Their corrective validation
and current acceptance status are recorded in [M4 review resolution](M4-REVIEW-RESOLUTION.md).
The earlier approval below is historical and does not approve those later repairs.
A later Windows process-tree correction and its re-run are recorded at the
[end of this record](#later-correction-windows-process-tree-adoption).

Scope: focused official Playwright CLI viability spike, 2026-09-30. No execution
core, browser executor, API/DB runtime, parallel harness dispatcher or new host
adapter was implemented. M1–M3 history is retained on the existing `main` branch.

## Gate result

The owned, isolated, headless Chromium CLI gate passes for the exact pinned graph
and noninteractive profile in [the spike guide](M4-PLAYWRIGHT-CLI.md).

| Check | Windows | Linux | Observable proof |
|---|---|---|---|
| Exact versions and lock | PASS | PASS | CLI version and all three installed package versions match; same lock SHA-256 |
| Named session isolation | PASS | PASS | Different daemons; URL query with `&` retained; paths with spaces work |
| Storage-state restoration | PASS | PASS | HttpOnly cookie and local storage restore into a new named session; exactly one fixture login; reloaded sentinel remains unauthenticated |
| Current snapshot references | PASS | PASS | Fresh reference works; removed-element reference fails; replacement works from a new snapshot |
| Evidence | PASS | PASS | Valid PNG signature, nonempty snapshots, trace DOM/network/resources, relative artifact associations and hashes |
| Native error/exit behavior | PASS | PASS | Unknown command, absent target, evaluation failure and closed session are failures |
| Native timeout | PASS | PASS | Navigation timeout is explicit; subsequent read navigation works without erasing failure |
| Outer process deadline | PASS | PASS | Dispatch confirmed before expiry; owned daemon/browser descendants explicitly stopped |
| Daemon crash | PASS | PASS | Killed owned daemon fails; scoped cleanup and explicit fresh reopen verified |
| Stale authentication | PASS | PASS | Server-revoked saved session requires sign-in; no hidden refresh/login |
| Owned cleanup | PASS | PASS | Five owned session names cleaned; sentinel survives other cleanup; repeated close succeeds; temporary auth file deleted |
| Package immutability | PASS | PASS | Before/after content digests match, including installed dependencies |

Final Windows attempt: **12/12 checks, 68 native commands, 22 registered artifacts,
211 package/dependency files hashed**. Final Linux attempt: **12/12 checks, 68 native
commands, 22 registered artifacts, 199 package/dependency files hashed**. Platform
package file counts differ because the container copies only the spike's runtime
files and npm creates platform-specific launchers.

Offline cross-platform receipt assessment: **PASS**, identical CLI/Playwright/lock
pins, both platforms present, and all **44** registered artifacts individually
verified for nonzero length and matching SHA-256. Artifact hashes, filenames and
process identities are not compared between platforms.

## Actual platform and invocation

- Windows 11 Pro 10.0.22631, x64; Node **24.15.0**.
- Real Linux amd64 Debian Bookworm userspace in Docker Desktop's WSL2 Linux engine;
  kernel 5.15.167.4-microsoft-standard-WSL2; Node **24.21.0**. This is a Linux
  container proof, not an independent physical Linux-host test.
- CLI **0.1.22**; Playwright/Core **1.64.0-alpha-1790635538000**; Chrome for Testing
  **155.0.8059.12**, Chromium revision **1247**. All npm graph integrity values are
  locked. Browser binaries were installed by that pinned Playwright build.
- Lock SHA-256: `1292f67fda12e1e1beb43fdea946639daefc581a6198d1500fbd7860dbc7f5f2`.
- Official Node base image digest:
  `sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`.
- Final locally built image ID:
  `sha256:d84ef239e86f60dbc350a6106afc40428e073a286c6041c075b054310627fe82`.
  The base is pinned; OS packages downloaded during the build are not independently
  frozen. This local image ID identifies the executed build, not a published image.
- Every command uses `CI=1`, `NO_UPDATE_NOTIFIER=1`, `--json`, an explicit owned
  session and argument-array process invocation. Native config selects isolated
  headless Chromium, action timeout **1200 ms**, navigation timeout **1800 ms**.
- Outer-deadline probe expires after **1800 ms**, following confirmed fixture
  dispatch. Process cleanup checks PID plus creation identity before termination.
- Linux root/headless config explicitly disables the Chromium sandbox. Container
  probe execution uses `--init --network none --shm-size=1g`; no host ports, browsers
  or unrelated directories are exposed.

## Commands executed and attempt accounting

Commands below use paths relative to the package, avoiding machine-specific source
paths. Raw process replies, failed receipts and synthetic evidence remain privately
restricted in ignored `.validation/m4`; authentication-state files were deleted.

```powershell
npm install --prefix scripts/spikes/playwright-cli --ignore-scripts
node scripts/spikes/playwright-cli/node_modules/playwright/cli.js install chromium
node scripts/spikes/playwright-cli/probe.mjs '.validation/m4/windows/attempt-04/run with spaces'
docker build --quiet --tag playwright-harness-m4:0.1.22 scripts/spikes/playwright-cli
docker run --rm --init --network none --shm-size=1g --mount "type=bind,source=$m4LinuxOutput,target=/evidence" playwright-harness-m4:0.1.22 '/evidence/run with spaces'
node scripts/spikes/playwright-cli/assess.mjs '.validation/m4/windows/attempt-04/run with spaces/report.json' '.validation/m4/linux/attempt-03/run with spaces/report.json'
```

The initial install produced the committed lock and resolved three dependencies;
subsequent Linux builds used `npm ci --ignore-scripts`. The probe sets notifier/CI
flags itself; Windows browser install used the private browser path shown in the
guide. `$m4LinuxOutput` referenced `.validation/m4/linux/attempt-03`, whose host ACL
was restricted before mounting. No live application accounts or credentials were used.

Attempt history is preserved:

1. Initial Windows `--help` without the noninteractive flags encountered the
   `UV_HANDLE_CLOSING` assertion. Package-supported notifier flags were then applied.
2. Windows smoke: version, open, snapshot, missing-target error and scoped close
   passed. This five-command smoke was not counted as complete integration proof.
3. Windows attempt 01: **6/12 PASS; INCOMPLETE**. The fixed probe incorrectly treated
   native `eval`'s serialized JSON string as the business value. Dependent assertions
   failed. No failed receipt was overwritten or counted as green.
4. Windows attempt 02 and Linux attempt 01: **12/12 PASS each**, before stronger
   sentinel reload and deadline-tree termination assertions were added.
5. Windows attempt 03 and Linux attempt 02: **12/12 PASS each**, including stronger
   deadline termination and sentinel reload; their artifact integrity passed. Later
   review still found failure-finalization and empty-history receipt gaps.
6. An initial assessor unit-test path used an encoded URL pathname in a directory
   with spaces: **8/9 PASS**. It was corrected to `fileURLToPath`; the final unit
   suite passed. Negative tests were rerun after that fix.
7. First independent review: **CHANGES-REQUIRED**. It found that failed sentinel
   observation skipped native cleanup, an empty execution history could pass the
   offline gate, and output validation created intermediate package directories
   before rejecting a path. All three findings were fixed without a lifecycle engine.
8. Fixed negative probes: Windows `sentinel-crash` and Linux `cleanup-failure`
   each finish **11/12 PASS; INCOMPLETE**, with one preserved failure. Both receipts
   prove five owned process trees stopped, auth state deleted, fixture closed and
   receipt creation completed. Windows issued 68 commands; Linux issued 67 because
   the fault injects a close-stage exception before that invocation. These failed
   receipts do not count as positive platform proofs.
9. The output-containment junction unit initially encountered Windows teardown
   failure. Explicitly unlinking its junction before removing its target fixed
   teardown; the complete 15-test assessor suite then passed.
10. Windows attempt 04 and Linux attempt 03: final revised probe, including independent
    cleanup and strict receipt-history checks. Their final results are the gate counts
    reported above.

## Package checks and independent review

| Actual command | Result | Effective scope |
|---|---|---|
| `npm run check:syntax` | PASS | 32 JavaScript sources |
| `npm run check:json` | PASS | 19 JSON/JSONL files, 18 parsed records; parsing, not schema validation |
| `npm run check:links` | PASS | 80 Markdown files, 326 local links; anchors/remote links unperformed |
| `npm run check:conventions` | PASS | 15 example files, 60 rule applications, zero new FAIL/WARN or legacy findings |
| `npm test` | PASS | 133/133 unit tests, zero skips; includes all 26 convention rules' positive/negative fixtures |
| `node --test harness-tests/cli-spike-assessment.test.mjs` | PASS | 15/15 focused assessor/boundary tests; not browser integration |
| `npm run test:fetch` | PASS | 15 self-test checks, three parsed nodes; no live ADO call |
| `npm run typecheck:examples` | PASS | Configured example project, 18 local TypeScript sources; no emit |
| `npm run check:privacy` | PASS | 161 publication candidates, zero findings |
| `npm run check:secrets` | PASS | 161 publication candidates, zero redacted-pattern findings |
| `npm run check:provenance` | PASS | 161 candidates, 153 dependency records: 150 examples plus three spike dependencies |
| `npm run check:publication` | PASS | 161 candidate files, 158 packed files, no dependencies/private runtime content |
| Offline final platform receipt assessment | PASS | Both final 12-check/68-command receipts; 44 registered artifacts verified |

The first publication inspection **failed** because npm included nested spike
`node_modules` under the root `scripts` allowlist. A scoped `.npmignore` fixed the
actual package contents; the checker was not weakened. The subsequent dry run
passed with dependency implementations and official skills excluded. No archive
was published. Source counts came from filesystem inventory; an optional compiler
API import for counting was unavailable, while the configured compiler CLI passed.
Scoped Git attributes then preserved the lockfile's LF bytes across Windows/Linux
checkouts. This metadata-only packaging fix does not change the browser probe or
its executed file counts. Actual npm pack inspection and negative fixtures verify
that Git attributes remain included and dependencies remain excluded.

Independent review through [the canonical framework-review skill](../../../.agents/skills/framework-review/SKILL.md)
initially returned CHANGES-REQUIRED, with the three confirmed findings recorded in
the attempt history. Targeted re-review returned **APPROVE**, no remaining findings
or unproven questions, and verified both negative receipts and both final positive
platform receipts. The review ledger stays in ignored consumer-style local state.
Changed POM scope is N/A; the 15-file mechanical baseline has meaningful nonzero
coverage. No baseline or convention rule was weakened.

No unavailable or unperformed integration is represented by unit tests, JSON parsing
or an npm process exit alone. All previous commits remain intact; Git delivery to
the already-authorized repository preserves the single `main` branch and history.

## Unperformed checks and remaining dependencies

Attachment is **disabled** in the owned-only scope. Borrowed CDP/extension detach
and browser retention are **UNPERFORMED**, a mandatory prerequisite if attachment
is later enabled. Firefox, WebKit, headed desktop operation, real SSO, production
sandbox behavior, native Claude/Codex orchestration and independent physical Linux
hosts are **UNPERFORMED**. M4 does not claim those capabilities or full host parity.

Original material remains owner-cleared for MIT. The three separately installed
Apache-2.0 packages' licenses/notices were inspected and their resolved provenance
added to the audit. Official skills, dependency implementations, browsers, container
images and runtime evidence are excluded from the source distribution. Container or
binary redistribution would require a separate distribution audit.

Historical credential values remain removed. Revocation/rotation status is still
**UNRESOLVED**, per the owner's stated status; no credential validity was tested.
Existing protected recovery records remain excluded and were not read or copied.

Stop at M4: the minimal core and executors remain planned and require the next
implementation authorization. No release, tag, merge or new public repository is
part of this spike.

## Later correction: Windows process-tree adoption

On 2026-10-02 the probe's owned-tree helpers were corrected: a process is adopted as
a descendant only when it was created no earlier than its parent. Windows keeps an
exited parent's PID on its children and reuses PIDs, so the original helpers could
adopt an older, unrelated process and stop it during cleanup. The same defect caused
intermittent hosted Windows failures in the production browser runtime, which
received the same rule ([M6](M6-BROWSER.md)).

Windows re-run after the correction: **13/13 checks, 68 native commands, 22
registered artifacts, 529 package/dependency files hashed**. All five owned session
trees stopped and the sentinel survived. Linux was not re-run; it re-parents orphans,
so the rule does not change its trees. The results above remain historical.
