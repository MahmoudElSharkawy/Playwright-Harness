import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync, mkdtempSync, cpSync, unlinkSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';
import {tmpdir} from 'node:os';
import {discoveredDbFixture} from '../../harness-tests/fixtures/discovered-db-app.mjs';
import {linkExampleDependencies} from '../../harness-tests/fixtures/example-dependencies.mjs';
import {packageRoot, consumerRoots} from '../lib/consumer-paths.mjs';
import {realFuture, within} from '../lib/skill-roots.mjs';
import {createRun, defineOperation} from '../lib/execution-core/index.mjs';
import {createDatabaseRuntime, defineDatabaseOperation} from '../lib/database/index.mjs';
import {deriveDbCandidate, reviewDbCandidate, readReviewedDb, promoteDiscoveredQueries, readDbDiscoverySummary} from '../lib/database/discovery.mjs';
import {browserLifecycleOperations} from '../lib/browser/index.mjs';
import {prepareNativeSession} from '../lib/browser/native-cli.mjs';
import {runSequentialScenario} from '../lib/sequential/index.mjs';
import {createGenerationHandoff, sourceExpectations, beginGeneration, registerCandidate, recordGenerationReview, generationStatus} from '../lib/generation/index.mjs';
import {verifyGeneration} from '../lib/generation/verify.mjs';
import {protect} from '../lib/generation/storage.mjs';
import {allureInventory} from '../lib/reporting/allure.mjs';

const target = JSON.parse(process.env.HARNESS_M8_TARGET ?? 'null');
assert(target, 'Run through the disposable SQL Server probe with --discovery.');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const write = (root, file, value) => {
  const path = join(root, file); mkdirSync(join(path, '..'), {recursive: true, mode: 0o700});
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', {mode: 0o600}); return path;
};
const runRoots = (roots, run) => ({...roots, runRoot: join(roots.projectRoot, '.harness/runs', run.id)});
const saveRun = (run, roots) => {
  write(roots.runRoot, 'inputs.json', run); return {run, roots, observations: read(join(roots.runRoot, 'observations.json'))};
};
const source = {kind: 'helper', reference: 'disposable-order-fixture-contract', version: '1'};
const parameter = name => ({name, type: 'nvarchar', length: 100, input: name});
const check = (id, from, equals, path = []) => ({id, select: {from, path}, equals});
const seed = defineDatabaseOperation({id: 'create-draft', target: 'db', source,
  sql: 'INSERT INTO m8.DiscoveredOrders (Id,Owner,Status) OUTPUT INSERTED.Id,INSERTED.Status VALUES (@recordId,@owner,@draftStatus)',
  parameters: [parameter('recordId'), parameter('owner'), {name: 'draftStatus', type: 'nvarchar', length: 30, input: 'draftStatus'}],
  checks: [check('created-draft', 'rows', {$input: 'draftStatus'}, [0, 'Status'])], affectedRows: {min: 1, max: 1},
  extract: [{name: 'recordId', type: 'string', sensitivity: 'public', select: {from: 'rows', path: [0, 'Id']}}]});
const cleanup = defineDatabaseOperation({id: 'delete-owned', target: 'db', source,
  sql: 'DELETE FROM m8.DiscoveredOrders WHERE Id=@recordId AND Owner=@owner', parameters: [parameter('recordId'), parameter('owner')],
  checks: [check('deleted', 'affectedRows', 1)], affectedRows: {min: 1, max: 1}});
const absence = defineDatabaseOperation({id: 'verify-absence', target: 'db', source,
  sql: 'SELECT Id FROM m8.DiscoveredOrders WHERE Id=@recordId', parameters: [parameter('recordId')], checks: [check('absent', 'rowCount', 0)]});
const dbScope = (operation, phase) => operation.definition.checks.map(item => ({id: item.id, description: item.id === 'created-draft' ? 'The created order is a draft.' : item.id === 'absent' ? 'The owned order is absent.' : 'The owned order is deleted.', operationId: operation.id, invocationId: operation.id, phase, requiredEvidence: ['response', 'assertion']}));
const lookupScope = ['found', 'owner-matches', 'status-matches'].map((id, index) => ({id,
  description: ['The exact selected order exists once.', 'The persisted owner matches this scenario.', 'The persisted status matches the selected source expectation.'][index],
  operationId: 'verify-order', invocationId: 'verify-order', phase: 'VERIFY', requiredEvidence: ['response', 'assertion']}));
const gui = defineOperation({id: 'submit-order-gui', family: 'browser', target: 'app', capability: 'browserMutations', source, definition: {intent: 'Open the created draft and submit it through the GUI.'}});
const guiScope = ['visible-order', 'submitted'].map((id, index) => ({id, description: ['The page shows the created order.', 'The page shows Submitted.'][index], operationId: gui.id, invocationId: 'submit', phase: 'EXERCISE', requiredEvidence: ['observation']}));
function values(runId, {submitted = true} = {}) {
  return [['recordId', `tc134-order-${randomUUID()}`], ['owner', `tc134-owner-${randomUUID()}`], ['draftStatus', 'Draft'], ['expectedStatus', submitted ? 'Submitted' : 'Draft'], ['expectedCount', 1]]
    .map(([name, value]) => ({name, type: typeof value, sensitivity: 'public', value, producer: {runId, scenarioId: '134', name}}));
}
function businessRun(environment, lookup, withUi) {
  const runId = `orders-${randomUUID()}`;
  return createRun({id: runId, environment, operations: [seed, lookup, cleanup, absence, ...(withUi ? [gui, ...browserLifecycleOperations('app')] : [])],
    values: values(runId, {submitted: withUi}), limits: {timeoutMs: 180000, cleanupTimeoutMs: 60000},
    scenarios: [{id: '134', expectations: [...dbScope(seed, 'SETUP'), ...(withUi ? guiScope : []), ...lookupScope, ...dbScope(cleanup, 'CLEANUP'), ...dbScope(absence, 'CLEANUP')]}]});
}

if (process.argv[2] === 'reuse') {
  const projectRoot = realpathSync.native(process.argv[3]), roots = {packageRoot, projectRoot}, descriptor = read(join(projectRoot, '.harness/state/db-reuse.json'));
  const run = businessRun(descriptor.environment, descriptor.operation, false), locations = runRoots(roots, run); let created, current, validated;
  const result = await runSequentialScenario(run, locations, {}, {
    setup: async context => {created = await context.database.execute({operation: seed, invocationId: seed.id, inputs: [context.value('recordId'), context.value('owner'), context.value('draftStatus')], resource: {id: 'owned-order', output: 'recordId', ownership: 'harness', intent: 'temporary'}});},
    verify: async context => {
      current = await context.database.inspectSchema({target: 'db', operationId: 'verify-order', invocationId: 'verify-order', tableHint: 'Order'});
      const record = readReviewedDb(roots, descriptor.reviewedId, {run, roots: locations, schema: current});
      validated = await context.database.execute({operation: record.operation, invocationId: record.operation.id,
        inputs: [context.output(created, 'recordId'), context.value('owner'), context.value('expectedStatus'), context.value('expectedCount')]});
    },
    cleanup: async context => {
      const resource = context.resource('owned-order'); if (!resource) return;
      const identity = resource.outputs.find(item => item.name === 'recordId');
      await context.database.execute({operation: cleanup, invocationId: cleanup.id, inputs: [identity, context.value('owner')], lifecycle: {resourceId: 'owned-order'}});
      await context.database.execute({operation: absence, invocationId: absence.id, inputs: [identity]});
    }
  });
  assert.equal(result.status, 'PASS'); assert(validated); assert.notEqual(run.inputs.values.find(item => item.name === 'recordId').value, descriptor.originalIdentity);
  saveRun(run, locations);
  const knowledge = readDbDiscoverySummary(roots, {runIds: [run.id]});
  assert.equal(knowledge.reused.length, 1); assert.equal(knowledge.libraries.length, 1); assert.deepEqual(knowledge.gaps, []);
  console.log(JSON.stringify({status: 'REUSED', runId: run.id, newIdentity: true, freshSchema: true, reportedReuse: true, lifecycleComplete: result.scenarios[0].requiredLifecycleComplete}));
  process.exit(0);
}

const projectRoot = realpathSync.native(mkdtempSync(join(tmpdir(), 'harness-discovered-db-'))), roots = {packageRoot, projectRoot};
assert(!within(realFuture(packageRoot), realFuture(projectRoot)), 'Use an external proof directory.'); consumerRoots(projectRoot, packageRoot); protect(projectRoot);
const put = (file, value) => write(projectRoot, file, value), audit = join(projectRoot, '.harness/state/discovered-db-proof'); mkdirSync(audit, {recursive: true, mode: 0o700}); protect(audit);
const nativeSession = async (locations, options) => {
  const native = await prepareNativeSession(locations, options), open = native.open;
  native.open = async options => {try {return await open(options);} catch (error) {write(audit, 'native-open-private.txt', String(error.detail || error.stack)); throw error;}}; return native;
};
let app, success = false;
try {
  app = await discoveredDbFixture(target, JSON.parse(process.env.M8_DB_CREDENTIAL));
  process.env.HARNESS_PROOF_ORIGIN = app.origin; process.env.DB_CONSOLE_LOGS = 'false';
  const environment = {name: 'qa', environmentMode: 'test', apiTargets: [], databaseTargets: ['db'], browserTargets: ['app'], capabilities: {}, targets: {api: {}, databases: {db: target}, browser: {app: {origins: [app.origin]}}}};
  put('.harness/project.json', {version: 1, defaultEnvironment: 'qa', environments: {qa: {environmentMode: 'test', apiTargets: [], databaseTargets: ['db'], browserTargets: ['app']}}}); put('.harness/targets.json', environment.targets);
  const selectedSource = {version: 1, id: 'discovered-order-134', title: 'Submit a draft order and verify persistence', scenarios: [{id: '134', title: 'Test Case 134: Submit a draft order and verify persistence', steps: [
    {action: 'Arrange a unique owned draft using the established DB fixture operation.', expected: ['The created order is a draft.']},
    {action: 'Open the created order page.', expected: ['The page shows the created order.']},
    {action: 'Submit the order through its GUI.', expected: ['The page shows Submitted.']},
    {action: 'Verify the exact order through a discovered DB lookup.', expected: ['The selected order exists once.', 'The persisted owner matches this scenario.', 'The persisted status is Submitted.']},
    {action: 'Delete the owned order through the established guarded DB fixture operation.', expected: ['The owned order is absent.']}
  ]}]};
  const sourcePath = put('source.json', selectedSource), sourceBytes = readFileSync(sourcePath);
  assert(!existsSync(join(projectRoot, 'resources/Queries'))); assert(!existsSync(join(projectRoot, 'src')) && !existsSync(join(projectRoot, 'tests')));
  const discoveryRun = createRun({environment, operations: [], scenarios: [{id: '134', expectations: lookupScope}], limits: {timeoutMs: 60000}}), discoveryRoots = runRoots(roots, discoveryRun);
  const database = createDatabaseRuntime(discoveryRun, discoveryRoots);
  const schema = await database.inspectSchema({target: 'db', operationId: 'verify-order', invocationId: 'verify-order', tableHint: 'Order', phase: 'VERIFY'});
  assert.deepEqual(schema.schema.tables.map(table => table.name), ['DiscoveredOrders']);
  const candidate = deriveDbCandidate(discoveryRun, discoveryRoots, {schema, operationId: 'verify-order', invocationId: 'verify-order', table: schema.schema.tables[0].name,
    purpose: 'Verify the selected order persistence', key: [{column: 'Id', input: 'recordId'}], columns: ['Id', 'Owner', 'Status'],
    checks: [{id: 'found', input: 'expectedCount'}, {id: 'owner-matches', column: 'Owner', input: 'owner'}, {id: 'status-matches', column: 'Status', input: 'expectedStatus'}], source: {artifact: 'source.json', scenarioId: '134'}});
  const run = businessRun(environment, candidate.operation, true), locations = runRoots(roots, run); let created, verified;
  const result = await runSequentialScenario(run, locations, {browser: {target: 'app', nativeSession}}, {
    setup: async context => {created = await context.database.execute({operation: seed, invocationId: seed.id, inputs: [context.value('recordId'), context.value('owner'), context.value('draftStatus')], resource: {id: 'owned-order', output: 'recordId', ownership: 'harness', intent: 'temporary'}});},
    exercise: async context => {
      const identity = context.output(created, 'recordId');
      await context.browser.attempt({operation: gui, invocationId: 'submit', inputs: [identity]}, async browser => {
        await browser.native(['goto', `${app.origin}/orders/${identity.value}`]);
        const actualId = JSON.parse((await browser.native(['eval', 'document.querySelector("#order-id").textContent'])).result);
        const identityEvidence = await browser.evidence('observation', {actual: actualId, expected: identity.value});
        browser.assertion({id: 'visible-order', status: actualId === identity.value ? 'PASS' : 'FAIL', reliable: true, evidenceIds: [identityEvidence]});
        await browser.native(['run-code', 'async page => {await page.locator("#submit").click(); await page.locator("#status").filter({hasText:"Submitted"}).waitFor();}']);
        const actual = JSON.parse((await browser.native(['eval', 'document.querySelector("#status").textContent'])).result);
        const statusEvidence = await browser.evidence('observation', {actual, expected: 'Submitted'});
        browser.assertion({id: 'submitted', status: actual === 'Submitted' ? 'PASS' : 'FAIL', reliable: true, evidenceIds: [statusEvidence]}); browser.effect({certainty: 'confirmed', resourceIds: ['owned-order']});
      });
    },
    verify: async context => {verified = await context.database.execute({operation: candidate.operation, invocationId: 'verify-order', inputs: [context.output(created, 'recordId'), context.value('owner'), context.value('expectedStatus'), context.value('expectedCount')]});},
    cleanup: async context => {
      const resource = context.resource('owned-order'); if (!resource) return;
      const identity = resource.outputs.find(item => item.name === 'recordId');
      await context.database.execute({operation: cleanup, invocationId: cleanup.id, inputs: [identity, context.value('owner')], lifecycle: {resourceId: 'owned-order'}});
      await context.database.execute({operation: absence, invocationId: absence.id, inputs: [identity]});
    }
  });
  const validation = saveRun(run, locations); assert.equal(result.status, 'PASS'); assert.equal(await app.count(), 0);
  assert(!existsSync(join(projectRoot, 'src')) && !existsSync(join(projectRoot, 'tests')), 'Standalone execution must not generate POM code.');
  const reviewPath = '.harness/state/db-contract-review.md';
  put(reviewPath, '# Fixture query contract review\n\nThe owned fixture source establishes the exact nonnullable primary key and textual ownership/status fields. The source scenario supplies the expected persisted status and row count. Metadata establishes the selected ordinary table and native parameter type; it does not establish the status meaning. Only this run\'s created identifier is bound. The SELECT is read-only. Tenant scope is the disposable database/schema, ownership is the explicit owner field, and the fixture has no soft-deletion mechanism. Existing guarded mutations seed and delete only owned records; the mixed runtime completed UI checks and cleanup. No current values, row samples or credentials belong in reusable knowledge. This is an author contract review; independent generation review follows.\n');
  const reviewed = reviewDbCandidate(roots, {candidateId: candidate.id, review: {reviewer: 'fixture-contract-author', artifact: reviewPath, purpose: 'Verify the selected order persistence', inputs: 'Bind the actual created identity and frozen source expected inputs.', extraction: 'Only explicitly selected identity, owner and status columns are consumed; no output extraction is required.', semantics: 'Source and fixture contract establish ownership, status meaning, tenant scope and absence of soft deletion; the query has no mutation effects.'}, validation: {...validation, attemptId: verified.identity.attemptId}});
  const supplied = '# Team supplied incomplete queries\n\nNo lookup for this selected order operation is supplied.\n';
  const suppliedPath = put('resources/Queries/team-export.md', supplied);
  const promotion = await promoteDiscoveredQueries(roots, {application: 'orders', reviewedIds: [reviewed.id]}), libraryBytes = readFileSync(promotion.path);
  await promoteDiscoveredQueries(roots, {application: 'orders', reviewedIds: [reviewed.id]}); assert.deepEqual(readFileSync(promotion.path), libraryBytes);
  const currentRun = createRun({environment, operations: [reviewed.operation], scenarios: [{id: '134', expectations: lookupScope}]}), currentRoots = runRoots(roots, currentRun);
  const currentSchema = await createDatabaseRuntime(currentRun, currentRoots).inspectSchema({target: 'db', operationId: 'verify-order', invocationId: 'verify-order', tables: ['DiscoveredOrders'], phase: 'VERIFY'});
  const current = {run: currentRun, roots: currentRoots, schema: currentSchema}; readReviewedDb(roots, reviewed.id, current);
  const cleanupEvidence = reviewed.verification.evidence.find(item => item.kind === 'lifecycle' && item.identity.operationId === cleanup.id); assert(cleanupEvidence);
  const cleanupPath = join(projectRoot, cleanupEvidence.path), cleanupBytes = readFileSync(cleanupPath); unlinkSync(cleanupPath);
  try {assert.throws(() => readReviewedDb(roots, reviewed.id, current)); await assert.rejects(promoteDiscoveredQueries(roots, {application: 'orders', reviewedIds: [reviewed.id]})); assert.deepEqual(readFileSync(promotion.path), libraryBytes);}
  finally {writeFileSync(cleanupPath, cleanupBytes, {flag: 'wx', mode: 0o600});}
  readReviewedDb(roots, reviewed.id, current);
  const durable = readFileSync(candidate.path, 'utf8') + readFileSync(reviewed.path, 'utf8') + libraryBytes.toString('utf8');
  const credential = JSON.parse(process.env.M8_DB_CREDENTIAL);
  for (const sentinel of [credential.user, credential.password, 'CustomerPrivateDiscovery134', ...run.inputs.values.filter(item => ['recordId', 'owner'].includes(item.name)).map(item => item.value)]) assert(!durable.includes(sentinel), 'Runtime/customer sentinel leaked into durable DB knowledge.');
  put('.harness/state/db-reuse.json', {environment, operation: reviewed.operation, reviewedId: reviewed.id, originalIdentity: run.inputs.values.find(item => item.name === 'recordId').value});
  const later = spawnSync(process.execPath, [import.meta.filename, 'reuse', projectRoot], {windowsHide: true, encoding: 'utf8', timeout: 180000});
  write(audit, 'reuse.log', later.stdout + later.stderr); assert.equal(later.status, 0, 'Fresh-process DB reuse failed.'); const reused = JSON.parse(later.stdout.trim()); assert.equal(await app.count(), 0);
  assert(!existsSync(join(projectRoot, 'src')) && !existsSync(join(projectRoot, 'tests')), 'Knowledge persistence and reuse must not generate POM code.');

  // Begin authoring only after standalone execution and durable knowledge reuse succeeded.
  const base = join(packageRoot, 'harness-tests/fixtures/observed-api-consumer');
  for (const file of ['src/pages/OrderPage.ts', 'src/utils/Expects.ts', 'src/config/applications.ts', 'playwright.config.ts']) {mkdirSync(join(projectRoot, file, '..'), {recursive: true}); cpSync(join(base, file), join(projectRoot, file));}
  cpSync(join(packageRoot, 'harness-tests/fixtures/discovered-db-consumer'), projectRoot, {recursive: true});
  cpSync(join(packageRoot, 'examples/src/utils/DBActions.ts'), join(projectRoot, 'src/utils/DBActions.ts'));
  const servicePath = join(projectRoot, 'src/dbs/DbsOrders.ts'); writeFileSync(servicePath, readFileSync(servicePath, 'utf8').replace('__REVIEWED_LOOKUP__', reviewed.operation.definition.sql));
  linkExampleDependencies(projectRoot, packageRoot);
  put('package.json', {name: 'discovered-db-proof', private: true, type: 'commonjs'});
  put('tsconfig.json', {compilerOptions: {target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, esModuleInterop: true, resolveJsonModule: true, skipLibCheck: true, types: ['node']}, include: ['src/**/*.ts', 'tests/**/*.ts', 'playwright.config.ts']});
  const expectations = sourceExpectations(selectedSource), assertionIds = ['created-draft', 'visible-order', 'submitted', 'found', 'owner-matches', 'status-matches', 'absent'];
  const handoff = createGenerationHandoff(selectedSource, [validation], expectations.map((expectation, index) => ({key: expectation.key, runId: run.id, scenarioId: '134', expectationId: assertionIds[index]})));
  await beginGeneration(roots, handoff, 'discovered-db-author');
  const mappings = [
    {actions: ['DbsOrders.createDraftOrder'], validations: ['DbsOrders.verifyOrderState']},
    {actions: ['OrderPage.navigate'], validations: ['OrderPage.verifyOrderIdentity']},
    {actions: ['OrderPage.submitOrder'], validations: ['OrderPage.verifyOrderStatus']},
    {actions: [], validations: ['DbsOrders.verifyOrderState']},
    {actions: ['DbsOrders.cleanupOrderIfOwned'], validations: ['DbsOrders.cleanupOrderIfOwned']}
  ];
  const generated = await registerCandidate(roots, selectedSource.id, {config: 'playwright.config.ts', tests: [{scenarioId: '134', spec: 'tests/OrderTests.spec.ts', project: 'chromium', titlePath: ['Orders', 'Test Case 134: Submit a draft order and verify persistence'], mapping: selectedSource.scenarios[0].steps.map((step, index) => ({step: index + 1, actions: mappings[index].actions, expectations: expectations.filter(item => item.step === index + 1).map(item => ({key: item.key, validations: mappings[index].validations}))}))}]});
  for (const [name, args] of [['conventions', [join(packageRoot, 'scripts/check-conventions.mjs'), '--root', projectRoot, '--fail-on-warn']], ['types', [join(packageRoot, 'examples/node_modules/typescript/bin/tsc'), '--project', join(projectRoot, 'tsconfig.json'), '--noEmit']]]) {
    const checked = spawnSync(process.execPath, args, {cwd: projectRoot, windowsHide: true, encoding: 'utf8'}); write(audit, name + '.log', checked.stdout + checked.stderr); assert.equal(checked.status, 0, name + ' check failed.');
  }
  const descriptor = {status: 'AWAITING_INDEPENDENT_REVIEW', projectRoot, revision: generated.revision, fingerprint: generated.snapshot.fingerprint, sourceId: selectedSource.id, audit,
    reviewInput: join(projectRoot, `.harness/state/${generated.revision}-review.json`), nativeDiscovery: {runId: discoveryRun.id, tableHint: 'Order', candidates: 1}, mixedRunId: run.id, reviewedId: reviewed.id, library: promotion.path, reuse: reused};
  write(audit, 'candidate.json', descriptor); console.log(JSON.stringify(descriptor));
  const deadline = Date.now() + 3600000;
  while (!existsSync(descriptor.reviewInput)) {assert(Date.now() < deadline, 'Independent review timeout.'); await pause(1000);}
  await recordGenerationReview(roots, selectedSource.id, read(descriptor.reviewInput));
  const first = await verifyGeneration(roots, selectedSource.id, {allure: true}), second = first.status === 'PASS' ? await verifyGeneration(roots, selectedSource.id, {allure: true}) : undefined;
  const status = await generationStatus(roots, selectedSource.id); write(audit, 'verification.json', {first, second, status});
  assert.equal(status.status, 'READY'); assert.equal(status.greens, 2); assert.notEqual(first.id, second.id);
  const reporting = [first, second].map(verification => {
    assert.equal(verification.reporting?.status, 'CAPTURED');
    const directory = join(projectRoot, verification.reporting.directory), capture = read(join(directory, 'capture.json')), resultsDirectory = join(directory, 'allure-results');
    assert.deepEqual(allureInventory(resultsDirectory), capture.artifacts); assert.equal(capture.tests, 1);
    const results = capture.artifacts.filter(artifact => artifact.path.endsWith('-result.json')).map(artifact => read(join(resultsDirectory, artifact.path)));
    assert.equal(results.length, 1); assert.equal(results[0].status, 'passed');
    const flatten = steps => (steps ?? []).flatMap(step => [step, ...flatten(step.steps)]), steps = flatten(results[0].steps);
    for (const title of [/^Create draft order:/, /^Navigate to order:/, /^Verify order identity:/, /^Submit the draft order$/, /^Verify order status: Submitted$/, /^Verify persisted order status: Submitted$/, /^Clean up the owned order$/]) {
      assert(steps.some(step => title.test(step.name) && step.status === 'passed'), `Allure business step missing: ${title}`);
    }
    const persistence = steps.find(step => step.name === 'Verify persisted order status: Submitted');
    assert(flatten(persistence.steps).some(step => (step.attachments ?? []).some(attachment => attachment.name === 'Query details')), 'Allure DB detail must remain nested under its business validation.');
    return {invocation: verification.id, directory: verification.reporting.directory, status: 'CAPTURED', tests: capture.tests, businessStepsInspected: true, nestedDatabaseEvidence: true};
  });
  write(audit, 'allure-evidence.json', reporting);
  assert.deepEqual(readFileSync(sourcePath), sourceBytes); assert.equal(readFileSync(suppliedPath, 'utf8'), supplied); assert.equal(await app.count(), 0);
  const summary = {status: 'PASS', platform: process.platform, node: process.version, metadata: {engine: 'sqlserver', tableHint: 'Order', table: 'DiscoveredOrders'}, standalone: {status: result.status, generatedCode: false, lifecycleComplete: result.scenarios[0].requiredLifecycleComplete},
    knowledge: {candidates: 1, reviewed: 1, library: promotion.path, repeatedPromotionStable: true, suppliedUnchanged: true, cleanupTamperRejected: true, sentinelFree: true}, reuse: reused, generation: status, reporting, remainingOrders: 0, audit};
  write(audit, 'summary.json', summary); console.log(JSON.stringify(summary)); success = true;
} catch (error) {write(audit, 'failure.txt', String(error.stack)); console.error(JSON.stringify({status: 'FAIL', reason: error.message, audit}));}
finally {await app?.close(); delete process.env.HARNESS_PROOF_ORIGIN; delete process.env.DB_CONSOLE_LOGS;}
process.exitCode = success ? 0 : 1;
