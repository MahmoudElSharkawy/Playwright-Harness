import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync, mkdtempSync, cpSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';
import {tmpdir} from 'node:os';
import {observedApiFixture, observedApiSentinels} from '../../harness-tests/fixtures/observed-api-app.mjs';
import {linkExampleDependencies} from '../../harness-tests/fixtures/example-dependencies.mjs';
import {packageRoot, consumerRoots} from '../lib/consumer-paths.mjs';
import {realFuture, within} from '../lib/skill-roots.mjs';

const library = name => import(pathToFileURL(join(packageRoot, 'scripts/lib', name)).href);
const {createRun, defineOperation} = await library('execution-core/index.mjs');
const {digest, fingerprint} = await library('execution-core/data.mjs');
const {runBrowserScenario, browserLifecycleOperations} = await library('browser/index.mjs');
const {prepareNativeSession} = await library('browser/native-cli.mjs');
const {defineApiOperation} = await library('api/index.mjs');
const {listApiCandidates, reviewApiCandidate, readReviewedApi, promoteObservedCollection} = await library('api/discovery.mjs');
const {runSequentialScenario} = await library('sequential/index.mjs');
const {createGenerationHandoff, sourceExpectations, beginGeneration, registerCandidate, recordGenerationReview, generationStatus} = await library('generation/index.mjs');
const {verifyGeneration} = await library('generation/verify.mjs');
const {protect} = await library('generation/storage.mjs');

if (process.argv[2] === 'reuse') {
  const roots = {packageRoot, projectRoot: process.argv[3]};
  const reviewedIds = process.argv.slice(4);
  for (const id of reviewedIds) assert.equal(readReviewedApi(roots, id).status, 'reviewed-verified');
  const collection = JSON.parse(readFileSync(join(roots.projectRoot, 'resources/apisCollections/orders-observed.postman_collection.json'), 'utf8'));
  assert.equal(collection.item.length, reviewedIds.length);
  console.log(JSON.stringify({status: 'REUSED', operations: reviewedIds.length}));
  process.exit(0);
}

const destination = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), 'harness-observed-api-'));
assert(!within(realFuture(packageRoot), realFuture(destination)), 'Use an external proof directory.');
if (process.argv[2]) mkdirSync(destination, {recursive: false});
const projectRoot = realpathSync.native(destination);
consumerRoots(projectRoot, packageRoot); protect(projectRoot);
cpSync(join(packageRoot, 'harness-tests/fixtures/observed-api-consumer'), projectRoot, {recursive: true});
linkExampleDependencies(projectRoot, packageRoot);
writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({name: 'observed-api-proof', private: true, type: 'module'}));
writeFileSync(join(projectRoot, 'tsconfig.json'), JSON.stringify({compilerOptions: {target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, esModuleInterop: true, resolveJsonModule: true, skipLibCheck: true, types: ['node']}, include: ['src/**/*.ts', 'tests/**/*.ts', 'playwright.config.ts']}));
const roots = {packageRoot, projectRoot};
const audit = join(projectRoot, '.harness/state/observed-api-proof-' + randomUUID());
mkdirSync(audit, {recursive: true, mode: 0o700}); protect(audit);
const nativeSession = async (locations, options) => {
  const native = await prepareNativeSession(locations, options), open = native.open;
  native.open = async options => {
    try {return await open(options);} catch (error) {
      writeFileSync(join(audit, 'native-open-private.txt'), String(error.detail || error.cause?.stack || error.stack), {mode: 0o600}); throw error;
    }
  };
  return native;
};
const put = (file, value) => {
  const path = join(projectRoot, file); mkdirSync(join(path, '..'), {recursive: true, mode: 0o700});
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', {mode: 0o600}); return path;
};
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const runRoots = run => ({...roots, runRoot: join(projectRoot, '.harness/runs', run.id)});
const saveRun = (run, location) => {writeFileSync(join(location.runRoot, 'inputs.json'), JSON.stringify(run)); return {run, roots: location, observations: read(join(location.runRoot, 'observations.json'))};};
const assertNoSentinels = text => {for (const sentinel of Object.values(observedApiSentinels)) assert(!text.includes(sentinel), 'Captured personal/session value escaped sanitized knowledge.');};
let app, success = false;
try {
  app = await observedApiFixture(); process.env.HARNESS_PROOF_ORIGIN = app.origin; process.env.API_CONSOLE_LOGS = 'false';
  const environment = {name: 'qa', environmentMode: 'test', capabilities: {}, apiTargets: ['orders'], databaseTargets: [], browserTargets: ['app'], targets: {api: {orders: {baseUrl: app.origin}}, databases: {}, browser: {app: {origins: [app.origin]}}}};
  put('.harness/project.json', {version: 1, defaultEnvironment: 'qa', environments: {qa: {environmentMode: 'test', apiTargets: ['orders'], databaseTargets: [], browserTargets: ['app']}}});
  put('.harness/targets.json', environment.targets);
  const source = {version: 1, id: 'observed-order-119', title: 'Submit a draft order', scenarios: [{id: '119', title: 'Test Case 119: Submit a draft order', steps: [
    {action: 'Arrange a unique owned draft order through the supported API.', expected: ['The created order is a draft.']},
    {action: 'Open the created order through its GUI page.', expected: ['The page shows the created order.']},
    {action: 'Submit the draft order through the GUI.', expected: ['The page shows Submitted.']},
    {action: 'Clean up the owned order through the supported API.', expected: ['The owned order is absent.']}
  ]}]};
  const sourcePath = put('source.json', source), sourceBytes = readFileSync(sourcePath);
  assert(!existsSync(join(projectRoot, 'resources/apisCollections')), 'Discovery proof must start without collections.');
  const discover = defineOperation({id: 'discover-order-flow', family: 'browser', target: 'app', capability: 'browserMutations', source: {kind: 'inline', reference: 'owned-order-discovery', version: '1.0.0'}, definition: {intent: 'Permitted disposable GUI discovery with owned cleanup'}});
  const discoveryRun = createRun({id: 'discovery-' + randomUUID(), environment, operations: [discover, ...browserLifecycleOperations('app')], limits: {timeoutMs: 180000, cleanupTimeoutMs: 60000}, scenarios: [{id: 'discovery', expectations: [{id: 'deleted', description: 'Disposable discovery order is deleted', operationId: discover.id, invocationId: 'discover', requiredEvidence: ['observation']}]}]});
  const discoveryRoots = runRoots(discoveryRun);
  const discovered = await runBrowserScenario(discoveryRun, discoveryRoots, {target: 'app', nativeSession}, async browser => {
    await browser.attempt({operation: discover, invocationId: 'discover'}, async context => {
      await context.native(['goto', app.origin]);
      await context.native(['run-code', `async page => {
        await page.locator('#create').click(); await page.waitForFunction(() => document.querySelector('#status').textContent === 'Draft');
        await page.locator('#read').click(); await page.waitForFunction(() => document.querySelector('#status').textContent === 'Draft');
        await page.locator('#submit').click(); await page.waitForFunction(() => document.querySelector('#status').textContent === 'Submitted');
        await page.locator('#delete').click(); await page.waitForFunction(() => document.querySelector('#status').textContent === 'Deleted');
      }`]);
      const actual = JSON.parse((await context.native(['eval', 'document.querySelector("#status").textContent'])).result);
      const evidenceId = await context.evidence('observation', {actual, expected: 'Deleted'});
      context.effect({certainty: 'confirmed', resourceIds: []});
      context.assertion({id: 'deleted', status: actual === 'Deleted' ? 'PASS' : 'FAIL', reliable: true, evidenceIds: [evidenceId]});
    });
  });
  saveRun(discoveryRun, discoveryRoots);
  assert.equal(discovered.status, 'PASS', 'Live native discovery did not pass.'); assert.equal(app.count(), 0);
  const candidates = listApiCandidates(roots, {runId: discoveryRun.id});
  assert(candidates.length >= 4, 'Native discovery missed requests.');
  assertNoSentinels(JSON.stringify(candidates));
  const choose = (method, segments) => candidates.find(candidate => candidate.observation.method === method && candidate.observation.observedPath.split('/').filter(Boolean).length === segments);
  const selected = [choose('POST', 2), choose('GET', 3), choose('DELETE', 3)];
  assert(selected.every(Boolean), 'Discovery must include create, read and delete.');
  assert(!existsSync(join(discoveryRoots.runRoot, 'protected')), 'Native raw storage was not cleaned up.');

  const operationSource = {kind: 'inline', reference: 'reviewed-order-fixture', version: '1.0.0'};
  const check = (id, equals, path = []) => ({id, select: {from: path.length ? 'json' : 'status', path}, equals});
  const create = defineApiOperation({id: 'create-draft', target: 'orders', source: operationSource, request: {method: 'POST', path: '/api/orders', json: {id: {$input: 'id'}, owner: {$input: 'owner'}, label: {$input: 'label'}}}, effects: {confirmedStatuses: [201], noEffectStatuses: [400, 409], contractRef: 'fixture-create-contract'}, checks: [check('created-http', 201), check('created-draft', 'Draft', ['status'])], extract: [{name: 'orderId', type: 'string', sensitivity: 'public', select: {from: 'json', path: ['id']}}]});
  const lookup = defineApiOperation({id: 'read-order', target: 'orders', source: operationSource, request: {method: 'GET', path: '/api/orders/{id}'}, effects: {readOnlyContract: 'fixture-read-contract'}, checks: [check('read-http', 200), check('read-owner', {$input: 'owner'}, ['owner'])]});
  const cleanup = defineApiOperation({id: 'delete-order', target: 'orders', source: operationSource, request: {method: 'DELETE', path: '/api/orders/{id}', headers: {'if-match': {$input: 'owner'}}}, effects: {confirmedStatuses: [204], noEffectStatuses: [404, 412], contractRef: 'fixture-delete-contract'}, checks: [check('deleted-http', 204)]});
  const absence = defineApiOperation({id: 'verify-absence', target: 'orders', source: operationSource, request: {method: 'GET', path: '/api/orders/{id}'}, effects: {readOnlyContract: 'fixture-read-contract'}, checks: [check('order-absent', 404)]});
  const submit = defineOperation({id: 'submit-order-gui', family: 'browser', target: 'app', capability: 'browserMutations', source: operationSource, definition: {intent: 'Open and submit the owned draft through its GUI'}});
  const mixedId = 'mixed-' + randomUUID(), ownedId = 'tc119-proof-' + randomUUID(), owner = 'tc119-proof-owner-' + randomUUID();
  const typed = (name, value) => ({name, type: 'string', sensitivity: 'public', value, producer: {runId: mixedId, scenarioId: '119', name}});
  const apiScope = (operation, invocationId, phase) => operation.definition.checks.map(check => ({id: check.id, description: 'Synthetic source-grounded order contract', operationId: operation.id, invocationId, phase, requiredEvidence: ['response', 'assertion']}));
  const mixedRun = createRun({id: mixedId, environment, operations: [create, lookup, cleanup, absence, submit, ...browserLifecycleOperations('app')], values: [typed('id', ownedId), typed('owner', owner), typed('label', 'Synthetic proof order')], limits: {timeoutMs: 180000, cleanupTimeoutMs: 60000}, scenarios: [{id: '119', expectations: [
    ...apiScope(create, 'create', 'SETUP'), ...apiScope(lookup, 'lookup', 'SETUP'),
    ...['visible-order', 'submitted'].map(id => ({id, description: id === 'submitted' ? 'The page shows Submitted' : 'The page shows the created order', operationId: submit.id, invocationId: 'submit', phase: 'EXERCISE', requiredEvidence: ['observation']})),
    ...apiScope(cleanup, 'cleanup', 'CLEANUP'), ...apiScope(absence, 'absence', 'CLEANUP')
  ]}]});
  const mixedRoots = runRoots(mixedRun); let createdAttempt, readAttempt, cleanupAttempt, orderBinding;
  const mixed = await runSequentialScenario(mixedRun, mixedRoots, {browser: {target: 'app', nativeSession}}, {
    setup: async context => {
      createdAttempt = await context.api.execute({operation: create, invocationId: 'create', inputs: mixedRun.inputs.values, resource: {id: 'owned-order', output: 'orderId', ownership: 'harness', intent: 'temporary'}});
      orderBinding = context.output(createdAttempt, 'orderId', 'id');
      readAttempt = await context.api.execute({operation: lookup, invocationId: 'lookup', inputs: [orderBinding, context.value('owner')]});
    },
    exercise: async context => {
      await context.browser.attempt({operation: submit, invocationId: 'submit', inputs: [orderBinding]}, async browser => {
        await browser.native(['goto', app.origin + '/orders/' + encodeURIComponent(orderBinding.value)]);
        await browser.native(['run-code', `async page => {await page.waitForFunction(() => document.querySelector('#status').textContent === 'Draft');}`]);
        const shownId = JSON.parse((await browser.native(['eval', 'document.querySelector("#order-id").textContent'])).result);
        const identityEvidence = await browser.evidence('observation', {shownId, expected: orderBinding.value});
        browser.assertion({id: 'visible-order', status: shownId === orderBinding.value ? 'PASS' : 'FAIL', reliable: true, evidenceIds: [identityEvidence]});
        await browser.native(['run-code', `async page => {await page.locator('#submit').click(); await page.waitForFunction(() => document.querySelector('#status').textContent === 'Submitted');}`]);
        const status = JSON.parse((await browser.native(['eval', 'document.querySelector("#status").textContent'])).result);
        const evidenceId = await browser.evidence('observation', {actual: status, expected: 'Submitted'});
        browser.effect({certainty: 'confirmed', resourceIds: ['owned-order']});
        browser.assertion({id: 'submitted', status: status === 'Submitted' ? 'PASS' : 'FAIL', reliable: true, evidenceIds: [evidenceId]});
      });
    },
    cleanup: async context => {
      if (!orderBinding) return;
      cleanupAttempt = await context.api.execute({operation: cleanup, invocationId: 'cleanup', inputs: [orderBinding, context.value('owner')], lifecycle: {resourceId: 'owned-order'}});
      await context.api.execute({operation: absence, invocationId: 'absence', inputs: [orderBinding]});
    }
  });
  const validation = saveRun(mixedRun, mixedRoots);
  assert.equal(mixed.status, 'PASS', 'Mixed API/GUI source scenario did not pass.'); assert.equal(app.count(), 0);
  const apiArtifact = '.harness/state/observed-api-contract-review.md';
  put(apiArtifact, '# API fixture contract review\n\nThe owned loopback fixture source establishes POST /api/orders accepting explicit id, owner and label; GET /api/orders/{id} reads the record without mutation; DELETE /api/orders/{id} requires the exact owner in If-Match. There is no authentication or session prerequisite. The create response produces the actual id. Owned deletion and absence were verified in the same configured runtime. No verb or response status alone establishes this contract. This is an author review of the fixture contract; independent generation review follows separately.\n');
  const operations = [create, lookup, cleanup], attempts = [createdAttempt, readAttempt, cleanupAttempt];
  const reviewed = operations.map((operation, index) => reviewApiCandidate(roots, {candidateId: selected[index].id, operation, review: {reviewer: 'fixture-contract-author', artifact: apiArtifact,
    purpose: ['Create draft order', 'Read owned order', 'Delete owned order'][index], inputs: 'Explicit synthetic id, owner and label are caller supplied. Returned identity is bound into later operations.', authentication: {kind: 'none'}, responseExtraction: index === 0 ? 'Read id from the validated creation response.' : 'Only the configured checks are consumed; no captured response becomes an oracle.', stateEffects: index === 1 ? 'Fixture source confirms lookup is read-only.' : 'Fixture source establishes the bounded owned mutation and conditional deletion contract.', cleanup: index === 1 ? {kind: 'none'} : {kind: 'verified', operationId: cleanup.id}}, validation: {...validation, attemptId: attempts[index].identity.attemptId}}));
  const serviceFile = join(projectRoot, 'src/apis/ApisOrders.ts');
  const existingService = readFileSync(serviceFile, 'utf8');
  const derived = reviewed.map(record => readReviewedApi(roots, record.id).operation.definition.request.path);
  assert.deepEqual(derived, ['/api/orders', '/api/orders/{id}', '/api/orders/{id}']);
  const serviceFields = [['createDraftOrder', derived[0]], ['lookupOrder', derived[1].replace('{id}', '')], ['deleteOrder', derived[2].replace('{id}', '')]];
  let derivedService = existingService;
  for (const [name, path] of serviceFields) derivedService = derivedService.replace(new RegExp(`readonly ${name}_serviceName = '[^']*';`), `readonly ${name}_serviceName = ${JSON.stringify(path)};`);
  writeFileSync(serviceFile, derivedService);
  assert(!existsSync(join(projectRoot, 'resources/apisCollections')), 'Service derivation must precede serialization.');
  const supplied = '{"info":{"name":"Team supplied incomplete collection"},"item":[]}\n';
  const suppliedPath = put('resources/apisCollections/team.postman_collection.json', supplied);
  const promotion = await promoteObservedCollection(roots, {application: 'orders', reviewedIds: reviewed.map(record => record.id)});
  const collectionBytes = readFileSync(promotion.path);
  const repeated = await promoteObservedCollection(roots, {application: 'orders', reviewedIds: reviewed.map(record => record.id)});
  assert.equal(promotion.requests, 3); assert.equal(repeated.requests, 3); assert.deepEqual(readFileSync(promotion.path), collectionBytes);
  assert.equal(readFileSync(suppliedPath, 'utf8'), supplied); assertNoSentinels(collectionBytes.toString('utf8'));
  const expectations = sourceExpectations(source), assertionIds = ['created-draft', 'visible-order', 'submitted', 'order-absent'];
  const handoff = createGenerationHandoff(source, [validation], expectations.map((expectation, index) => ({key: expectation.key, runId: mixedRun.id, scenarioId: '119', expectationId: assertionIds[index]})));
  await beginGeneration(roots, handoff, 'observed-api-author');
  const mappings = [
    {actions: ['ApisOrders.createDraftOrder'], validations: ['ApisOrders.verifyDraftCreated']},
    {actions: ['OrderPage.navigate'], validations: ['OrderPage.verifyOrderIdentity']},
    {actions: ['OrderPage.submitOrder'], validations: ['OrderPage.verifyOrderStatus']},
    {actions: ['ApisOrders.cleanupOrderIfOwned'], validations: ['ApisOrders.cleanupOrderIfOwned']}
  ];
  const candidate = await registerCandidate(roots, source.id, {config: 'playwright.config.ts', tests: [{scenarioId: '119', spec: 'tests/OrderTests.spec.ts', project: 'chromium', titlePath: ['Orders', 'Test Case 119: Submit a draft order'], mapping: expectations.map((expectation, index) => ({step: index + 1, actions: mappings[index].actions, expectations: [{key: expectation.key, validations: mappings[index].validations}]}))}]});
  for (const [name, args] of [['conventions', [join(packageRoot, 'scripts/check-conventions.mjs'), '--root', projectRoot, '--fail-on-warn']], ['types', [join(packageRoot, 'examples/node_modules/typescript/bin/tsc'), '--project', join(projectRoot, 'tsconfig.json'), '--noEmit']]]) {
    const result = spawnSync(process.execPath, args, {cwd: projectRoot, windowsHide: true, encoding: 'utf8'});
    writeFileSync(join(audit, name + '.log'), result.stdout + result.stderr); assert.equal(result.status, 0, name + ' check failed.');
  }
  const descriptor = {status: 'AWAITING_INDEPENDENT_REVIEW', projectRoot, revision: candidate.revision, fingerprint: candidate.snapshot.fingerprint, sourceId: source.id, audit,
    reviewInput: join(projectRoot, `.harness/state/${candidate.revision}-review.json`), nativeDiscovery: {runId: discoveryRun.id, candidates: candidates.length}, mixedRunId: mixedRun.id, reviewedIds: reviewed.map(record => record.id), collection: promotion.path};
  writeFileSync(join(audit, 'candidate.json'), JSON.stringify(descriptor, null, 2));
  console.log(JSON.stringify(descriptor));
  const deadline = Date.now() + 3600000;
  while (!existsSync(descriptor.reviewInput)) {assert(Date.now() < deadline, 'Independent review timeout.'); await pause(1000);}
  await recordGenerationReview(roots, source.id, read(descriptor.reviewInput));
  const first = await verifyGeneration(roots, source.id), second = first.status === 'PASS' ? await verifyGeneration(roots, source.id) : undefined;
  const status = await generationStatus(roots, source.id);
  writeFileSync(join(audit, 'verification.json'), JSON.stringify({first, second, status}, null, 2));
  assert.equal(status.status, 'READY'); assert.equal(status.greens, 2); assert.notEqual(first.id, second.id);
  assert.deepEqual(readFileSync(sourcePath), sourceBytes); assert.equal(readFileSync(suppliedPath, 'utf8'), supplied); assert.equal(app.count(), 0);
  const later = spawnSync(process.execPath, [import.meta.filename, 'reuse', projectRoot, ...reviewed.map(record => record.id)], {windowsHide: true, encoding: 'utf8'});
  assert.equal(later.status, 0, 'Fresh invocation could not reuse reviewed knowledge.');
  const summary = {status: 'PASS', platform: process.platform, node: process.version, nativeDiscovery: {candidates: candidates.length, protectedStorageRemoved: true}, mixed: mixed.status, generation: status,
    collection: {path: promotion.path, requests: promotion.requests, repeatedPromotionStable: true, suppliedUnchanged: true}, sourceUnchanged: true, remainingOrders: app.count(), laterInvocation: JSON.parse(later.stdout), audit};
  writeFileSync(join(audit, 'summary.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary)); success = true;
} catch (error) {
  writeFileSync(join(audit, 'failure.txt'), String(error.stack), {mode: 0o600});
  console.error(JSON.stringify({status: 'FAIL', reason: error.message, audit, remainingOrders: app?.count()}));
} finally {await app?.close(); delete process.env.HARNESS_PROOF_ORIGIN; delete process.env.API_CONSOLE_LOGS;}
process.exitCode = success ? 0 : 1;
