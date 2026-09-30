# Provenance and release status

The project license is [MIT](../LICENSE). On 2026-09-29 the owner confirmed the
necessary rights to release the supplied original material under MIT. This attestation
is recorded in [the provenance inventory](../scripts/provenance.json). The supplied
archive had no root license; the example consumer manifest still says UNLICENSED
because adopters choose their own application's license. That manifest does not
override the harness source license.

The original source is the supplied version 3.0.0 package. M1 sanitizes that material
and adds project-specific validation code. Protected recovery/accounting records are
excluded from publication; no original private incident is republished as research.

M2 relocates one owner-cleared skill and adds project-specific root/proof tooling.
Official Codex and Claude documentation informed native discovery and packaging;
no upstream implementation was copied. The local Claude test CLI and Python skill
validator dependencies are development tools in ignored storage, not bundled source
or dependencies of the published package. Their upstream licenses continue to apply.

M3 migrates the remaining owner-cleared skills and adds project-specific adoption,
configuration and local-source tools. No third-party implementation was copied and
no new runtime dependency was added. Legacy-source digests identify recognized
instructions for safe migration; they do not contain private historical values.

M4 adds project-specific fixed viability probes and an assessor. No third-party
implementation or official CLI skill is copied. The spike manifest and lockfile
install the CLI separately; [its three resolved dependencies](../scripts/cli-dependency-licenses.json)
retain Apache-2.0 licenses and upstream notices. The provenance check now audits 153
records across the example and spike locks. Container and browser distributions are
development tools only; their redistribution is outside this source-package audit.

M5 adds project-specific execution contracts and regression fixtures using Node
built-ins and existing project configuration/root validation. No third-party source
was copied, no runtime dependency was added, and the dependency notices are unchanged.

M6 adds project-authored browser integration and synthetic validation fixtures. It
reuses the exact separately installed M4 CLI graph as an optional browser runtime;
no upstream implementation or skill content is copied into project source. Required
Apache-2.0 dependency notices remain applicable and unchanged.

M7 adds project-authored API execution and synthetic HTTP fixtures using Node built-ins.
No third-party implementation was copied and no dependency was added. Required
dependency notices remain unchanged. The root lockfile's package metadata now matches
the package version; its dependency graph is unchanged.

AgenTeX (MIT) and Microsoft Playwright CLI (Apache-2.0) were inspected as references.
No upstream implementation was copied into M1. Exact research revisions are recorded
in [the provenance inventory](../scripts/provenance.json). Architectural ideas and links
do not change the licenses of dependencies or any future copied source.

Dependency versions are resolved in the example lockfile and all 150 dependency
records are listed in [the dependency inventory](../scripts/dependency-licenses.json).
The 122 packages installed on Windows were inspected; 28 optional platform packages
were not installed. The inventory records their lockfile license declarations without
claiming those platforms were executed. No dependency implementation is bundled in
the source package. Preserve upstream LICENSE and NOTICE files when redistributing
dependencies; that would require a distribution-specific audit.

Before publication: recheck any new third-party source, retain required notices,
inspect the archive, resolve outstanding security remediation, and obtain explicit
publication authorization. The root package remains private. MIT licensing is not
authorization to create a public repository, push, publish or release this package.
