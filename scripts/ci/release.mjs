#!/usr/bin/env node
// Maintainer-only release orchestration: one candidate, complete evidence, draft-only delivery.
import assert from 'node:assert/strict';
import {appendFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {packageRoot} from '../lib/consumer-paths.mjs';
import {within, realFuture} from '../lib/skill-roots.mjs';
import {sha256} from '../lib/archive.mjs';
import {inspectArchive} from './archive.mjs';
import {checkVersionContracts} from './version.mjs';
import {command, npmPath, hash} from './process.mjs';
import {completeChecks, requiredConsumerFlows} from './results.mjs';
import {completeBrowserChecks} from '../probes/browser-checks.mjs';
import {completeExecuteChecks} from '../probes/execute-checks.mjs';

const json = file => JSON.parse(readFileSync(file, 'utf8'));
export function releaseContext(env = process.env) {
  assert(env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF === 'refs/heads/main', 'Release builds must be manually dispatched on main.');
  assert(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA), 'A dispatch commit SHA is required.');
  assert(/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY) && !['.', '..'].includes(env.GITHUB_REPOSITORY.split('/')[1]), 'A repository is required.');
  assert(/^[1-9]\d*$/.test(env.GITHUB_RUN_ID), 'A workflow run ID is required.');
  return {commit: env.GITHUB_SHA, repository: env.GITHUB_REPOSITORY, runId: env.GITHUB_RUN_ID};
}

export function releaseVersion(root, requested) {
  assert(typeof requested === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(requested) && requested.split('.').every(part => Number.isSafeInteger(Number(part))), 'Use a stable version in X.Y.Z format without v.');
  const {pkg, notes} = checkVersionContracts(root);
  assert.equal(pkg.version, requested, 'Merge the release version PR before building this version.'); return notes;
}

// gh owns authentication; never expose its environment or print response/error bodies.
function gh(args, {input, binary = false, optional = false} = {}) {
  const result = spawnSync('gh', args, {input, encoding: binary ? undefined : 'utf8', timeout: 60000, maxBuffer: 256 * 1024 * 1024, windowsHide: true});
  if (optional && !result.error && result.status !== 0 && String(result.stderr).includes('(HTTP 404)')) return undefined;
  assert(result.status === 0 && !result.error, `GitHub command failed: ${args[0]}.`); return result.stdout;
}
export const githubClient = {
  request(method, endpoint, body, optional = false) {
    const output = gh(['api', '--hostname', 'github.com', endpoint, '--method', method, ...(body ? ['--input', '-'] : [])], {input: body ? JSON.stringify(body) : undefined, optional});
    return output === undefined ? undefined : JSON.parse(output);
  },
  download(endpoint) {return gh(['api', '--hostname', 'github.com', endpoint, '-H', 'Accept: application/octet-stream'], {binary: true});},
  upload(repository, tag, file) {gh(['release', 'upload', tag, file, '--repo', repository]);}
};

// The tag endpoint promises published releases; list releases to find drafts as well.
function findRelease(endpoint, tag, client) {
  const matches = [];
  for (let page = 1; page <= 100; page++) {
    const releases = client.request('GET', `${endpoint}/releases?per_page=100&page=${page}`);
    assert(Array.isArray(releases), 'GitHub did not return a release list.');
    matches.push(...releases.filter(release => release.tag_name === tag)); assert(matches.length <= 1, 'Multiple releases claim this version.');
    if (releases.length < 100) return matches[0];
  }
  throw new Error('The release list could not be completely inspected.');
}

// Compare immutable subtree identities, including nested files, additions and removals.
// GITHUB_TOKEN cannot create releases whose workflow files differ from the default branch.
export function checkWorkflowCompatibility(context, client = githubClient) {
  const endpoint = `repos/${context.repository}`, repository = client.request('GET', endpoint);
  assert(typeof repository.default_branch === 'string' && repository.default_branch, 'GitHub did not return the default branch.');
  const head = client.request('GET', `${endpoint}/git/ref/heads/${encodeURIComponent(repository.default_branch)}`);
  assert(head.object?.type === 'commit' && /^[a-f0-9]{40}$/.test(head.object.sha), 'GitHub did not return the default branch commit.');
  if (head.object.sha === context.commit) return;
  const directory = (ref, name) => {
    const tree = client.request('GET', `${endpoint}/git/trees/${ref}`);
    assert(tree.truncated === false && Array.isArray(tree.tree), 'GitHub did not return a complete workflow tree.');
    const entries = tree.tree.filter(entry => entry.path === name); assert(entries.length <= 1, 'GitHub returned an ambiguous workflow tree.');
    if (!entries.length) return undefined;
    assert(entries[0].type === 'tree' && /^[a-f0-9]{40}$/.test(entries[0].sha), 'GitHub did not return a workflow directory.'); return entries[0].sha;
  };
  const workflows = commit => {const github = directory(commit, '.github'); return github ? directory(github, 'workflows') : undefined;};
  const candidate = workflows(context.commit); assert(candidate, 'The release candidate has no workflow directory.');
  assert.equal(workflows(head.object.sha), candidate, 'Workflow files differ from the current default branch. Start a fresh Harness release run on main after reconciling workflow changes; rerunning this pinned candidate cannot grant GITHUB_TOKEN workflow-write permission.');
}

export function preflightRelease(root, version, context, client = githubClient) {
  const notes = releaseVersion(root, version), endpoint = `repos/${context.repository}`, tag = `v${version}`;
  assert(!client.request('GET', `${endpoint}/git/ref/tags/${tag}`, undefined, true), 'This version tag already exists.');
  assert(!findRelease(endpoint, tag, client), 'This version release already exists.');
  checkWorkflowCompatibility(context, client);
  return notes;
}

export function prepareCandidate(root, directory, version, context) {
  releaseVersion(root, version); assert(!within(realFuture(root), realFuture(directory)), 'Keep the release candidate outside the package.');
  const npm = npmPath(), major = command([npm, '--version'], {cwd: root});
  assert(major.status === 'PASS' && major.stdout.trim().split('.')[0] === '11', 'Pack release archives with npm 11.');
  mkdirSync(directory, {mode: 0o700});
  const packed = command([npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', directory], {cwd: root});
  assert.equal(packed.status, 'PASS', 'Packing the release candidate failed.');
  const items = JSON.parse(packed.stdout); assert.equal(items.length, 1);
  const name = `playwright-pom-harness-${version}.tgz`; assert.equal(items[0].filename, name);
  const archive = inspectArchive(join(directory, name), root);
  const candidate = {schemaVersion: 1, version, ...context, archive};
  writeFileSync(join(directory, `${name}.sha256`), `${archive.sha256}  ${name}\n`, {flag: 'wx'});
  writeFileSync(join(directory, 'candidate.json'), JSON.stringify(candidate, null, 2) + '\n', {flag: 'wx'});
  return candidate;
}

export function readCandidate(root, directory, context) {
  const candidate = json(join(directory, 'candidate.json')); assert.equal(candidate.schemaVersion, 1);
  for (const key of ['repository', 'commit', 'runId']) assert.equal(candidate[key], context[key], `The candidate ${key} differs from this dispatch.`);
  releaseVersion(root, candidate.version);
  const name = `playwright-pom-harness-${candidate.version}.tgz`; assert.equal(candidate.archive?.name, name);
  assert.equal(readFileSync(join(directory, `${name}.sha256`), 'utf8'), `${candidate.archive.sha256}  ${name}\n`, 'The checksum file differs from the candidate.');
  assert.deepEqual(inspectArchive(join(directory, name), root, candidate.archive.sha256), candidate.archive, 'The candidate archive metadata differs.');
  return candidate;
}

function passing(summary, platform, label) {
  assert(summary?.version === 1 && summary.status === 'PASS' && summary.platform === platform, `${label} evidence is incomplete.`);
}
function sameArchive(summary, candidate) {
  assert(summary.archive?.name === candidate.archive.name && summary.archive.sha256 === candidate.archive.sha256, 'Validation used a different archive.');
}
function consumerEvidence(summary, platform, npmMajor, candidate) {
  passing(summary, platform, 'Consumer'); sameArchive(summary, candidate);
  assert.equal(summary.npm?.split('.')[0], npmMajor, 'Consumer npm version differs.');
  assert(Array.isArray(summary.flows) && summary.flows.length === requiredConsumerFlows.length && new Set(summary.flows.map(flow => flow.id)).size === requiredConsumerFlows.length && requiredConsumerFlows.every(id => summary.flows.some(flow => flow.id === id && flow.status === 'PASS')), 'Consumer flow scope is incomplete.');
}

export function verifyReleaseEvidence(directory, candidate) {
  for (const [os, platform] of [['ubuntu-24.04', 'linux'], ['windows-2025', 'win32']]) {
    const root = join(directory, `installed-summary-${os}`), installed = json(join(root, 'harness-installed', 'installed.json'));
    passing(installed, platform, 'Installed'); sameArchive(installed, candidate);
    assert(installed.packageUnchanged === true && installed.checks?.status === 'PASS' && completeChecks(installed.checks.checks), 'Installed checks are incomplete.');
    for (const kind of ['browser', 'execute', ...(platform === 'linux' ? ['parallel'] : [])]) {
      const native = json(join(root, 'harness-installed', `native-${kind}.json`));
      passing(native, platform, `Native ${kind}`); sameArchive(native, candidate);
      assert(native.kind === kind && native.packageUnchanged === true && native.browserInstallation === 'PASS' && native.recovery?.complete === true && native.process?.status === 'PASS' && native.process.exitCode === 0 && !native.process.diagnostic && /^[a-f0-9]{64}$/.test(native.assessmentSha256), 'Native proof is incomplete.');
      if (kind === 'browser') assert(completeBrowserChecks(native.checks), 'Browser scope is incomplete.');
      if (kind === 'execute') assert(completeExecuteChecks(native.checks) && ['end', 'per-step'].every(mode => Number.isFinite(native.diagnosticsLatencyMs?.[mode]) && native.diagnosticsLatencyMs[mode] >= 0), 'Execution scope is incomplete.');
      if (kind === 'parallel') assert(Array.isArray(native.checks) && native.checks.length === 2 && native.checks.every(scope => scope.scenarios === 13 && scope.assertions > 0 && scope.evidence > 0) && native.cleanup?.ownedDatabasesRemoved === true && native.cleanup.fixtureServersClosed === true, 'Parallel scope is incomplete.');
    }
    const timeout = json(join(root, 'harness-timeout', 'timeout-proof.json'));
    passing(timeout, platform, 'Timeout');
    assert(timeout.kind === (platform === 'linux' ? 'mixed' : 'browser') && timeout.sentinelCleanup === true && Array.isArray(timeout.records) && timeout.records.length === 3 && ['cooperative', 'forced', 'lost-open-receipt'].every(name => timeout.records.some(record => record.name === name && record.status === 'PASS' && record.deadlineRemainedFailure === true && record.ownedBrowserStopped === true && record.protectedStorageRemoved === true && record.unrelatedBrowserSurvived === true && (record.recovery?.complete === true || record.ownerReconciliation?.complete === true))), 'Timeout scope is incomplete.');
    consumerEvidence(json(join(root, 'harness-consumers', 'consumer-flow.json')), platform, '11', candidate);
    consumerEvidence(json(join(directory, `npm12-consumer-flow-${os}`, 'consumer-flow.json')), platform, '12', candidate);
  }
  return {status: 'PASS', matrixJobs: 4, archiveSha256: candidate.archive.sha256};
}

export function ensureDraft(candidate, directory, notes, client = githubClient) {
  assert.equal(sha256(join(directory, candidate.archive.name)), candidate.archive.sha256, 'The candidate changed before draft creation.');
  assert.equal(readFileSync(join(directory, `${candidate.archive.name}.sha256`), 'utf8'), `${candidate.archive.sha256}  ${candidate.archive.name}\n`, 'The checksum changed before draft creation.');
  const endpoint = `repos/${candidate.repository}`, tag = `v${candidate.version}`;
  const marker = `<!-- harness-release:${candidate.runId}:${candidate.commit}:${candidate.archive.sha256} -->`;
  const runUrl = `https://github.com/${candidate.repository}/actions/runs/${candidate.runId}`;
  const body = `${notes}\n\nValidated commit: ${candidate.commit}\nWorkflow: ${runUrl}\nSHA-256: ${candidate.archive.sha256}\n\n${marker}`;
  const ownedDraft = release => {
    assert(release.draft === true && release.tag_name === tag && release.target_commitish === candidate.commit && release.body?.includes(marker), 'An existing release conflicts with this run; published releases are never changed.');
    return release;
  };
  let release = findRelease(endpoint, tag, client);
  if (release) ownedDraft(release);
  const ref = client.request('GET', `${endpoint}/git/ref/tags/${tag}`, undefined, true);
  if (ref) assert(ref.object?.type === 'commit' && ref.object.sha === candidate.commit, 'An existing tag points to another commit.');
  if (!release || !ref) checkWorkflowCompatibility(candidate, client);
  // A rejected draft request must not leave a tag that blocks a fresh dispatch.
  if (!release) release = client.request('POST', `${endpoint}/releases`, {tag_name: tag, target_commitish: candidate.commit, name: candidate.version, body, draft: true, prerelease: false});
  assert(Number.isSafeInteger(release.id) && release.id > 0 && release.draft === true, 'GitHub did not return a draft release.');
  ownedDraft(release);
  if (!ref) {
    checkWorkflowCompatibility(candidate, client);
    ownedDraft(client.request('GET', `${endpoint}/releases/${release.id}`));
    client.request('POST', `${endpoint}/git/refs`, {ref: `refs/tags/${tag}`, sha: candidate.commit});
  }
  const names = [candidate.archive.name, `${candidate.archive.name}.sha256`];
  let assets = client.request('GET', `${endpoint}/releases/${release.id}/assets?per_page=100`);
  assert(Array.isArray(assets) && assets.length <= names.length && assets.every(asset => names.includes(asset.name)) && new Set(assets.map(asset => asset.name)).size === assets.length, 'The draft contains unexpected assets.');
  // Verify all existing assets before uploading anything; never clobber a conflicting file.
  const verify = asset => {
    assert(asset.state === 'uploaded' && Number.isSafeInteger(asset.id) && asset.id > 0, 'A release asset is incomplete.');
    assert.equal(hash(client.download(`${endpoint}/releases/assets/${asset.id}`)), sha256(join(directory, asset.name)), 'An existing release asset checksum differs.');
  };
  assets.forEach(verify);
  for (const name of names) if (!assets.some(asset => asset.name === name)) {
    ownedDraft(client.request('GET', `${endpoint}/releases/${release.id}`));
    client.upload(candidate.repository, tag, join(directory, name));
  }
  assets = client.request('GET', `${endpoint}/releases/${release.id}/assets?per_page=100`);
  assert(assets.length === 2 && new Set(assets.map(asset => asset.name)).size === 2 && assets.every(asset => names.includes(asset.name)), 'The draft release assets are incomplete.'); assets.forEach(verify);
  const final = ownedDraft(client.request('GET', `${endpoint}/releases/${release.id}`));
  const url = final.html_url; assert(typeof url === 'string' && url.startsWith(`https://github.com/${candidate.repository}/releases/`), 'GitHub did not return the draft URL.');
  return {status: 'DRAFT', version: candidate.version, commit: candidate.commit, sha256: candidate.archive.sha256, url};
}

export function createDraft(root, candidateDirectory, evidenceDirectory, context, client = githubClient) {
  const candidate = readCandidate(root, candidateDirectory, context); verifyReleaseEvidence(evidenceDirectory, candidate);
  return ensureDraft(candidate, candidateDirectory, releaseVersion(root, candidate.version), client);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const [operation, directory, extra] = process.argv.slice(2), context = releaseContext();
  assert(['prepare', 'verify', 'installed', 'draft'].includes(operation) && directory && process.argv.length === (['installed', 'draft'].includes(operation) ? 5 : 4), 'Use prepare|verify <candidate directory>, installed <candidate directory> <workspace>, or draft <candidate directory> <evidence directory>.');
  if (operation === 'prepare') {
    preflightRelease(packageRoot, process.env.RELEASE_VERSION, context);
    console.log(JSON.stringify(prepareCandidate(packageRoot, resolve(directory), process.env.RELEASE_VERSION, context)));
  } else if (operation === 'verify') console.log(JSON.stringify(readCandidate(packageRoot, resolve(directory), context)));
  else if (operation === 'installed') {
    const candidate = readCandidate(packageRoot, resolve(directory), context);
    const result = spawnSync(process.execPath, [join(packageRoot, 'scripts/ci/installed.mjs'), extra, '--archive', join(resolve(directory), candidate.archive.name), '--sha256', candidate.archive.sha256], {stdio: 'inherit', windowsHide: true});
    assert(!result.error && result.status === 0, 'Installed candidate validation failed.');
  } else {
    const result = createDraft(packageRoot, resolve(directory), resolve(extra), context); console.log(JSON.stringify(result));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Draft harness release ${result.version}\n\n[Review the draft](${result.url})\n\nCommit: \`${result.commit}\`\n\nSHA-256: \`${result.sha256}\`\n\nPublish the draft manually after review.\n`);
  }
}
