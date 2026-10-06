#!/usr/bin/env node
// Owned live M13 proof. Pauses for an actual independent review artifact before running generated tests.
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, cpSync, symlinkSync, writeFileSync, readFileSync, existsSync, realpathSync, readdirSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {packageRoot, consumerRoots} from '../lib/consumer-paths.mjs';
import {createRun, defineOperation} from '../lib/execution-core/index.mjs';
import {createApiRuntime, defineApiOperation} from '../lib/api/index.mjs';
import {createDatabaseRuntime, defineDatabaseOperation} from '../lib/database/index.mjs';
import {browserLifecycleOperations, runBrowserScenario} from '../lib/browser/index.mjs';
import {loadEnvironment} from '../lib/project-config.mjs';
import {beginGeneration, createGenerationHandoff, registerCandidate, recordGenerationReview, generationStatus} from '../lib/generation/index.mjs';
import {verifyGeneration} from '../lib/generation/verify.mjs';
import {transaction} from '../lib/generation/storage.mjs';
import {fingerprint} from '../lib/execution-core/data.mjs';
import {writeReports} from '../lib/reporting/index.mjs';
import {generateAllure} from '../lib/reporting/allure.mjs';
import {hostDatabases} from '../../harness-tests/fixtures/host-databases.mjs';
import {generationCases} from '../../harness-tests/fixtures/generation.mjs';

const args = process.argv.slice(2), reporting = args.includes('--reports');
if (reporting) args.splice(args.indexOf('--reports'), 1);
const repairRoot = args.length === 2 && args[0] === '--repair-consumer' ? resolve(args[1]) : undefined;
if (args.length && !repairRoot) throw new Error('Use --reports optionally, with no other arguments or --repair-consumer for its reviewed repair.');
const projectRoot = repairRoot ?? mkdtempSync(join(tmpdir(), `harness-${reporting ? 'm14' : 'm13'}-consumer-`)), roots = consumerRoots(projectRoot), proofId = `proof-${randomUUID()}`;
const fixture = generationCases();
const audit = join(packageRoot, reporting ? '.validation/m14' : '.validation/m13', proofId); mkdirSync(audit, {recursive: true});
const put = (path, value) => {mkdirSync(dirname(join(projectRoot, path)), {recursive: true}); writeFileSync(join(projectRoot, path), typeof value === 'string' ? value : JSON.stringify(value, null, 2));};
const check = (name, args) => {
  const output = execFileSync(process.execPath, args, {cwd: projectRoot, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000});
  writeFileSync(join(audit, `${name}.txt`), output); return output.trim();
};
const server = createServer((request, response) => {
  if (request.url === '/observation') {response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({value: 42}));}
  else {response.setHeader('content-type', 'text/html'); response.end('<!doctype html><title>Observation</title><h1 id="observation">Observed fixture</h1>');}
});
let databases, success = false;
try {
  if (repairRoot) await transaction(roots, fixture.source.id, state => {
    assert.equal(state?.author, 'm13-author', 'Repair only this probe\'s consumer.');
    assert.equal(fingerprint(state.handoff.source), fingerprint(fixture.source), 'Keep the original source intent.');
    assert.equal(state.reviews.at(-1)?.verdict, 'CHANGES-REQUIRED', 'Repair follows an actual review rejection.');
    assert.equal(state.runs.length, 0, 'This focused proof repair must not replay executed scenarios.');
    const original = state.handoff.observations.map(observation => {
      const runRoot = join(projectRoot, '.harness/runs', observation.runId), saved = JSON.parse(readFileSync(join(runRoot, 'inputs.json'), 'utf8'));
      const run = createRun({...saved.inputs, id: saved.id, startedAt: saved.startedAt});
      assert.equal(run.inputFingerprint, saved.inputFingerprint);
      return {run, roots: {...roots, runRoot}, observations: JSON.parse(readFileSync(join(runRoot, 'observations.json'), 'utf8'))};
    });
    assert.equal(createGenerationHandoff(fixture.source, original, state.handoff.bindings).fingerprint, state.handoff.fingerprint, 'Original evidence must still reassess identically.');
  });
  if (process.platform === 'win32') {
    const owner = execFileSync('whoami', [], {encoding: 'utf8', windowsHide: true}).trim();
    execFileSync('icacls', [projectRoot, '/inheritance:r', '/grant:r', `${owner}:(OI)(CI)F`], {stdio: 'pipe', windowsHide: true});
  }
  cpSync(join(packageRoot, 'harness-tests/fixtures/generation-consumer'), projectRoot, {recursive: true});
  const dependencies = {}, versions = {};
  for (const name of ['@playwright/test', 'playwright', 'playwright-core', 'allure-js-commons', '@types/node', 'typescript', ...(reporting ? ['allure-playwright', 'allure'] : [])]) {
    const target = join(projectRoot, 'node_modules', name); mkdirSync(dirname(target), {recursive: true});
    const source = join(packageRoot, 'examples/node_modules', name);
    if (!existsSync(target)) symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(realpathSync(target), realpathSync(source));
    const expected = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version;
    assert.equal(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).version, expected);
    dependencies[name] = expected; versions[name] = expected;
  }
  // Relative package alias makes the linked-source manifest portable. A new checkout
  // recreates this read-only link; this proof does not claim a packed npm installation.
  const packageAlias = join(projectRoot, '.harness/packages/playwright-pom-harness'); mkdirSync(dirname(packageAlias), {recursive: true});
  if (!existsSync(packageAlias)) symlinkSync(packageRoot, packageAlias, process.platform === 'win32' ? 'junction' : 'dir');
  const installedHarness = join(projectRoot, 'node_modules/playwright-pom-harness');
  if (!existsSync(installedHarness)) symlinkSync(packageAlias, installedHarness, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(realpathSync(packageAlias), realpathSync(packageRoot)); assert.equal(realpathSync(installedHarness), realpathSync(packageRoot));
  dependencies['playwright-pom-harness'] = 'file:./.harness/packages/playwright-pom-harness';
  versions['playwright-pom-harness'] = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version;
  put('package.json', {name: 'synthetic-m13-consumer', private: true, type: 'module', devDependencies: dependencies});
  put('dependency-versions.json', {version: 1, proof: 'linked-source', node: process.version, packages: versions,
    localPackage: {name: 'playwright-pom-harness', path: '.harness/packages/playwright-pom-harness', preparation: 'Link this relative location to the matching reviewed harness checkout before installing dependencies.'}});
  put('tsconfig.json', {compilerOptions: {target: 'ES2021', module: 'NodeNext', moduleResolution: 'NodeNext', allowJs: true, checkJs: false, maxNodeModuleJsDepth: 1, strict: true, esModuleInterop: true, resolveJsonModule: true, skipLibCheck: true, noEmit: true, types: ['node']}, exclude: ['node_modules', '.harness']});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
  databases = await hostDatabases(); Object.assign(process.env, databases.environment, {HARNESS_PROOF_ORIGIN: origin});
  put('.harness/project.json', {version: 1, defaultEnvironment: 'qa', environments: {qa: {environmentMode: 'test', apiTargets: ['api'], databaseTargets: ['sqlserver', 'postgresql'], browserTargets: ['app']}}});
  put('.harness/targets.json', {api: {api: {baseUrl: origin}}, databases: databases.targets, browser: {app: {origins: [origin]}}});
  const environment = loadEnvironment(roots), executions = [], bindings = [];
  put('source.json', fixture.source); put('resources/testData/ObservationTestJsonFile.json', fixture.testData);
  for (const item of fixture.cases) {
    if (repairRoot) break; // Preserve original observations/evidence and append a repair to their existing generation history.
    const browser = item.id === 'ui', operation = browser ? defineOperation({id: 'observe', family: 'browser', target: 'app', capability: 'browserReads', source: {kind: 'inline', reference: 'synthetic-heading', version: '1.0.0'}, definition: {intent: item.description}})
      : item.definition.family === 'api' ? defineApiOperation(item.definition.operation) : defineDatabaseOperation(item.definition.operation);
    const runId = `observed-${item.id}`, checks = browser ? [{id: 'expected'}] : operation.definition.checks;
    const run = createRun({id: runId, startedAt: Date.now(), environment, operations: [operation, ...(browser ? browserLifecycleOperations('app') : [])],
      scenarios: [{id: item.id, expectations: checks.map(c => ({id: c.id, description: item.description, operationId: operation.id, invocationId: 'observe-call', requiredEvidence: browser ? ['observation', 'snapshot'] : ['response', 'assertion']}))}],
      values: (item.definition?.values ?? []).map(value => ({...value, producer: {runId, scenarioId: item.id, name: value.name}})), limits: {timeoutMs: 120000, cleanupTimeoutMs: 60000}});
    const runRoots = {...roots, runRoot: join(projectRoot, '.harness/runs', run.id)}; let result;
    if (browser) result = await runBrowserScenario(run, runRoots, {target: 'app'}, async session => {
      await session.attempt({operation, invocationId: 'observe-call'}, async context => {
        await context.native(['goto', origin]); await context.native(['snapshot', '--filename=observation.yml']);
        const evidence = await context.artifact('snapshot', 'observation.yml', bytes => bytes);
        const value = JSON.parse((await context.native(['eval', 'document.querySelector("#observation").textContent'])).result);
        const observation = await context.evidence('observation', {value, expected: item.expected});
        context.assertion({id: 'expected', status: value === item.expected ? 'PASS' : 'FAIL', reliable: true, evidenceIds: [evidence, observation]});
      });
    });
    else {
      const runtime = item.definition.family === 'api' ? createApiRuntime(run, runRoots) : createDatabaseRuntime(run, runRoots);
      await runtime.execute({operation, invocationId: 'observe-call', inputs: run.inputs.values}); result = runtime.finish();
    }
    assert.equal(result.status, 'PASS', `Exploration failed for ${item.id}`);
    if (reporting) assert.equal(writeReports(roots, result, {directory: `reports/exploration/${runId}`}).status, 'WRITTEN');
    writeFileSync(join(runRoots.runRoot, 'inputs.json'), JSON.stringify(run));
    executions.push({run, roots: runRoots, observations: JSON.parse(readFileSync(join(runRoots.runRoot, 'observations.json'), 'utf8'))});
    bindings.push({key: item.key, runId: run.id, scenarioId: item.id, expectationId: 'expected'});
  }
  if (!repairRoot) {const handoff = createGenerationHandoff(fixture.source, executions, bindings); await beginGeneration(roots, handoff, 'm13-author');}
  const candidate = await registerCandidate(roots, fixture.source.id, {config: 'playwright.config.ts', tests: fixture.cases.map(c => {
    const owner = c.id === 'ui' ? 'ObservationPage' : c.definition.family === 'api' ? 'ApisObservations' : 'DbsObservations';
    return {scenarioId: c.id, spec: 'tests/ObservationTests.spec.ts', project: 'proof', titlePath: ['Observations', c.title],
      mapping: [{step: 1, actions: [`${owner}.${c.id === 'ui' ? 'navigate' : 'observe'}`], expectations: [{key: c.key, validations: [`${owner}.verifyObservation`]}]}]};
  }), ...(repairRoot ? {repair: 'review-findings'} : {})});
  check('conventions', [join(packageRoot, 'scripts/check-conventions.mjs'), '--root', projectRoot, '--fail-on-warn']);
  check('typecheck', [join(packageRoot, 'examples/node_modules/typescript/bin/tsc'), '--project', join(projectRoot, 'tsconfig.json'), '--noEmit']);
  const descriptor = {status: 'AWAITING_INDEPENDENT_REVIEW', projectRoot, revision: candidate.revision, fingerprint: candidate.snapshot.fingerprint, round: candidate.round, sourceId: fixture.source.id, cases: fixture.cases.length, audit,
    reviewInput: join(projectRoot, `.harness/state/${candidate.revision}-review.json`)};
  writeFileSync(join(audit, 'candidate.json'), JSON.stringify(descriptor, null, 2)); console.log(JSON.stringify(descriptor));
  const deadline = Date.now() + 3600000;
  while (!existsSync(descriptor.reviewInput)) {if (Date.now() >= deadline) throw new Error('Independent review was not supplied within the proof deadline.'); await pause(1000);}
  await recordGenerationReview(roots, fixture.source.id, JSON.parse(readFileSync(descriptor.reviewInput, 'utf8')));
  const first = await verifyGeneration(roots, fixture.source.id, {allure: reporting}), second = first.status === 'PASS' ? await verifyGeneration(roots, fixture.source.id, {allure: reporting}) : undefined;
  const status = await generationStatus(roots, fixture.source.id); success = status.status === 'READY';
  writeFileSync(join(audit, 'verification.json'), JSON.stringify({first, second, status, databases: databases.versions}, null, 2));
  if (reporting) {
    const reports = [], coverage = [];
    for (const verification of [first, second].filter(Boolean)) {
      assert.equal(verification.reporting?.status, 'CAPTURED');
      const directory = join(projectRoot, verification.reporting.directory, 'allure-results');
      const tests = readdirSync(directory).filter(name => name.endsWith('-result.json')).map(name => JSON.parse(readFileSync(join(directory, name), 'utf8')));
      assert.equal(tests.length, fixture.cases.length);
      let actions = 0, validations = 0, attachments = 0;
      const descendants = step => [step, ...(step.steps ?? []).flatMap(descendants)];
      for (const item of fixture.cases.filter(item => item.definition)) {
        const matching = tests.filter(test => test.name === item.title); assert.equal(matching.length, 1);
        const steps = (matching[0].steps ?? []).flatMap(descendants), family = item.definition.family === 'api' ? 'API' : 'database';
        const action = steps.filter(step => step.name === `Read ${family} observation: ${item.description}`);
        const validation = steps.filter(step => step.name === `Verify ${family} observation has assessed status ${item.expected}`);
        assert.equal(action.length, 1); assert.equal(validation.length, 1); assert.equal(action[0].status, 'passed'); assert.equal(validation[0].status, 'passed');
        const files = descendants(action[0]).flatMap(step => step.attachments ?? []);
        for (const name of ['Harness execution result', 'Harness execution report']) {
          const attached = files.filter(file => file.name === name); assert.equal(attached.length, 1);
          assert.ok(existsSync(join(directory, attached[0].source))); attachments++;
          if (name === 'Harness execution result') assert.equal(JSON.parse(readFileSync(join(directory, attached[0].source), 'utf8')).status, 'PASS');
        }
        actions++; validations++;
      }
      coverage.push({verificationId: verification.id, nativeTests: tests.length, actions, validations, harnessAttachments: attachments});
      const generated = await generateAllure(roots, verification.reporting.directory); reports.push(generated); assert.equal(generated.status, 'GENERATED');
    }
    writeFileSync(join(audit, 'reporting.json'), JSON.stringify(reports, null, 2));
    writeFileSync(join(audit, 'business-step-coverage.json'), JSON.stringify(coverage, null, 2));
  }
  console.log(JSON.stringify({probe: 'generation', ...status, liveBrowser: true, liveApi: true, liveSqlServer: true, livePostgresql: true, nativeRunner: '1.63.0', cases: fixture.cases.length}));
} catch (error) {
  success = false;
  // Inputs are synthetic; still keep native diagnostics private and emit only classification.
  writeFileSync(join(audit, 'failure.txt'), String(error.stack), {mode: 0o600}); console.error(JSON.stringify({probe: 'generation', status: 'FAIL', audit}));
} finally {
  await new Promise(resolve => server.close(resolve));
  try {await databases?.close(); console.log(JSON.stringify({probe: 'generation-owned-cleanup', status: 'PASS'}));} catch {success = false; console.error(JSON.stringify({probe: 'generation-owned-cleanup', status: 'FAIL'}));}
  if (databases) for (const name of Object.keys(databases.environment)) delete process.env[name]; delete process.env.HARNESS_PROOF_ORIGIN;
}
process.exitCode = success ? 0 : 1;
