import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, realpathSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname, basename} from 'node:path';
import {gzipSync} from 'node:zlib';
import {packageRoot} from '../scripts/lib/consumer-paths.mjs';
import {within} from '../scripts/lib/skill-roots.mjs';
import {sha256} from '../scripts/lib/archive.mjs';
import {inspectArchive, archiveFiles} from '../scripts/ci/archive.mjs';
import {command} from '../scripts/ci/process.mjs';
import {requiredChecks, requiredConsumerFlows} from '../scripts/ci/results.mjs';
import {requiredBrowserChecks} from '../scripts/probes/browser-checks.mjs';
import {requiredExecuteChecks} from '../scripts/probes/execute-checks.mjs';
import {releaseContext, releaseVersion, checkWorkflowCompatibility, preflightRelease, prepareCandidate, readCandidate, verifyReleaseEvidence, ensureDraft, createDraft} from '../scripts/ci/release.mjs';

function temporary(t) {
  const base = realpathSync(tmpdir()), root = mkdtempSync(join(base, 'harness-release-'));
  t.after(() => {assert(within(base, realpathSync(root))); rmSync(root, {recursive: true});}); return root;
}
const save = (file, data) => {mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, JSON.stringify(data));};
const context = {repository: 'synthetic/harness', commit: '1'.repeat(40), runId: '12345'};
const version = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version;
let directory, candidate;
test.before(t => {
  const root = temporary(t); directory = join(root, 'candidate');
  candidate = prepareCandidate(packageRoot, directory, version, context);
});

function candidateCopy(t) {
  const root = temporary(t);
  for (const name of [candidate.archive.name, `${candidate.archive.name}.sha256`, 'candidate.json']) copyFileSync(join(directory, name), join(root, name));
  return root;
}
function contractRoot(t) {
  const root = temporary(t);
  for (const file of ['package.json', 'npm-shrinkwrap.json', '.claude-plugin/plugin.json', 'examples/package.json', 'scripts/spikes/playwright-cli/package.json', 'scripts/managed-digests.json', 'VERSION', 'CHANGELOG.md']) {
    mkdirSync(dirname(join(root, file)), {recursive: true}); copyFileSync(join(packageRoot, file), join(root, file));
  }
  return root;
}

// Small valid tar fixtures exercise input checks without npm installation or a network.
function tar(entries) {
  const blocks = [];
  for (const {name, body = '', type = '0'} of entries) {
    const data = Buffer.from(body), header = Buffer.alloc(512);
    header.write(name, 0, 100); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136);
    header.fill(32, 148, 156); header.write(type, 156); header.write('ustar\0', 257); header.write('00', 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0); header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
function tinyArchive(t, change = entries => entries) {
  const root = temporary(t), source = contractRoot(t), name = `playwright-pom-harness-${version}.tgz`;
  const entries = ['package.json', 'npm-shrinkwrap.json', '.claude-plugin/plugin.json', 'VERSION'].map(file => ({name: `package/${file}`, body: readFileSync(join(source, file))}));
  const file = join(root, name); writeFileSync(file, tar(change(entries))); return {source, file};
}

test('release context accepts only a manual main dispatch with an exact commit and run identity', () => {
  const env = {GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: context.commit, GITHUB_REPOSITORY: context.repository, GITHUB_RUN_ID: context.runId};
  assert.deepEqual(releaseContext(env), context);
  for (const change of [{GITHUB_EVENT_NAME: 'push'}, {GITHUB_REF: 'refs/heads/feature'}, {GITHUB_SHA: 'main'}, {GITHUB_REPOSITORY: '../foreign'}, {GITHUB_RUN_ID: '0'}]) assert.throws(() => releaseContext({...env, ...change}));
});
test('release versions require the merged contracts and a stable explicit version', t => {
  const root = contractRoot(t); assert.match(releaseVersion(root, version), /### Upgrade actions/);
  for (const value of [`v${version}`, `${version}-rc.1`, '01.2.3', '1.2', '9.9.9', '--publish', '1.2.9007199254740992']) assert.throws(() => releaseVersion(root, value));
  writeFileSync(join(root, 'VERSION'), '0.0.0'); assert.throws(() => releaseVersion(root, version));
});
test('supplied archive inspection accepts real npm 11 bytes with consistent identity and shrinkwrap', () => {
  assert.deepEqual(inspectArchive(join(directory, candidate.archive.name), packageRoot, candidate.archive.sha256), candidate.archive);
  assert(archiveFiles(join(directory, candidate.archive.name)).has('.github/workflows/release.yml'));
  assert.deepEqual(readCandidate(packageRoot, directory, context), candidate);
});
test('release helper starts and verifies its candidate with no node_modules on a fresh runner', t => {
  const root = temporary(t);
  for (const [name, bytes] of archiveFiles(join(directory, candidate.archive.name))) {
    const file = join(root, name); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, bytes);
  }
  assert.equal(existsSync(join(root, 'node_modules')), false);
  const result = command([join(root, 'scripts/ci/release.mjs'), 'verify', directory], {cwd: root, env: {GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: context.commit, GITHUB_REPOSITORY: context.repository, GITHUB_RUN_ID: context.runId}});
  assert.equal(result.status, 'PASS', result.output); assert.deepEqual(JSON.parse(result.stdout), candidate);
});
test('supplied archives fail before installation on digest, identity, version or lock drift', t => {
  const valid = tinyArchive(t); assert(inspectArchive(valid.file, valid.source));
  assert.throws(() => inspectArchive(valid.file, valid.source, '0'.repeat(64)), /checksum/);
  assert.throws(() => inspectArchive(valid.file, valid.source, 'bad-digest'), /digest/);
  for (const [file, change, message] of [
    ['package.json', data => ({...data, name: 'foreign-package'}), /identity/],
    ['package.json', data => ({...data, version: '0.0.0'}), /version/],
    ['npm-shrinkwrap.json', data => ({...data, version: '0.0.0'}), /dependency lock/],
    ['.claude-plugin/plugin.json', data => ({...data, version: '0.0.0'}), /plugin version/]
  ]) {
    const fixture = tinyArchive(t, entries => entries.map(entry => entry.name === `package/${file}` ? {...entry, body: JSON.stringify(change(JSON.parse(entry.body)))} : entry));
    assert.throws(() => inspectArchive(fixture.file, fixture.source), message);
  }
  const missing = tinyArchive(t, entries => entries.filter(entry => !entry.name.endsWith('npm-shrinkwrap.json')));
  assert.throws(() => inspectArchive(missing.file, missing.source), /distributed npm-shrinkwrap/);
});
test('archive inspection rejects traversal, duplicate files, links and truncated tar bodies', t => {
  for (const extra of [{name: 'package/../escape'}, {name: 'package/package.json'}, {name: 'package/link', type: '2'}]) {
    const fixture = tinyArchive(t, entries => [...entries, extra]); assert.throws(() => archiveFiles(fixture.file));
  }
  const root = temporary(t), file = join(root, 'truncated.tgz'), data = Buffer.alloc(512);
  data.write('package/file'); data.write('00000000010\0', 124); writeFileSync(file, gzipSync(data)); assert.throws(() => archiveFiles(file), /size/);
});
test('installed CLI rejects a bad supplied digest before creating its workspace or invoking npm', t => {
  const root = temporary(t), workspace = join(root, 'must-not-exist');
  const result = command(['scripts/ci/installed.mjs', workspace, '--archive', join(directory, candidate.archive.name), '--sha256', '0'.repeat(64)], {cwd: packageRoot});
  assert.equal(result.status, 'FAIL'); assert.match(result.output, /checksum differs/); assert.equal(existsSync(workspace), false);
  const missingDigest = command(['scripts/ci/installed.mjs', workspace, '--archive', join(directory, candidate.archive.name)], {cwd: packageRoot});
  assert.equal(missingDigest.status, 'FAIL'); assert.equal(existsSync(workspace), false);
});
test('candidate reuse refuses a different run, commit, checksum file or archive', t => {
  for (const change of [{runId: '999'}, {commit: '2'.repeat(40)}, {repository: 'foreign/harness'}]) assert.throws(() => readCandidate(packageRoot, directory, {...context, ...change}));
  const root = candidateCopy(t); writeFileSync(join(root, `${candidate.archive.name}.sha256`), 'changed');
  assert.throws(() => readCandidate(packageRoot, root, context), /checksum file/);
});

function evidence(t) {
  const root = temporary(t), counts = {tests: 1, pass: 1, fail: 0, cancelled: 0, skipped: 0, todo: 0};
  const checks = requiredChecks.map(id => ({id, status: 'PASS', exitCode: 0, diagnostic: null, ...(id === 'tests' ? {counts} : {})}));
  for (const [os, platform] of [['ubuntu-24.04', 'linux'], ['windows-2025', 'win32']]) {
    const installedRoot = join(root, `installed-summary-${os}`), common = {version: 1, status: 'PASS', platform, archive: candidate.archive};
    save(join(installedRoot, 'harness-installed/installed.json'), {...common, packageUnchanged: true, checks: {status: 'PASS', checks}});
    for (const kind of ['browser', 'execute', ...(platform === 'linux' ? ['parallel'] : [])]) {
      save(join(installedRoot, `harness-installed/native-${kind}.json`), {...common, kind, packageUnchanged: true, browserInstallation: 'PASS', recovery: {complete: true}, process: {status: 'PASS', exitCode: 0, diagnostic: null}, assessmentSha256: '3'.repeat(64),
        checks: kind === 'parallel' ? [{scenarios: 13, assertions: 35, evidence: 166}, {scenarios: 13, assertions: 35, evidence: 166}] : (kind === 'browser' ? requiredBrowserChecks : requiredExecuteChecks).map(name => ({name, status: 'PASS'})),
        ...(kind === 'execute' ? {diagnosticsLatencyMs: {end: 0, 'per-step': 1}} : {}), ...(kind === 'parallel' ? {cleanup: {ownedDatabasesRemoved: true, fixtureServersClosed: true}} : {})});
    }
    save(join(installedRoot, 'harness-timeout/timeout-proof.json'), {...common, kind: platform === 'linux' ? 'mixed' : 'browser', sentinelCleanup: true, records: ['cooperative', 'forced', 'lost-open-receipt'].map(name => ({name, status: 'PASS', deadlineRemainedFailure: true, ownedBrowserStopped: true, protectedStorageRemoved: true, unrelatedBrowserSurvived: true, recovery: {complete: true}}))});
    const consumer = {...common, npm: '11.0.0', flows: requiredConsumerFlows.map(id => ({id, status: 'PASS'}))};
    save(join(installedRoot, 'harness-consumers/consumer-flow.json'), consumer);
    save(join(root, `npm12-consumer-flow-${os}/consumer-flow.json`), {...consumer, npm: '12.0.0'});
  }
  return root;
}
function edit(file, transform) {save(file, transform(JSON.parse(readFileSync(file, 'utf8'))));}
test('release evidence requires all four jobs and the complete native and consumer scopes', t => {
  assert.deepEqual(verifyReleaseEvidence(evidence(t), candidate), {status: 'PASS', matrixJobs: 4, archiveSha256: candidate.archive.sha256});
  const changes = [
    ['installed-summary-windows-2025/harness-installed/installed.json', data => ({...data, status: 'SKIPPED'})],
    ['installed-summary-ubuntu-24.04/harness-installed/installed.json', data => ({...data, checks: {...data.checks, checks: []}})],
    ['installed-summary-ubuntu-24.04/harness-installed/native-browser.json', data => ({...data, checks: data.checks.slice(1)})],
    ['installed-summary-windows-2025/harness-installed/native-execute.json', data => ({...data, recovery: {complete: false}})],
    ['installed-summary-ubuntu-24.04/harness-installed/native-parallel.json', data => ({...data, cleanup: {ownedDatabasesRemoved: false, fixtureServersClosed: true}})],
    ['installed-summary-windows-2025/harness-timeout/timeout-proof.json', data => ({...data, records: []})],
    ['installed-summary-ubuntu-24.04/harness-consumers/consumer-flow.json', data => ({...data, archive: {...data.archive, sha256: '0'.repeat(64)}})],
    ['npm12-consumer-flow-windows-2025/consumer-flow.json', data => ({...data, flows: data.flows.slice(1)})],
    ['npm12-consumer-flow-ubuntu-24.04/consumer-flow.json', data => ({...data, npm: '11.0.0'})]
  ];
  for (const [file, transform] of changes) {const root = evidence(t); edit(join(root, file), transform); assert.throws(() => verifyReleaseEvidence(root, candidate));}
  const missing = evidence(t); rmSync(join(missing, 'npm12-consumer-flow-windows-2025/consumer-flow.json'));
  assert.throws(() => verifyReleaseEvidence(missing, candidate));
});

function fakeGithub() {
  const state = {ref: undefined, release: undefined, assets: [], writes: [], failUpload: false, releases: undefined,
    head: context.commit, workflowTree: '3'.repeat(40), defaultBranch: 'main'};
  const client = {
    request(method, endpoint, body) {
      if (method !== 'GET') state.writes.push({method, endpoint, body});
      if (endpoint === `repos/${context.repository}`) return {default_branch: state.defaultBranch};
      if (endpoint.includes('/git/ref/heads/')) return {object: {type: 'commit', sha: state.head}};
      if (endpoint.includes('/git/trees/')) {
        const ref = endpoint.split('/').at(-1), candidateTree = ref === context.commit || ref === '4'.repeat(40);
        return {truncated: false, tree: [{path: [context.commit, state.head].includes(ref) ? '.github' : 'workflows', type: 'tree',
          sha: [context.commit, state.head].includes(ref) ? (candidateTree ? '4'.repeat(40) : '5'.repeat(40)) : candidateTree ? '3'.repeat(40) : state.workflowTree}]};
      }
      if (endpoint.includes('/releases?')) return state.releases ?? (state.release ? [structuredClone(state.release)] : []);
      if (endpoint.includes('/git/ref/tags/')) return structuredClone(state.ref);
      if (method === 'POST' && endpoint.endsWith('/git/refs')) {state.ref = {object: {type: 'commit', sha: body.sha}}; return state.ref;}
      if (method === 'POST' && endpoint.endsWith('/releases')) {state.release = {...body, id: 100, html_url: `https://github.com/${context.repository}/releases/tag/untagged-synthetic`}; return structuredClone(state.release);}
      if (endpoint.includes('/assets?')) return state.assets.map(({bytes, ...asset}) => asset);
      if (endpoint.endsWith('/releases/100')) return structuredClone(state.release);
      throw new Error(`Unexpected synthetic request: ${method} ${endpoint}`);
    },
    download(endpoint) {return state.assets.find(asset => endpoint.endsWith(`/assets/${asset.id}`)).bytes;},
    upload(repository, tag, file) {
      state.writes.push({method: 'UPLOAD', file}); state.assets.push({id: state.assets.length + 1, name: basename(file), state: 'uploaded', bytes: readFileSync(file)});
      if (state.failUpload) {state.failUpload = false; throw new Error('Synthetic lost upload response.');}
    }
  };
  return {state, client};
}
test('release preflight rejects existing tags, published releases and drafts without mutations', () => {
  const fresh = fakeGithub(); assert.match(preflightRelease(packageRoot, version, context, fresh.client), /Upgrade actions/); assert.deepEqual(fresh.state.writes, []);
  const tag = fakeGithub(); tag.state.ref = {object: {type: 'commit', sha: context.commit}};
  assert.throws(() => preflightRelease(packageRoot, version, context, tag.client), /tag already exists/);
  for (const draft of [true, false]) {
    const fixture = fakeGithub(); fixture.state.release = {tag_name: `v${version}`, draft};
    assert.throws(() => preflightRelease(packageRoot, version, context, fixture.client), /release already exists/); assert.deepEqual(fixture.state.writes, []);
  }
});
test('draft creation tags the exact commit, uploads only validated bytes and never publishes', t => {
  const {state, client} = fakeGithub(), result = createDraft(packageRoot, directory, evidence(t), context, client);
  assert.equal(result.status, 'DRAFT'); assert.equal(result.url, state.release.html_url);
  assert.equal(state.ref.object.sha, context.commit); assert.equal(state.release.draft, true); assert.equal(state.release.prerelease, false);
  assert.deepEqual(state.assets.map(asset => asset.name), [candidate.archive.name, `${candidate.archive.name}.sha256`]);
  assert.equal(sha256(join(directory, candidate.archive.name)), result.sha256);
  assert.equal(state.writes.filter(write => write.method === 'POST').length, 2);
  assert.deepEqual(state.writes.filter(write => write.method === 'POST').map(write => write.endpoint), [`repos/${context.repository}/releases`, `repos/${context.repository}/git/refs`]);
  assert(state.writes.every(write => !['PATCH', 'DELETE'].includes(write.method)));
  state.writes.length = 0; ensureDraft(candidate, directory, releaseVersion(packageRoot, version), client); assert.deepEqual(state.writes, []);
});

test('workflow changes on the default branch reject stale candidates before packing or GitHub mutations', () => {
  const {state, client} = fakeGithub(); state.head = '2'.repeat(40); state.workflowTree = '6'.repeat(40);
  assert.throws(() => preflightRelease(packageRoot, version, context, client), /Start a fresh Harness release run on main/);
  assert.throws(() => ensureDraft(candidate, directory, 'Synthetic notes.', client), /Workflow files differ/);
  assert.equal(state.ref, undefined); assert.equal(state.release, undefined); assert.deepEqual(state.writes, []);
});

test('ordinary default branch changes preserve the validated commit and archive', () => {
  const {state, client} = fakeGithub(); state.head = '2'.repeat(40);
  ensureDraft(candidate, directory, 'Synthetic notes.', client);
  assert.equal(state.ref.object.sha, context.commit); assert.equal(state.release.target_commitish, context.commit);
  assert.equal(state.assets[0].bytes.compare(readFileSync(join(directory, candidate.archive.name))), 0);
});

test('workflow inspection fails closed on truncated, malformed or missing candidate trees', () => {
  for (const tree of [{truncated: true, tree: []}, {truncated: false}, {truncated: false, tree: []},
    {truncated: false, tree: [{path: '.github', type: 'blob', sha: '4'.repeat(40)}]}]) {
    const {state, client} = fakeGithub(); state.head = '2'.repeat(40); const request = client.request;
    client.request = (method, endpoint, body) => endpoint.includes('/git/trees/') ? tree : request(method, endpoint, body);
    assert.throws(() => ensureDraft(candidate, directory, 'Synthetic notes.', client)); assert.deepEqual(state.writes, []);
  }
});

test('workflow compatibility inspects the actual default branch with an encoded ref name', () => {
  const {state, client} = fakeGithub(); state.defaultBranch = 'release/main'; const requests = [], request = client.request;
  client.request = (method, endpoint, body) => {requests.push(endpoint); return request(method, endpoint, body);};
  checkWorkflowCompatibility(context, client); assert(requests.includes(`repos/${context.repository}/git/ref/heads/release%2Fmain`));
});

test('a rejected draft request leaves no new tag and allows a fresh preflight', () => {
  const {state, client} = fakeGithub(), request = client.request;
  client.request = (method, endpoint, body) => {
    if (method === 'POST' && endpoint.endsWith('/releases')) throw new Error('Synthetic GitHub permission denial.');
    return request(method, endpoint, body);
  };
  assert.throws(() => ensureDraft(candidate, directory, 'Synthetic notes.', client), /permission denial/);
  assert.equal(state.ref, undefined); assert.equal(state.release, undefined); assert.deepEqual(state.writes, []);
  assert.match(preflightRelease(packageRoot, version, context, client), /Upgrade actions/);
});

test('workflow drift during draft creation stops before tag creation', () => {
  const {state, client} = fakeGithub(), request = client.request;
  client.request = (method, endpoint, body) => {
    const result = request(method, endpoint, body);
    if (method === 'POST' && endpoint.endsWith('/releases')) {state.head = '2'.repeat(40); state.workflowTree = '6'.repeat(40);}
    return result;
  };
  assert.throws(() => ensureDraft(candidate, directory, 'Synthetic notes.', client), /Start a fresh Harness release run on main/);
  assert.equal(state.ref, undefined); assert.equal(state.release.draft, true);
  assert.deepEqual(state.writes.map(write => write.endpoint), [`repos/${context.repository}/releases`]);
});

test('matching draft uploads can resume after default branch workflows change', () => {
  const {state, client} = fakeGithub(); state.failUpload = true;
  assert.throws(() => ensureDraft(candidate, directory, 'Synthetic notes.', client), /lost upload response/);
  state.head = '2'.repeat(40); state.workflowTree = '6'.repeat(40); state.writes.length = 0;
  ensureDraft(candidate, directory, 'Synthetic notes.', client);
  assert.equal(state.assets.length, 2); assert.deepEqual(state.writes.map(write => write.method), ['UPLOAD']);
});
test('a failed upload can resume the same draft without overwriting its first asset', () => {
  const {state, client} = fakeGithub(); state.failUpload = true;
  assert.throws(() => ensureDraft(candidate, directory, 'Synthetic release notes.', client), /lost upload response/);
  assert.equal(state.assets.length, 1); state.writes.length = 0;
  ensureDraft(candidate, directory, 'Synthetic release notes.', client);
  assert.equal(state.assets.length, 2); assert.deepEqual(state.writes.map(write => write.method), ['UPLOAD']);
});
test('publication while inspecting a partial draft stops before another asset upload', () => {
  const {state, client} = fakeGithub(); state.failUpload = true;
  assert.throws(() => ensureDraft(candidate, directory, 'Synthetic notes.', client), /lost upload response/);
  const download = client.download;
  client.download = endpoint => {const bytes = download(endpoint); state.release.draft = false; return bytes;};
  state.writes.length = 0;
  assert.throws(() => ensureDraft(candidate, directory, 'Synthetic notes.', client), /published releases/); assert.deepEqual(state.writes, []);
});
test('conflicting assets, tags, drafts and published releases stop before any further writes', () => {
  for (const change of [
    state => {state.release.draft = false;},
    state => {state.release.body = 'Another run.';},
    state => {state.ref.object.sha = '2'.repeat(40);},
    state => {state.assets[0].bytes = Buffer.from('different archive');},
    state => {state.assets.push({id: 3, name: 'unexpected.txt', state: 'uploaded', bytes: Buffer.from('extra')});}
  ]) {
    const {state, client} = fakeGithub(); ensureDraft(candidate, directory, 'Synthetic notes.', client); change(state); state.writes.length = 0;
    assert.throws(() => ensureDraft(candidate, directory, 'Synthetic notes.', client)); assert.deepEqual(state.writes, []);
  }
});
test('incomplete evidence or a changed local candidate prevents all GitHub mutations', t => {
  const root = evidence(t); edit(join(root, 'npm12-consumer-flow-ubuntu-24.04/consumer-flow.json'), data => ({...data, status: 'FAIL'}));
  const github = fakeGithub(); assert.throws(() => createDraft(packageRoot, directory, root, context, github.client)); assert.deepEqual(github.state.writes, []);
  const changed = candidateCopy(t); writeFileSync(join(changed, candidate.archive.name), 'changed');
  assert.throws(() => ensureDraft(candidate, changed, 'Synthetic notes.', github.client), /candidate changed/); assert.deepEqual(github.state.writes, []);
});
