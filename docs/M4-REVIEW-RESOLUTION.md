# M4 review resolution

Scope: corrective work for the three findings raised against the original M4
implementation. The original commit and validation attempts remain preserved.
No execution core, executor, browser command language or M5 work is included.

## Corrections

| Finding | Correction |
|---|---|
| F1: inherited native configuration | Reject native environment overrides and existing global CLI configuration before any browser launch. Freeze a minimal child environment and inspect the exact pinned resolver's effective profile before every open. |
| F2: incomplete package boundary | Resolve the complete harness package, reject publication-source output before directory creation, and permit internal development output only under Git-ignored `.validation/m4` in an actual checkout. Check aliases and hash publication source as well as native dependencies. |
| F3: missing required evidence | Require the fixed screenshot, current-reference snapshot, native DOM trace and associated network evidence, in addition to each listed artifact's integrity. Reject missing categories and malformed or truncated content. |

Regression tests cover the original reproductions, native setting variants, global
configuration, output beneath sibling source directories, aliases, ineffective
ignore rules, and omission or corruption of individual evidence categories.
Offline fixtures are not browser integration proof. The native profile adds one
mandatory check, bringing the fixed live probe to thirteen checks.

## Acceptance

Independent Astra re-review returned **APPROVE** on 2026-09-30: F1–F3 are resolved,
the README prerequisite is corrected, and no unresolved findings or evidence gaps
remain for this scope. M4 is accepted for the pinned profile below. The
[spike guide](M4-PLAYWRIGHT-CLI.md) describes its preconditions and reproduction
commands. M5 and executor implementation have not started.

## Corrective validation results

All results were collected on 2026-09-30 against the corrective source frozen from
base commit `25319bcb67a43d0e448167309a9c35e86238a6b7`. The initial corrective diff
contained thirteen files, 371 additions and 32 deletions; its SHA-256 is
`5f9797559a52f623b1840f5dcdbb80dcb95195eea0f5992d9929c348b351baff`.
Subsequent changes only document these results and add the missing dependency
installation prerequisite to the README. Runtime source and tests remain unchanged.
The original implementation, failed attempts, independent review and corrective
receipts remain preserved in restricted, ignored validation storage.

| Actual command | Result | Effective scope |
|---|---|---|
| `npm run check:syntax` | PASS | 35 JavaScript sources |
| `npm run check:json` | PASS | 19 JSON/JSONL files, 18 records; parsing, not schema validation |
| `npm run check:links` | PASS | 81 Markdown files, 328 local links; anchors and remote links unperformed |
| `npm run check:conventions` | PASS | 15 example files, 60 rule applications, no FAIL, WARN or legacy findings |
| `npm run test:cli-spike` | PASS | 42 focused profile, boundary and evidence tests; no browser launches |
| `npm test` | PASS | 160 tests, zero failures or skips, including all 26 convention rules' positive/negative fixtures |
| `npm run test:fetch` | PASS | 15 self-test checks, three parsed nodes; no live ADO call |
| `npm run typecheck:examples` | PASS | Configured example project, 18 local TypeScript sources; no emit |
| `npm run check:privacy` | PASS | 165 publication candidates, zero findings |
| `npm run check:secrets` | PASS | 165 publication candidates, zero findings |
| `npm run check:provenance` | PASS | 165 candidates, 153 dependency records: 150 examples and three spike dependencies |
| `npm run check:publication` | PASS | 165 candidate files, 162 packed files; no dependency implementations or private runtime material |

The focused suite initially exposed two Windows short-path versus long-path
expectation mismatches. Comparing canonical asynchronous filesystem paths corrected
the test expectations; the final focused suite and complete package suite then
passed. No convention rule or baseline was weakened.

### Native platform proof

| Fresh attempt | Actual outcome | Native commands | Artifacts | Files hashed before/after |
|---|---|---|---|---|
| Windows positive | PASS, 13/13 checks | 68 | 22 | 366 |
| Linux positive | PASS, 13/13 checks | 68 | 22 | 201 |
| Windows `sentinel-crash` | Expected INCOMPLETE, 12/13 checks pass | 68 | 22 | 366 |
| Linux `cleanup-failure` | Expected INCOMPLETE, 12/13 checks pass | 67 | 22 | 201 |

Both positive receipts pass the cross-platform assessor with identical pins and
all 44 registered artifacts individually verified. Both fault receipts fail the
viability gate as intended, with `owned-cleanup` as the sole failing check, one
preserved failure, all five owned process trees stopped, authentication state
removed and the fixture closed. Their 44 artifacts also pass integrity checks.
Negative runs do not count as positive platform proofs.

The original F3 reproduction was repeated using otherwise valid new thirteen-check
receipts with only the initial snapshot retained. The real offline assessor now
exits 1 with `INCOMPLETE` and failed evidence validation. Hashes matching a surviving
snapshot cannot substitute for the required screenshot, DOM trace and network data.
Unit regressions separately exercise inherited native overrides and global config,
including refusal before output creation, and publication-source output rejection
through ordinary and aliased paths.

Receipts are under ignored `.validation/m4/resolution-01`. Windows uses Node
24.15.0; Linux uses Node 24.21.0 in the same Debian/WSL2 Docker profile as the original
spike. The corrected local image ID is
`sha256:89ded7e03fc0859f989e6205c530bbe9ec343b5e0250a156b43673ee8f3b3057`.
CLI 0.1.22, Playwright/Core 1.64.0-alpha-1790635538000, Chrome for Testing
155.0.8059.12/revision 1247 and the lock/base-image pins remain unchanged.

With the guide's environment and restricted output directories prepared, the
corrective positive commands were:

```powershell
node scripts/spikes/playwright-cli/probe.mjs '.validation/m4/resolution-01/windows-positive/run with spaces'
docker build --quiet --tag playwright-harness-m4:0.1.22 scripts/spikes/playwright-cli
docker run --rm --init --network none --shm-size=1g --mount "type=bind,source=$m4FixedLinux,target=/evidence" playwright-harness-m4:0.1.22 '/evidence/run with spaces'
node scripts/spikes/playwright-cli/assess.mjs '.validation/m4/resolution-01/windows-positive/run with spaces/report.json' '.validation/m4/resolution-01/linux-positive/run with spaces/report.json'
```

`$m4FixedLinux` resolved to `.validation/m4/resolution-01/linux-positive`.
The Windows negative run set `M4_PROBE_FAULT=sentinel-crash` and used the fresh
`windows-sentinel-fault` directory. The Linux negative run supplied
`--env M4_PROBE_FAULT=cleanup-failure` and mounted the fresh `linux-cleanup-fault`
directory. Both completed with the expected exit 1; offline assessment of their
pair also exited 1. No raw authentication state or machine-specific source path is
published in this record.

## Scope and remaining dependencies

The result applies to the exact pinned owned, isolated, headless Chromium profile.
The native resolver inspection is deliberately version-specific and must be
revalidated when pins change. The Linux proof is a real container execution, not an
independent physical-host test; its root profile disables the Chromium sandbox.
Attachment remains disabled. Borrowed browsers, real SSO, Firefox/WebKit, headed
desktop use and host orchestration remain unperformed, as recorded in the original
validation. No executor or later milestone work is included.

Historical credential values remain removed; revocation/rotation is still an
unresolved owner dependency. No historical credential validity was tested.
