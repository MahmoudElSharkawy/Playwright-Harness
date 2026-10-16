# Windows discovery junction compatibility

Issue [#68](https://github.com/MahmoudElSharkawy/Playwright-Harness/issues/68)
concerns existing directory junctions whose stored target becomes unreadable when
their target directory disappears. Supported discovery locations must permit
`readlinkSync` on both live and dangling junctions. This is a filesystem-location
boundary in addition to the Node 24 requirement; an OS or Node version alone does
not establish support.

The compatibility change reports the failing entry, original error code and
recovery guidance. It preserves the entry and original error as the cause. A
directory enumeration that identifies a link cannot turn into an ordinary file
merely because `readlinkSync` returns `UNKNOWN` or `EINVAL`. Neither a manifest
entry nor an inspection failure proves that removing the link is safe. Existing
managed-target and foreign-entry checks still apply when inspection succeeds.

## Focused reproduction

From this source checkout, supply an existing scratch parent directory:

```powershell
node scripts/probes/junctions.mjs "$env:TEMP"
node scripts/probes/junctions.mjs '<short external scratch directory>'
```

The probe creates its own uniquely named directory, target and junction. It reads
the live target, removes only its owned target, and records raw `readlinkSync`,
`lstatSync` and harness discovery results with OS, Node and libuv versions. Exit 1
indicates unsupported inspection or failed cleanup. Cleanup restores only the
probe's original target, verifies its identity, removes the link itself and then
removes the fixture. If cleanup cannot verify the link, it retains the fixture
and reports its path. It never repairs or deletes project discovery entries.

## Recorded evidence

On 2026-10-16, Windows 11 Pro build 10.0.22631, Node v24.15.0 and libuv 1.51.0:

| Junction location | Live read | Dangling read | Existing three adoption regressions |
|---|---|---|---|
| User Temp, short or full path | Pass | `ENOENT`; parent still identifies a link | 3 failures |
| Normal C: workspace | Pass | Pass | Previously passed in a short sibling scratch folder |
| C:\Windows\Temp | Pass | Pass | Not run there |
| Short external D: scratch folder on NTFS | Pass | Pass | 3 passes |

Native Windows `fsutil reparsepoint query` and PowerShell target inspection also
fail in the affected user Temp location. A junction in D: can still report its
missing target in C: user Temp; moving the link into user Temp reproduces the
inspection failure. This isolates the link's location as a relevant condition,
without establishing the underlying Windows, permissions or filesystem-filter
cause. No native-command fallback is claimed.

Earlier investigation reproduced the same three failures on the same host with
Node 24.21.0. Windows 2025 CI with Node 24.21.0 passed all 1,246 then-current tests
in [the 3.6.0 validation run](https://github.com/MahmoudElSharkawy/Playwright-Harness/actions/runs/38445803952).
That alternate local runtime was not rerun on 2026-10-16. The current supported
locations pass the unchanged adoption assertions; diagnostic regressions also
inject unreadable-link errors so preservation is checked on every CI platform.

See [recovery guidance](../getting-started.md#windows-junction-readability).
