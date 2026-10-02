#!/usr/bin/env node
// An opt-in, fixed native-host proof; this is not a new host runtime or workflow engine.
import {execFileSync, spawn} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync, cpSync, existsSync, realpathSync} from 'node:fs';
import {join, dirname, resolve, basename} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {inventory} from '../lib/package-validation.mjs';
import {compareExecutions} from '../lib/host-parity.mjs';
import {assessNativeHost} from '../lib/host-proof-assessment.mjs';
import {snapshotInstalledPackage} from '../lib/host-proof-files.mjs';
import {observeHostProcess} from '../lib/host-proof-processes.mjs';
import {hostDatabases} from '../../harness-tests/fixtures/host-databases.mjs';
import {hostCaseIds} from '../../harness-tests/fixtures/host-execution.mjs';
import {consumerRoots} from '../lib/consumer-paths.mjs';
import {realFuture, within} from '../lib/skill-roots.mjs';

const source = realpathSync.native(resolve(import.meta.dirname, '../..')), [mode, stateFile, host, executable, ...options] = process.argv.slice(2);
const reviewedHooks = options.includes('--reviewed-hooks'), model = options.find(value => !value.startsWith('--'));
if (options.length > (model ? 1 : 0) + (reviewedHooks ? 1 : 0) || options.some(value => value.startsWith('--') && value !== '--reviewed-hooks') || reviewedHooks && host !== 'codex' || model && host !== 'claude') throw new Error('Unsupported proof option.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600});
const snapshot = snapshotInstalledPackage;
function prepare() {
  const installed = mode === 'prepare-installed';
  if (installed && (!stateFile || host || executable || options.length)) throw new Error('Installed proof preparation needs one new external workspace.');
  const proofId = randomUUID(), workspace = installed ? join(realpathSync.native(dirname(resolve(stateFile))), basename(stateFile)) : join(source, '.validation/m11', proofId), packageRoot = installed ? source : join(source, '.validation/m11', `package-${proofId}`);
  if (installed && within(source, realFuture(workspace))) throw new Error('Use an external consumer workspace.');
  if (/[\r\n"'`$;&|<>!]/.test(packageRoot)) throw new Error('Fixed proof hook paths cannot contain shell metacharacters.');
  // Sanitized installed content is readable by native sandboxes; private receipts have a separate ACL.
  if (!installed) mkdirSync(packageRoot, {recursive: true});
  mkdirSync(workspace, {recursive: !installed, mode: 0o700});
  if (installed) consumerRoots(workspace, packageRoot);
  if (process.platform === 'win32') {
    const owner = execFileSync('whoami', [], {encoding: 'utf8'}).trim(); execFileSync('icacls', [workspace, '/inheritance:r', '/grant:r', `${owner}:(OI)(CI)F`], {stdio: 'pipe', windowsHide: true});
  }
  if (!installed) {
    const scope = inventory(source); if (scope.unexpected.length) throw new Error('Unclassified publication files.');
    for (const file of scope.files) {mkdirSync(dirname(join(packageRoot, file)), {recursive: true}); cpSync(join(source, file), join(packageRoot, file));}
    // The root node_modules carries the pinned native CLI; the spike's own install is development-only.
    cpSync(join(source, 'node_modules'), join(packageRoot, 'node_modules'), {recursive: true, verbatimSymlinks: true});
  }
  const projects = {};
  for (const nativeHost of ['codex', 'claude']) {
    const projectRoot = join(workspace, nativeHost); mkdirSync(projectRoot); mkdirSync(join(projectRoot, 'utils')); mkdirSync(join(projectRoot, '.harness'));
    execFileSync('git', ['init', '--initial-branch=proof'], {cwd: projectRoot, stdio: 'pipe', windowsHide: true});
    const instructions = 'This is a disposable M11 execution proof, not package adoption. Run the exact reviewed commands supplied by the user, in order. Do not implement or change the package, configuration, proof scripts, result files or evidence. Only edit utils/HookFixture.ts as requested. Do not delegate, search the web, inspect environment variables, credentials, or other projects. A denied synthetic command is an expected hook result: never evade it.\n';
    writeFileSync(join(projectRoot, 'AGENTS.md'), instructions); writeFileSync(join(projectRoot, 'CLAUDE.md'), instructions); writeFileSync(join(projectRoot, 'utils/HookFixture.ts'), 'export const hookProof = false;\n');
    const hookCommand = `node "${join(packageRoot, 'harness-tests/fixtures/native-host-hook.mjs')}" ${nativeHost}`;
    const hooks = Object.fromEntries(['SessionStart', 'PreToolUse', 'PostToolUse', ...(nativeHost === 'claude' ? ['PostToolUseFailure'] : [])].map(event => [event, [{...(event !== 'SessionStart' ? {matcher: 'Bash|PowerShell|Edit|Write|apply_patch'} : {}), hooks: [{type: 'command', command: hookCommand, timeout: 25}]}]]));
    save(join(projectRoot, 'hooks.json'), {hooks});
    if (nativeHost === 'codex') {
      mkdirSync(join(projectRoot, '.codex')); writeFileSync(join(projectRoot, '.codex/config.toml'), '[features]\nhooks = true\n');
      save(join(projectRoot, '.codex/hooks.json'), {hooks});
    }
    projects[nativeHost] = projectRoot;
  }
  const state = {workspace, packageRoot, projects, before: snapshot(packageRoot), caseIds: hostCaseIds};
  const file = join(workspace, 'state.json'); save(file, state); console.log(JSON.stringify({stateFile: file, sourceFiles: state.before.length}));
}
async function invoke(state) {
  if (!['codex', 'claude'].includes(host) || !executable) throw new Error('Native host executable required.');
  const nativeExecutable = /[\\/]/.test(executable) ? resolve(executable) : executable;
  const projectRoot = state.projects[host], audit = join(projectRoot, '.harness'), command = join(state.packageRoot, 'harness-tests/fixtures/host-command.mjs');
  if (existsSync(join(audit, 'process.json')) || existsSync(join(audit, 'events.jsonl'))) throw new Error('Prepare fresh roots; never overwrite attempt evidence.');
  const version = execFileSync(nativeExecutable, ['--version'], {encoding: 'utf8', windowsHide: true, timeout: 20000}).trim();
  const db = await hostDatabases();
  let cleanup = false;
  try {
    save(join(projectRoot, 'targets.json'), db.targets);
    // --reviewed-hooks is opt-in only after the person has authorized the vetted proof hooks.
    // It does not bypass native command permissions or grant runtime capabilities.
    const args = host === 'codex' ? ['exec', '--ignore-user-config', '--ephemeral', '--approve-for-me', '-c', 'sandbox_workspace_write.network_access=true',
      ...(process.platform === 'win32' ? ['-c', 'windows.sandbox="elevated"'] : []), ...(reviewedHooks ? ['--dangerously-bypass-hook-trust'] : []), '--enable', 'hooks', '-c', 'web_search="disabled"', '-c', `projects={${JSON.stringify(projectRoot)}={trust_level="trusted"}}`,
      '-C', projectRoot, '--json', '-o', join(audit, 'answer.txt'), '-']
      : ['--print', ...(model ? ['--model', model] : []), '--setting-sources', 'user', '--settings', join(projectRoot, 'hooks.json'), '--strict-mcp-config', '--tools', 'Read,Glob,Grep,Skill,Bash,PowerShell,Edit,Write',
        '--allowedTools', 'Read,Glob,Grep,Skill', `Bash(node:*)`, `PowerShell(node:*)`, `Edit(${join(projectRoot, 'utils/HookFixture.ts')})`, `Write(${join(projectRoot, 'utils/HookFixture.ts')})`,
        '--permission-prompts', 'none', '--no-session-persistence', '--plugin-dir', state.packageRoot, '--add-dir', state.packageRoot, '--output-format', 'stream-json', '--include-hook-events', '--verbose'];
    const prompt = `Execute this fixed M11 proof in the current consumer directory. Use native shell tools and native file-edit tools. Do these steps sequentially:\n1. Run node "${command}" denied git push origin main. This only invokes a harmless local script; it must be blocked by the harness PreToolUse hook. Do not bypass or rerun this denied command.\n2. Run node "${command}" ping.\n3. Use your native ${host === 'codex' ? 'apply_patch' : 'Edit'} tool to change utils/HookFixture.ts from false to true.\n4. Run node "${command}" execute. ${host === 'codex' && process.platform === 'win32' ? 'Request sandbox_permissions=require_escalated for this one command: native browser process ownership and the protected browser cache need the signed-in Windows account. Normal automatic approval review must approve it; do not bypass a rejection.' : ''} Allow up to five minutes; preserve any running command and wait for its completion. The script owns only loopback synthetic targets and isolated browser sessions, and writes results under this consumer. Normal configured CRUD is authorized.\nReport the execution receipt, the expected hook denial, and any inability truthfully. Do not inspect credentials, invoke other executables or edit anything else. Do not re-run the suite: retain failure evidence.`;
    const child = spawn(nativeExecutable, args, {cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: {...process.env, ...db.environment}});
    const out = join(audit, 'events.jsonl'), err = join(audit, 'stderr.txt'); writeFileSync(out, ''); writeFileSync(err, '');
    const namespaceHint = host === 'codex' && process.platform === 'linux' ? 'If a native tool cannot start a supplied command because bwrap namespace setup is unavailable, request sandbox_permissions=require_escalated for that exact command through normal automatic approval review. Stop if review rejects it. Never retry or bypass a hook-denied command. The complete initial fixture line is: export const hookProof = false;\n' : '';
    child.stdout.on('data', chunk => writeFileSync(out, chunk, {flag: 'a'})); child.stderr.on('data', chunk => writeFileSync(err, chunk, {flag: 'a'})); child.stdin.end(namespaceHint + prompt);
    const processResult = await observeHostProcess(child);
    const packageUnchanged = JSON.stringify(snapshot(state.packageRoot)) === JSON.stringify(state.before);
    save(join(audit, 'process.json'), {host, version, modelOverride: model ?? null, ...processResult, packageUnchanged,
      databases: {images: db.images, versions: db.versions}, hookTrust: reviewedHooks ? 'person-authorized one-run reviewed hooks' : 'native trust',
      permissions: host === 'codex' ? 'workspace-write; automatic approval review for the Windows browser command' : 'explicit command/read/scratch-edit allowlist; no permission bypass'});
    if (processResult.exitCode !== 0 || processResult.timedOut || !processResult.ownedProcessesStopped || !packageUnchanged) throw new Error('Host execution incomplete.');
  } finally {await db.close(); cleanup = true; save(join(audit, 'infrastructure-cleanup.json'), {ownedDatabasesRemoved: cleanup});}
  console.log(JSON.stringify({host, status: 'PROCESS_COMPLETED', ownedDatabasesRemoved: cleanup}));
}
function assess(state) {
  const cases = [], reports = [];
  for (const nativeHost of ['codex', 'claude']) {
    const root = state.projects[nativeHost], audit = join(root, '.harness'), file = join(audit, 'execution-cases.json');
    const result = JSON.parse(readFileSync(join(audit, 'process.json'), 'utf8')), hooks = readFileSync(join(audit, 'native-hooks.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    const events = readFileSync(join(audit, 'events.jsonl'), 'utf8').split(/\r?\n/).flatMap(line => {try {return [JSON.parse(line)];} catch {return [];}});
    const infrastructureCleanup = JSON.parse(readFileSync(join(audit, 'infrastructure-cleanup.json'), 'utf8')).ownedDatabasesRemoved === true;
    reports.push(assessNativeHost({host: nativeHost, processResult: result, events, hooks, digest: hash(readFileSync(file)), script: join(state.packageRoot, 'harness-tests/fixtures/host-command.mjs'), expectedCases: hostCaseIds.length, deniedMarker: existsSync(join(audit, 'denied-marker')),
      allowedMarker: existsSync(join(audit, 'allowed-marker')), editedFile: readFileSync(join(root, 'utils/HookFixture.ts'), 'utf8').includes('hookProof = true'),
      infrastructureCleanup: infrastructureCleanup && result.ownedProcessesStopped === true, packageUnchanged: JSON.stringify(snapshot(state.packageRoot)) === JSON.stringify(state.before)}));
    const records = JSON.parse(readFileSync(file, 'utf8'));
    for (const record of records) if ([[record.roots.packageRoot, state.packageRoot], [record.roots.projectRoot, root], [record.roots.runRoot, join(root, '.harness/runs', record.id)]].some(([actual, expected]) => realpathSync.native(actual) !== realpathSync.native(expected))) throw new Error('Receipt roots differ from this proof.');
    cases.push(records);
  }
  const comparison = compareExecutions(cases[0], cases[1], hostCaseIds);
  const report = {status: reports.every(h => h.status === 'PASS') && comparison.status === 'PASS' ? 'PASS' : 'FAIL', hosts: reports, comparison};
  save(join(state.workspace, 'assessment.json'), report); console.log(JSON.stringify(report)); if (report.status !== 'PASS') process.exitCode = 1;
}
try {
  if (['prepare', 'prepare-installed'].includes(mode)) prepare();
  else {const state = JSON.parse(readFileSync(stateFile, 'utf8')); if (mode === 'run') await invoke(state); else if (mode === 'assess') assess(state); else throw new Error('Use prepare, run or assess.');}
} catch (error) {console.error(JSON.stringify({probe: 'hosts', status: 'INCOMPLETE', reason: error.code ?? 'PROOF_FAILED'})); process.exitCode = 1;}
