import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {executeMain} from '../scripts/execute-test.mjs';
import {ownedFile, readExecution, readFrozen} from '../scripts/lib/execute/storage.mjs';
import {bugReportFromExecution} from '../scripts/lib/bug-report/index.mjs';
import {reviewRunFailures} from '../scripts/lib/bug-report/failures.mjs';
import {adoFixture, xml} from './fixtures/ado.mjs';
import {executeApi, executionFixture} from './fixtures/execute.mjs';

for (const kind of ['story', 'suite']) {
  const selected = kind === 'story' ? '400' : '2';
  const scopeArgs = kind === 'story' ? [kind, selected] : [kind, selected, '--plan', '1'];

  test(`${kind} preparation reuses case bodies and refreshes only affected cases`, async t => {
    const f = await executionFixture(t), ado = await adoFixture(t);
    const fields = 'Microsoft.VSTS.TCM.Steps';
    const item = id => ado.state.items.get(id);
    const setMembers = ids => {
      ado.state.items.set(400, {id: 400, rev: 1, fields: {'System.Title': 'Synthetic story', 'System.TeamProject': 'demo', 'System.WorkItemType': 'User Story'},
        relations: ids.map(id => ({rel: 'Microsoft.VSTS.Common.TestedBy-Forward', url: `${ado.config.organizationUrl}/_apis/wit/workitems/${id}`}))});
      ado.state.fault = ({path, send}) => {
        if (path === 'wit/workitemtypecategories/microsoft.testcasecategory') {
          send({referenceName: 'Microsoft.TestCaseCategory', workItemTypes: [{name: 'Test Case'}]});
          return true;
        }
        if (path !== 'testplan/plans/1/suites/2/testcase') return false;
        send({value: ids.map(id => ({workItem: {id}}))});
        return true;
      };
    };
    for (const id of [101, 102, 200, 201]) {
      item(id).fields['System.WorkItemType'] = 'Test Case';
      item(id).fields[fields] = xml('Read status', 'Status is 200');
    }
    item(101).fields[fields] = '<steps><compref id="1" ref="201"/></steps>';
    setMembers([101, 102, 200]);
    f.put('.harness/integrations.json', {version: 1, ado: ado.config});
    const prepare = () => executeMain(f.roots, ['prepare', ...scopeArgs], {fetchImpl: ado.fetchImpl,
      environment: {ADO_TEST_CREDENTIAL: ado.credential}, inventory: async () => [{pid: process.pid, identity: 'fixture-process'}]});
    const contentReads = () => ado.state.requests.filter(r => r.body?.fields?.includes(fields)).flatMap(r => r.body.ids);
    const first = await prepare();
    assert.deepEqual(new Set(contentReads()), new Set([101, 102, 200, 201]));
    const refinementPath = ownedFile(f.roots, first.executionId, 'refinement.json');
    const refinement = JSON.parse(readFileSync(refinementPath, 'utf8'));
    f.apiStep();
    for (const scenario of refinement.scenarios) {
      const key = scenario.steps[0].expectations[0].key;
      scenario.steps = structuredClone(f.refinement.scenarios[0].steps);
      scenario.steps[0].expectations[0].key = key;
      scenario.steps[0].checkProvenance[0].key = key;
    }
    writeFileSync(refinementPath, JSON.stringify(refinement));
    await executeMain(f.roots, ['freeze', first.executionId]);
    ado.state.requests.length = 0;
    const repeat = await prepare();
    assert.notEqual(repeat.executionId, first.executionId);
    assert.deepEqual(contentReads(), []);
    assert.deepEqual(JSON.parse(readFileSync(repeat.refinement, 'utf8')), refinement);
    await executeMain(f.roots, ['freeze', repeat.executionId]);

    const folder = `execution-tests/ado-${kind}-${selected}`;
    const manifest = () => f.read(`${folder}/_suite.json`);
    const spec = join(f.projectRoot, folder, manifest().cases[0].specFile);
    const refinedSpec = `${readFileSync(spec, 'utf8').replace('Read status', 'Read refined status')}\n## Refinement log\nKeep this note.\n`;
    writeFileSync(spec, refinedSpec);
    setMembers([101, 102, 300]);
    ado.state.items.set(300, {...structuredClone(item(200)), id: 300});
    item(201).rev++;
    item(201).fields[fields] = xml('Read new status', 'Status is 200');
    ado.state.requests.length = 0;
    const refresh = await prepare();
    assert.deepEqual(new Set(contentReads()), new Set([101, 201, 300]));
    assert.deepEqual(refresh.changes.added.map(row => row.id), [300]);
    assert.deepEqual(refresh.changes.updated.map(row => row.id), [101]);
    assert.deepEqual(refresh.changes.removed.map(row => row.id), [200]);
    assert.deepEqual(manifest().cases.map(row => row.id), [101, 102, 300]);
    assert.match(readFileSync(spec, 'utf8'), /Read new status[\s\S]*Keep this note/);
    assert.deepEqual(readExecution(f.roots, first.executionId).source.cases.map(row => row.id), [101, 102, 200]);
    const refreshed = JSON.parse(readFileSync(refresh.refinement, 'utf8'));
    assert.equal(refreshed.scenarios[0].steps[0].operation, undefined);
    assert.deepEqual(refreshed.scenarios[1], refinement.scenarios[1]);
    const currentSpec = readFileSync(spec, 'utf8').replace('Read new status', 'Read locally refined status');
    writeFileSync(spec, currentSpec);
    await prepare();
    assert.equal(readFileSync(spec, 'utf8'), currentSpec);

    const beforeIncomplete = manifest(), respond = ado.state.fault;
    item(101).rev++;
    ado.state.fault = args => {
      if (args.path === 'wit/workitemsbatch' && args.body.ids.includes(201)) {
        args.send({value: []});
        return true;
      }
      return respond(args);
    };
    await assert.rejects(prepare, /ADO omitted required work items/);
    assert.deepEqual(manifest(), beforeIncomplete);
    assert.equal(readFileSync(spec, 'utf8'), currentSpec);
  });

  test(`${kind} frozen rerun uses a fresh execution and makes zero ADO calls`, async t => {
    let status = 404;
    const f = await executionFixture(t, {storyId: kind === 'story' ? 400 : undefined,
      handler: (_req, res) => {res.writeHead(status, {'content-type': 'application/json'}); res.end('{}');}});
    f.apiStep(); f.freeze();
    await executeApi(f);
    const oldReport = await executeMain(f.roots, ['report', f.executionId]);
    assert.equal(oldReport.scenarios[0].status, 'FAIL');
    const old = readFrozen(f.roots, f.executionId);
    let adoCalls = 0;
    const originalFetch = globalThis.fetch;
    const guardedFetch = (url, options) => {
      if (new URL(url).origin === f.origin) return originalFetch(url, options);
      adoCalls++;
      throw new Error('Only the fixture application may be contacted');
    };
    t.mock.method(globalThis, 'fetch', guardedFetch);
    const prepare = () => executeMain(f.roots, ['prepare', kind, selected, '--from-snapshot', f.executionId], {
      environment: {}, fetchImpl: guardedFetch
    });
    const clone = await prepare();
    assert.equal(clone.status, 'FROZEN');
    assert.notEqual(clone.executionId, f.executionId);
    const loaded = readFrozen(f.roots, clone.executionId);
    assert.deepEqual(loaded.freeze, old.freeze);
    assert.deepEqual(loaded.execution.runs, []);
    assert.equal(loaded.execution.parentExecutionId, f.executionId);
    await assert.rejects(executeMain(f.roots, ['prepare', kind, '999', '--from-snapshot', f.executionId], {fetchImpl: guardedFetch}), /does not match/);
    status = 200;
    await executeApi({...f, executionId: clone.executionId});
    const report = await executeMain(f.roots, ['report', clone.executionId]);
    assert.equal(report.scenarios[0].status, 'PASS');
    assert.notEqual(report.html, oldReport.html);
    assert.deepEqual(readFrozen(f.roots, f.executionId), old);
    const failed = await prepare();
    status = 404;
    await executeApi({...f, executionId: failed.executionId});
    const failedReport = await executeMain(f.roots, ['report', failed.executionId]);
    assert.equal(failedReport.scenarios[0].status, 'FAIL');
    const review = await reviewRunFailures(f.roots, {workflow: 'execute-test', executionId: failed.executionId});
    bugReportFromExecution(f.roots, 'local-bug', failed.executionId, review.findings[0].id);
    assert.equal(adoCalls, 0);
  });
}
