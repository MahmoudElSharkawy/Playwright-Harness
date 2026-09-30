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
