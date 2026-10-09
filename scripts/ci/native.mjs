#!/usr/bin/env node
// Run the existing fixed native proofs against the clean installed archive.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, realpathSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {command, hash} from './process.mjs';
import {within} from '../lib/skill-roots.mjs';
import {snapshotInstalledPackage} from '../lib/host-proof-files.mjs';
import {completeChecks, completeNativeProof, browserDiagnostics, executeDiagnostics, nativeSummaryFields} from './results.mjs';
import {nativeProcess} from './native-process.mjs';
import {recoverNativeProof} from './recovery.mjs';
import {nativeCliInstallation} from '../lib/browser/native-cli.mjs';
import {parallelDiagnostic, parallelLogDiagnostic} from '../probes/parallel-diagnostics.mjs';

const [directory, kind] = process.argv.slice(2);
assert(process.argv.length === 4 && ['browser', 'parallel', 'execute'].includes(kind), 'Use <installed-workspace> browser|parallel|execute.');
const workspace = realpathSync(resolve(directory)), paths = JSON.parse(readFileSync(join(workspace, 'paths.json'), 'utf8'));
const root = realpathSync(paths.installedRoot), installation = realpathSync(join(workspace, 'installation'));
assert(within(installation, root) && within(workspace, installation));
const installed = JSON.parse(readFileSync(join(workspace, 'installed.json'), 'utf8'));
assert(installed.status === 'PASS' && installed.packageUnchanged && completeChecks(installed.checks.checks), 'Installed checks must pass first.');
const before = snapshotInstalledPackage(installation), consumer = join(workspace, `native-${kind}`);
const browser = command([nativeCliInstallation(root).installer, 'install', '--with-deps', 'chromium'],
  {cwd: workspace, log: join(workspace, `${kind}-browser-install.log`), timeout: 600000});
let proof, assessment, cleanup, recovery, failure;
if (browser.status === 'PASS') {
  proof = await nativeProcess(join(root, `scripts/probes/${kind}.mjs`), consumer, {cwd: workspace, log: join(workspace, `${kind}-native.log`)});
  recovery = await recoverNativeProof(root, consumer);
  try {
    assessment = JSON.parse(readFileSync(join(consumer, kind === 'browser' ? 'browser-proof.json' : kind === 'execute' ? 'execute-proof.json' : 'assessment.json'), 'utf8'));
    if (kind === 'parallel') cleanup = JSON.parse(readFileSync(join(consumer, 'cleanup.json'), 'utf8'));
  } catch {
    // Missing/invalid assessment remains incomplete; private logs are never published.
  }
  if (kind === 'parallel') try {failure = parallelDiagnostic(JSON.parse(readFileSync(join(consumer, 'failure.json'), 'utf8')));} catch {}
}
const packageUnchanged = JSON.stringify(snapshotInstalledPackage(installation)) === JSON.stringify(before);
const complete = completeNativeProof(kind, proof, recovery, assessment, cleanup);
if (kind === 'parallel' && !complete && !failure && proof) try {failure = parallelLogDiagnostic(readFileSync(join(workspace, `${kind}-native.log`), 'utf8'));} catch {}
const summary = {version: 1, kind, status: complete && packageUnchanged ? 'PASS' : 'INCOMPLETE', platform: process.platform, node: process.version,
  archive: installed.archive, packageUnchanged, browserInstallation: browser.status, ...(recovery ? {recovery} : {}),
  process: proof ? {status: proof.status, exitCode: proof.exitCode, diagnostic: proof.diagnostic, log: `${kind}-native.log`, sha256: proof.sha256} : {status: 'UNPERFORMED'},
  ...(kind === 'browser' ? {checks: browserDiagnostics(assessment)} : kind === 'execute' ? {checks: executeDiagnostics(assessment)} : {}),
  ...nativeSummaryFields(kind, assessment, cleanup, failure),
  ...(complete ? {assessmentSha256: hash(readFileSync(join(consumer, kind === 'browser' ? 'browser-proof.json' : kind === 'execute' ? 'execute-proof.json' : 'assessment.json')))} : {})};
writeFileSync(join(workspace, `native-${kind}.json`), JSON.stringify(summary, null, 2), {flag: 'wx', mode: 0o600});
console.log(JSON.stringify({kind, status: summary.status, packageUnchanged, ...(summary.failure ? {failure: summary.failure} : {})})); if (summary.status !== 'PASS') process.exitCode = 1;
