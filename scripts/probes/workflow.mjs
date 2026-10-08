#!/usr/bin/env node
// Fixed M15 end-to-end proof. No production scheduler, workflow DSL or host adapter is introduced.
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync, cpSync, existsSync, symlinkSync, realpathSync, appendFileSync} from 'node:fs';
import {join, dirname, resolve, basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {setTimeout as pause} from 'node:timers/promises';
import {inventory} from '../lib/package-validation.mjs';
import {adoptProject} from '../lib/adoption.mjs';
import {consumerRoots} from '../lib/consumer-paths.mjs';
import {realFuture, within} from '../lib/skill-roots.mjs';
import {digest, fingerprint} from '../lib/execution-core/data.mjs';
import {snapshotInstalledPackage} from '../lib/host-proof-files.mjs';
import {observeHostProcess} from '../lib/host-proof-processes.mjs';
import {parseEvents} from '../lib/skill-proof-assessment.mjs';
import {assessWorkflowHost, workflowAuthoredFiles} from '../lib/workflow-host-evidence.mjs';
import {compareWorkflows, workflowSemantics} from '../lib/workflow-parity.mjs';
import {transaction} from '../lib/generation/storage.mjs';
import {workflowCases, workflowExecutionIds, generatedExecutionIds} from '../../harness-tests/fixtures/workflow.mjs';
import {hostDatabases} from '../../harness-tests/fixtures/host-databases.mjs';

const source = realpathSync.native(resolve(import.meta.dirname, '../..')), [mode, stateFile, host, executable, model] = process.argv.slice(2), fixture = workflowCases();
const expected = {source: fixture.source, executionIds: workflowExecutionIds, generatedIds: generatedExecutionIds};
const save = (path, value) => {mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600});};
const read = path => JSON.parse(readFileSync(path, 'utf8'));
function protect(path) {
  if (process.platform === 'win32') {
    const owner = execFileSync('whoami', [], {encoding: 'utf8', windowsHide: true}).trim();
    execFileSync('icacls', [path, '/inheritance:r', '/grant:r', `${owner}:(OI)(CI)F`], {stdio: 'pipe', windowsHide: true});
  }
}
function prepare() {
  const installed = mode === 'prepare-installed';
  const id = randomUUID(), workspace = installed ? join(realpathSync.native(dirname(resolve(stateFile))), basename(stateFile)) : join(source, '.validation/m15', id), packageRoot = installed ? source : join(source, '.validation/m15', `package-${id}`);
  assert(!installed || !within(source, realFuture(workspace)), 'Use an external consumer workspace.');
  mkdirSync(workspace, {recursive: !installed, mode: 0o700}); protect(workspace);
  if (!installed) {
    mkdirSync(packageRoot, {recursive: true});
    const scope = inventory(source); assert.equal(scope.unexpected.length, 0);
    for (const file of scope.files) {mkdirSync(dirname(join(packageRoot, file)), {recursive: true}); cpSync(join(source, file), join(packageRoot, file));}
    // The root node_modules carries the pinned native CLI; the spike's own install is development-only.
    for (const path of ['node_modules', 'examples/node_modules']) cpSync(join(source, path), join(packageRoot, path), {recursive: true, verbatimSymlinks: true});
  }
  const projects = {}, scaffolds = {};
  for (const nativeHost of ['claude', 'codex']) {
    const projectRoot = join(workspace, nativeHost); mkdirSync(projectRoot);
    execFileSync('git', ['init', '--initial-branch=proof'], {cwd: projectRoot, stdio: 'pipe', windowsHide: true});
    adoptProject({projectRoot, installedRoot: packageRoot, environment: 'qa', mode: 'test'});
    const rules = '\nM15 fixed synthetic consumer: follow the supplied stage prompt and canonical skills. Only author the four named page/service/spec files, refinement.json, and .harness/knowledge-candidates/workflow.json. Do not edit source, test data, helpers, configuration, package files, receipts, reviewed knowledge or Git. Do not inspect credentials, environment variables, other consumers or unrelated run artifacts. No web searches or external delivery. Do not delegate inside this host; the parent supplies an actual independent review. Existing test-profile CRUD on the owned synthetic targets is authorized. Native permissions still apply.\n';
    for (const file of ['AGENTS.md', 'CLAUDE.md']) appendFileSync(join(projectRoot, file), rules);
    for (const file of ['playwright.config.ts', 'src/config/applications.ts', 'src/utils/Expects.ts']) {
      mkdirSync(dirname(join(projectRoot, file)), {recursive: true}); cpSync(join(packageRoot, 'harness-tests/fixtures/generation-consumer', file), join(projectRoot, file));
    }
    cpSync(join(packageRoot, 'harness-tests/fixtures/workflow-consumer'), projectRoot, {recursive: true});
    save(join(projectRoot, 'source.json'), fixture.source); save(join(projectRoot, 'resources/testData/ObservationTestJsonFile.json'), fixture.testData);
    save(join(projectRoot, '.harness/workflow/source-context.json'), {version: 1, sourceFingerprint: fingerprint(fixture.source), scenarios: fixture.cases.map(c => ({id: c.id, expectationKeys: [c.key]}))});
    save(join(projectRoot, '.harness/knowledge/fixture-contract.json'), {version: 1, origin: 'reviewed synthetic fixture', value: 'Runtime observations remain knowledge candidates until separately reviewed.'});
    const dependencies = {}, versions = {};
    for (const name of ['@playwright/test', 'playwright', 'playwright-core', 'allure-js-commons', 'allure-playwright', 'allure', '@types/node', 'typescript']) {
      const target = join(projectRoot, 'node_modules', name), original = join(packageRoot, 'examples/node_modules', name);
      mkdirSync(dirname(target), {recursive: true}); symlinkSync(original, target, process.platform === 'win32' ? 'junction' : 'dir');
      versions[name] = dependencies[name] = read(join(original, 'package.json')).version;
    }
    const alias = join(projectRoot, '.harness/packages/playwright-pom-harness'); mkdirSync(dirname(alias), {recursive: true}); symlinkSync(packageRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
    symlinkSync(alias, join(projectRoot, 'node_modules/playwright-pom-harness'), process.platform === 'win32' ? 'junction' : 'dir');
    dependencies['playwright-pom-harness'] = 'file:./.harness/packages/playwright-pom-harness'; versions['playwright-pom-harness'] = read(join(packageRoot, 'package.json')).version;
    save(join(projectRoot, 'package.json'), {name: 'synthetic-m15-consumer', private: true, type: 'module', devDependencies: dependencies});
    save(join(projectRoot, 'dependency-versions.json'), {version: 1, proof: installed ? 'npm-archive' : 'linked-source', node: process.version, packages: versions});
    save(join(projectRoot, 'tsconfig.json'), {compilerOptions: {target: 'ES2021', module: 'NodeNext', moduleResolution: 'NodeNext', allowJs: true, checkJs: false, maxNodeModuleJsDepth: 1, strict: true, esModuleInterop: true, resolveJsonModule: true, skipLibCheck: true, noEmit: true, types: ['node']}, exclude: ['node_modules', '.harness']});
    projects[nativeHost] = projectRoot;
    scaffolds[nativeHost] = ['source.json', 'resources/testData/ObservationTestJsonFile.json', 'playwright.config.ts', 'src/config/applications.ts', 'src/utils/Expects.ts', 'src/utils/RuntimeActions.ts', 'src/utils/LifecycleActions.ts', 'package.json', 'dependency-versions.json', 'tsconfig.json', '.harness/knowledge/fixture-contract.json', '.harness/workflow/source-context.json'].map(path => ({path, sha256: digest(readFileSync(join(projectRoot, path)))}));
  }
  const state = {workspace, packageRoot, projects, scaffolds, before: snapshotInstalledPackage(packageRoot)};
  const file = join(workspace, 'state.json'); save(file, state); console.log(JSON.stringify({stateFile: file, installedEntries: state.before.length, scenarios: fixture.cases.length}));
}
function intact(state, host) {
  assert.deepEqual(snapshotInstalledPackage(state.packageRoot), state.before, 'Installed package changed.');
  for (const file of state.scaffolds[host]) assert.equal(digest(readFileSync(join(state.projects[host], file.path))), file.sha256, 'Consumer scaffold or reviewed input changed.');
}
function authorPrompt(state, round) {
  const root = state.projects[host], command = join(state.packageRoot, 'harness-tests/fixtures/workflow-command.mjs');
  const escalation = host === 'codex' && process.platform === 'win32' ? 'For the supplied Node proof commands request sandbox_permissions=require_escalated, with normal automatic approval review, because protected browser/process ownership and private proof state require the signed-in Windows account. Never bypass rejection.' : '';
  return `${host === 'claude' ? '/playwright-pom-harness:automate-test' : '$automate-test'}\nComplete M15 AUTHOR round ${round} in this synthetic consumer. This is package acceptance testing, not external delivery. ${escalation}
Explicitly READ the canonical ${join(state.packageRoot, '.agents/skills/automate-test/SKILL.md')} and the COMPLETE source.json through a native read tool, even if the skill was expanded. Read ${join(state.packageRoot, 'docs/PIPELINE.md')}, ${join(state.packageRoot, 'docs/reporting.md')} and the relevant canonical POM/page/service/test/action/validation skills and references. Do not maintain skill copies. Invoke the supplied Node commands directly from the current consumer directory. Do not add shell chains or inspect environment variables; the runtime resolves secret references internally.
Read the canonical skill and source individually in full, with enough output capacity: use the native Read tool or a separate cat "<absolute-file>" / Get-Content -Raw -LiteralPath "<absolute-file>" command for each. Do not truncate or concatenate these two evidence reads.
${round === 0 ? `Before execution, read .harness/workflow/source-context.json and write refinement.json with {version:1,sourceFingerprint,scenarios:[{id,expectationKeys,notes}]} in source order. Notes explain your implementation choice without altering source intent. Only then run exactly: node "${command}" explore. It validates and freezes that refinement before executing the owned browser/API/two-database observations and controlled negative cases; allow up to five minutes and preserve/wait on its running command. Do not rerun exploration or later rewrite refinement.json. After exploration, read .harness/workflow/context.json and write .harness/knowledge-candidates/workflow.json with {version:1,sourceFingerprint,status:"UNREVIEWED",facts:<the observed facts from context.json>}. Never promote these into reviewed knowledge.` : 'Read the latest actual review under .harness/workflow/reviews and repair only its findings; preserve original refinement, exploration, knowledge candidates and all prior history.'}
Read the immutable resources/testData/ObservationTestJsonFile.json.
Use your native ${host === 'codex' ? 'apply_patch' : 'Write/Edit'} tools to author these files: ${workflowAuthoredFiles.join(', ')}. You may read the installed generation-consumer fixture as a style reference but must author this consumer's source-specific POM code. Preserve every source scenario and exact title. One spec tests/ObservationTests.spec.ts, test.describe('Workflow observations'), native project proof, 16 explicit independent test bodies; no loops or branches in specs. JSON data loads in beforeAll; page/service instances initialize in beforeEach with native page fixture. Await allure.feature and allure.testCaseId with the original scenario id; never invent TMS links.
ObservationPage navigates to applications.observation.url and verifies exact #observation heading text with expectToHaveText. ApisObservations and DbsObservations have observe(definition,description), exerciseLifecycle(caseId), and verifyObservation(expected). They delegate to the existing immutable RuntimeActions.observe or LifecycleActions.execute respectively and keep the returned assessed result. Business actions and validations each have an allure-js-commons step. verifyObservation calls expectToEqual on result.status through the local Expects facade. Keep source keys in harness artifacts, never in business methods or JSON test data. Runtime and lifecycle helpers attach complete assessed results inside technical steps; do not duplicate transport, SQL, cleanup or reporting code.
For data entries with definition, call observe; for entries with execution, call exerciseLifecycle using the data entry's id. Verify using the same data entry's expected value. The six lifecycle cases test the harness's already reviewed deterministic callbacks on actual synthetic targets, including persistence/restoration; these fixtures are test-only, not a new consumer automation API.
Then run exactly: node "${command}" candidate. It performs meaningful convention/type checks and freezes this candidate for a DIFFERENT independent reviewer. If a pre-freeze check fails, read only this attempt's private failure diagnostic, fix the generated code and rerun candidate after that edit. Do not run tests, approve/review yourself, invoke complete, alter helpers/config/data, or publish anything. Finish by reporting the candidate receipt and any inability truthfully.`;
}
async function nativeStage(state, name, prompt, environment, version) {
  const projectRoot = state.projects[host], directory = join(projectRoot, '.harness/workflow/native', name); mkdirSync(directory, {recursive: true});
  const eventPath = join(directory, 'events.jsonl'); assert(!existsSync(eventPath), 'Native stage history already exists.');
  const allowedWrites = [...workflowAuthoredFiles, 'refinement.json', '.harness/knowledge-candidates/workflow.json'];
  const args = host === 'codex' ? ['exec', '--ignore-user-config', '--ephemeral', '--approve-for-me', '-c', 'sandbox_workspace_write.network_access=true',
    ...(process.platform === 'win32' ? ['-c', 'windows.sandbox="elevated"'] : []), '-c', 'features.hooks=false', '-c', 'web_search="disabled"', '-c', `projects={${JSON.stringify(projectRoot)}={trust_level="trusted"}}`, '-C', projectRoot, '--json', '-o', join(directory, 'answer.txt'), '-']
    : ['--print', ...(model ? ['--model', model] : []), '--setting-sources', 'user', '--settings', JSON.stringify({disableAllHooks: true}), '--strict-mcp-config', '--tools', 'Read,Glob,Grep,Skill,Bash,PowerShell,Edit,Write',
      '--allowedTools', 'Read,Glob,Grep,Skill', 'Bash(node:*)', 'PowerShell(node:*)', ...allowedWrites.flatMap(file => [`Write(${join(projectRoot, file)})`, `Edit(${join(projectRoot, file)})`]),
      '--permission-prompts', 'none', '--no-session-persistence', '--plugin-dir', state.packageRoot, '--add-dir', state.packageRoot, '--output-format', 'stream-json', '--verbose'];
  const nativeExecutable = /[\\/]/.test(executable) ? resolve(executable) : executable;
  const child = spawn(nativeExecutable, args, {cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: {...process.env, ...environment}});
  writeFileSync(eventPath, ''); const errorPath = join(directory, 'stderr.txt'); writeFileSync(errorPath, '');
  const namespaceHint = host === 'codex' && process.platform === 'linux' ? 'If a native tool cannot start a supplied proof command or requested file read because bwrap namespace setup is unavailable, request sandbox_permissions=require_escalated for that exact operation through normal automatic approval review. Stop if review rejects it. Do not replay a command that actually started or bypass a denied operation.\n' : '';
  child.stdout.on('data', chunk => appendFileSync(eventPath, chunk)); child.stderr.on('data', chunk => appendFileSync(errorPath, chunk)); child.stdin.end(namespaceHint + prompt);
  const processResult = {...await observeHostProcess(child, {timeoutMs: 1200000}), version, packageUnchanged: fingerprint(snapshotInstalledPackage(state.packageRoot)) === fingerprint(state.before)};
  save(join(directory, 'process.json'), processResult); intact(state, host);
  assert(processResult.exitCode === 0 && !processResult.timedOut && processResult.ownedProcessesStopped && processResult.packageUnchanged, 'Native workflow stage incomplete.');
  return {events: parseEvents(readFileSync(eventPath, 'utf8')), processResult};
}
async function run(state) {
  assert(['claude', 'codex'].includes(host) && executable && (!model || host === 'claude'));
  const root = state.projects[host], audit = join(root, '.harness/workflow'), roots = consumerRoots(root, state.packageRoot);
  assert(!existsSync(join(audit, 'started.json')), 'Prepare fresh roots after a failed proof; never overwrite evidence.');
  save(join(audit, 'started.json'), {host, stateFile, startedAt: Date.now()});
  const version = execFileSync(/[/\\]/.test(executable) ? resolve(executable) : executable, ['--version'], {encoding: 'utf8', timeout: 20000, windowsHide: true}).trim();
  let databases, ready = false, serverClosed = false, databasesRemoved = false;
  const server = createServer((req, res) => {if (req.url === '/observation') {res.setHeader('content-type', 'application/json'); res.end('{"value":42}');}
    else {res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Observation</title><h1 id="observation">Observed fixture</h1>');}});
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
    databases = await hostDatabases();
    // These disposable, explicit profiles are infrastructure setup, before any active run freezes them.
    writeFileSync(join(root, '.harness/project.json'), JSON.stringify({version: 1, defaultEnvironment: 'qa', environments: {qa: {environmentMode: 'test', apiTargets: ['api'], databaseTargets: ['sqlserver', 'postgresql'], browserTargets: ['app']}}}));
    writeFileSync(join(root, '.harness/targets.json'), JSON.stringify({api: {api: {baseUrl: origin}}, databases: databases.targets, browser: {app: {origins: [origin]}}}));
    const environment = {...databases.environment, HARNESS_PROOF_ORIGIN: origin, HARNESS_WORKFLOW_HOST: host};
    for (let round = 0; round <= 3 && !ready; round++) {
      const author = await nativeStage(state, `author-${round}`, authorPrompt(state, round), environment, version);
      const generation = await transaction(roots, fixture.source.id, state => state), candidate = generation.candidates.at(-1); assert(candidate && candidate.round === round, 'Host did not register its candidate.');
      const commands = [...(round === 0 ? [{command: 'explore', stage: 'explore', sha256: digest(readFileSync(join(audit, 'exploration.json'))), scenarios: fixture.cases.length}] : []),
        {command: 'candidate', stage: 'candidate', sha256: digest(readFileSync(join(audit, 'candidates', `${candidate.revision}.json`))), scenarios: fixture.cases.length}];
      const authorEvidence = assessWorkflowHost({host, roots, ...author, commands, authoring: round === 0}); save(join(audit, `author-${round}-assessment.json`), authorEvidence); assert.equal(authorEvidence.status, 'PASS', 'Native author evidence is incomplete.');
      const reviewInput = join(audit, 'reviews', `${candidate.revision}.json`), descriptor = {host, round, sourceId: fixture.source.id, revision: candidate.revision, fingerprint: candidate.snapshot.fingerprint, projectRoot: root, packageRoot: state.packageRoot, reviewInput, stateFile};
      save(join(state.workspace, `${host}-review-${round}.json`), descriptor); console.log(JSON.stringify({status: 'AWAITING_INDEPENDENT_REVIEW', ...descriptor}));
      const deadline = Date.now() + 3600000; while (!existsSync(reviewInput)) {assert(Date.now() < deadline, 'Independent review deadline expired.'); await pause(1000);}
      const input = read(reviewInput); assert.equal(input.revision, candidate.revision); assert.notEqual(input.reviewer, generation.author);
      const command = join(state.packageRoot, 'harness-tests/fixtures/workflow-command.mjs');
      const completion = await nativeStage(state, `complete-${round}`, `The parent has supplied the actual independent review for revision ${candidate.revision}. Run exactly: node "${command}" complete. ${host === 'codex' && process.platform === 'win32' ? 'Request sandbox_permissions=require_escalated with normal automatic approval review for this owned proof command.' : ''} It records that review; only an approval releases two independent sequential scoped verifications and Allure generation. Wait for completion, up to ten minutes. Do not edit files, inspect credentials, change expectations, repeat a failed command or perform external delivery. Report the exact receipt and any inability.`, environment, version);
      const approved = input.verdict === 'APPROVE', resultFile = approved ? join(audit, 'completed.json') : join(audit, 'rejected', `${candidate.revision}.json`);
      const completionEvidence = assessWorkflowHost({host, roots, ...completion, commands: [{command: 'complete', stage: approved ? 'complete' : 'review-rejected', sha256: digest(readFileSync(resultFile)), scenarios: fixture.cases.length}]});
      save(join(audit, `complete-${round}-assessment.json`), completionEvidence); assert.equal(completionEvidence.status, 'PASS'); ready = approved;
    }
    assert(ready, 'The cumulative repair budget was exhausted.');
    const semantic = await workflowSemantics(roots, expected); save(join(audit, 'semantic.json'), semantic);
    save(join(audit, 'host.json'), {host, version, model: model ?? null, ready, packageUnchanged: true, databases: {images: databases.images, versions: databases.versions}, permissions: host === 'codex' ? 'Native automatic approval review; no hook-trust override' : 'Explicit read/Node/consumer-authoring allowlist; no permission bypass'});
  } finally {
    server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); serverClosed = true;
    try {if (databases) {await databases.close(); databasesRemoved = true;}} finally {save(join(audit, 'cleanup.json'), {serverClosed, databasesRemoved});}
  }
  console.log(JSON.stringify({host, status: ready && databasesRemoved ? 'PASS' : 'INCOMPLETE', scenarios: fixture.cases.length, serverClosed, databasesRemoved}));
}
async function assess(state) {
  for (const host of ['claude', 'codex']) {
    intact(state, host); const audit = join(state.projects[host], '.harness/workflow');
    assert.deepEqual(read(join(audit, 'cleanup.json')), {serverClosed: true, databasesRemoved: true}); assert.equal(read(join(audit, 'host.json')).ready, true);
    const generation = await transaction(consumerRoots(state.projects[host], state.packageRoot), fixture.source.id, state => state);
    for (let round = 0; round <= generation.rounds; round++) {
      const candidate = generation.candidates[round], candidateFile = join(audit, 'candidates', `${candidate.revision}.json`), metadata = read(candidateFile);
      assert.equal(metadata.fingerprint, candidate.snapshot.fingerprint); assert.equal(metadata.revision, candidate.revision);
      if (round === generation.rounds) {
        assert.equal(metadata.notes.refinement, digest(readFileSync(join(state.projects[host], 'refinement.json'))));
        assert.equal(metadata.notes.knowledge, digest(readFileSync(join(state.projects[host], '.harness/knowledge-candidates/workflow.json'))));
      }
      for (const stage of ['author', 'complete']) {
        const nativeRoot = join(audit, 'native', `${stage}-${round}`), review = read(join(audit, 'reviews', `${candidate.revision}.json`));
        const completed = review.verdict === 'APPROVE', completeFile = completed ? join(audit, 'completed.json') : join(audit, 'rejected', `${candidate.revision}.json`);
        const commands = stage === 'author' ? [...(round === 0 ? [{command: 'explore', stage: 'explore', sha256: digest(readFileSync(join(audit, 'exploration.json'))), scenarios: fixture.cases.length}] : []),
          {command: 'candidate', stage: 'candidate', sha256: digest(readFileSync(candidateFile)), scenarios: fixture.cases.length}]
          : [{command: 'complete', stage: completed ? 'complete' : 'review-rejected', sha256: digest(readFileSync(completeFile)), scenarios: fixture.cases.length}];
        const evidence = assessWorkflowHost({host, roots: consumerRoots(state.projects[host], state.packageRoot),
          events: parseEvents(readFileSync(join(nativeRoot, 'events.jsonl'), 'utf8')), processResult: read(join(nativeRoot, 'process.json')), commands, authoring: stage === 'author' && round === 0});
        assert.equal(evidence.status, 'PASS'); assert.deepEqual(evidence, read(join(audit, `${stage}-${round}-assessment.json`)));
      }
    }
  }
  const report = await compareWorkflows(consumerRoots(state.projects.claude, state.packageRoot), consumerRoots(state.projects.codex, state.packageRoot), expected);
  save(join(state.workspace, 'assessment.json'), report); console.log(JSON.stringify(report)); if (report.status !== 'PASS') process.exitCode = 1;
}
try {
  const count = process.argv.length - 2;
  assert((mode === 'prepare' && count === 1) || (mode === 'prepare-installed' && count === 2) || (mode === 'assess' && count === 2) || (mode === 'run' && (count === 4 || count === 5)), 'Use prepare, prepare-installed <new-external-workspace>, assess <state>, or run <state> <host> <executable> [Claude model].');
  if (['prepare', 'prepare-installed'].includes(mode)) prepare();
  else {const state = read(stateFile); if (mode === 'run') await run(state); else if (mode === 'assess') await assess(state); else throw new Error('Use prepare, run or assess.');}
} catch (error) {
  if (mode !== 'prepare-installed' && stateFile && existsSync(stateFile)) {
    const state = read(stateFile); save(join(state.workspace, `failure-${host ?? 'assessment'}-${Date.now()}.json`), {diagnostic: String(error.stack)});
  }
  console.error(JSON.stringify({probe: 'workflow', status: 'INCOMPLETE', reason: error.code ?? 'PROOF_FAILED'})); process.exitCode = 1;
}
