import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './execution-core.mjs';
import {createAdoClient} from '../../scripts/lib/integrations/ado-client.mjs';

export const xml = (action = 'Open synthetic record', expected = 'Synthetic record is visible') => `<steps><step type="ValidateStep"><parameterizedString>${action}</parameterizedString><parameterizedString>${expected}</parameterizedString></step></steps>`;
export async function adoFixture(t, overrides = {}) {
  const core = fixture(t), credential = randomUUID(), config = {organizationUrl: 'https://ado.example.test/collection', project: 'demo', credentialRef: 'ADO_TEST_CREDENTIAL', ...overrides};
  const project = {id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'demo'}, projectPrefix = `/collection/${encodeURIComponent(config.project)}/_apis/`;
  const requests = [], items = new Map([101, 102, 200, 201].map(id => [id, {id, rev: 1, fields: {'System.Title': `Synthetic case ${id}`, 'System.TeamProject': project.name, 'System.Tags': 'existing', 'Microsoft.VSTS.TCM.Steps': xml()}, relations: []}]));
  items.get(201).relations = [{rel: 'System.LinkTypes.Hierarchy-Reverse', url: `${config.organizationUrl}/_apis/wit/workitems/200`}, {rel: 'AttachedFile', url: 'https://files.example.test/keep'}];
  const state = {points: [{id: 11, testCase: {id: '101'}}, {id: 12, testCase: {id: '102'}}], results: [], run: undefined, pr: undefined, fault: undefined, requests, items, runs: new Map(), resultsByRun: new Map(), attachments: new Map(), nextBug: 800,
    project, repository: {id: '11111111-2222-3333-4444-555555555555', name: 'harness', defaultBranch: 'refs/heads/main', project}};
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks), binary = req.headers['content-type'] === 'application/octet-stream', body = chunks.length ? binary ? {bytes: raw.length} : JSON.parse(raw) : undefined;
    const url = new URL(req.url, 'http://localhost'), path = url.pathname.replace(projectPrefix, '').replace('/collection/_apis/', '').toLowerCase();
    requests.push({method: req.method, path, query: url.search, body});
    const send = (data, status = 200, headers = {}) => { res.writeHead(status, {'content-type': 'application/json', ...headers}); res.end(JSON.stringify(data)); };
    if (req.headers.authorization !== `Basic ${Buffer.from(`:${credential}`).toString('base64')}`) return send({}, 401);
    if (state.fault && await state.fault({req, res, path, body, url, send})) return;
    if (path.startsWith('projects/')) return send(state.project);
    if (path === 'testplan/plans') return send({value: [{id: 1, name: 'Synthetic plan'}]});
    if (path === 'testplan/plans/1/suites') return send({value: [{id: 2, name: 'Synthetic suite'}]});
    if (path === 'testplan/plans/1/suites/2') return send({id: 2, name: 'Synthetic suite'});
    if (path === 'testplan/plans/1/suites/2/testcase') return url.searchParams.has('continuationToken') ? send({value: [{workItem: {id: 102}}]}) : send({value: [{workItem: {id: 101}}]}, 200, {'x-ms-continuationtoken': 'second'});
    // Like ADO, return only the requested fields, so tests can prove what a read never received.
    if (path === 'wit/workitemsbatch') {if (body.ids.length > 200) return send({}, 400); return send({value: body.ids.flatMap(id => items.has(id) ? [{...items.get(id), fields: Object.fromEntries(Object.entries(items.get(id).fields).filter(([name]) => body.fields.includes(name)))}] : [])});}
    if (path === 'wit/workitemtypecategories/microsoft.bugcategory') return send({referenceName: 'Microsoft.BugCategory', defaultWorkItemType: {name: 'Bug'}, workItemTypes: [{name: 'Bug'}]});
    if (path === 'wit/workitemtypes/bug/fields') return send({value: ['System.Title', 'System.Tags', 'System.AreaPath', 'System.IterationPath', 'System.AssignedTo', 'Microsoft.VSTS.TCM.ReproSteps', 'Microsoft.VSTS.Common.Priority', 'Microsoft.VSTS.Common.Severity'].map(referenceName => ({referenceName, ...(referenceName.endsWith('Priority') ? {allowedValues: ['1', '2', '3', '4']} : {})}))});
    if (path === 'wit/fields/microsoft.vsts.common.priority') return send({referenceName: 'Microsoft.VSTS.Common.Priority', type: 'integer'});
    if (path === 'wit/workitemtypes/bug/states') return send({value: [{name: 'New', category: 'Proposed'}, {name: 'Active', category: 'InProgress'}, {name: 'Closed', category: 'Completed'}]});
    if (path.startsWith('wit/classificationnodes/')) return send({path: `\\demo\\${path.split('/')[2] === 'areas' ? 'Area' : 'Iteration'}` + path.split('/').slice(3).map(part => `\\${decodeURIComponent(part)}`).join('')});
    if (path === 'wit/wiql') {const tag = body.query.match(/\[System.Tags\] CONTAINS '([^']+)'/)?.[1]; return send({workItems: [...items.values()].filter(item => String(item.fields['System.Tags'] ?? '').split(';').map(tag => tag.trim()).includes(tag)).map(item => ({id: item.id}))});}
    if (path === 'wit/workitems/$bug' && req.method === 'POST') {
      const fields = Object.fromEntries(body.filter(op => op.path.startsWith('/fields/')).map(op => [op.path.slice(8), op.value]));
      if (!fields['System.Title']) return send({}, 400);
      if (url.searchParams.get('validateOnly') === 'true') return send({fields});
      const item = {id: state.nextBug++, rev: 1, fields: {'System.TeamProject': 'demo', 'System.State': 'New', 'System.WorkItemType': 'Bug', ...fields}, relations: body.filter(op => op.path.startsWith('/relations/')).map(op => op.value)}; items.set(item.id, item);
      if (state.afterBugCreate) await state.afterBugCreate({item, req, res}); if (!res.destroyed) send(item); return;
    }
    if (path === 'wit/attachments' && req.method === 'POST') {const id = randomUUID(); state.attachments.set(id, raw); return send({id, url: `${config.organizationUrl}/_apis/wit/attachments/${id}`});}
    const wi = path.match(/^wit\/workitems\/(\d+)$/);
    if (wi) {
      const item = items.get(Number(wi[1])); if (!item) return send({}, 404);
      if (req.method === 'PATCH') {
        if (body[0]?.op !== 'test' || body[0]?.path !== '/rev' || body[0]?.value !== item.rev) return send({}, 412);
        for (const op of body.slice(1)) {
          if (op.path.startsWith('/fields/')) item.fields[op.path.slice(8)] = op.value;
          else if (op.op === 'remove') item.relations.splice(Number(op.path.split('/').at(-1)), 1);
          else item.relations.push(op.value);
        }
        item.rev++;
      }
      return send(item);
    }
    if (path === 'test/plans/1/suites/2/points') return send({value: state.points.slice(Number(url.searchParams.get('$skip')), Number(url.searchParams.get('$skip')) + 1)});
    if (path === 'test/runs' && req.method === 'POST') {
      state.run = {id: 55 + state.runs.size, name: body.name, plan: body.plan, automated: body.automated, state: 'InProgress'}; state.results = body.pointIds.map((id, i) => ({id: i + 71, testPoint: {id}, state: 'InProgress'})); state.runs.set(state.run.id, state.run); state.resultsByRun.set(state.run.id, state.results);
      if (state.afterRunCreate) await state.afterRunCreate({run: state.run, req, res}); if (!res.destroyed) send(state.run); return;
    }
    if (path === 'test/runs' && req.method === 'GET') {if (url.searchParams.has('name')) return send({}, 400); const runs = [...state.runs.values()].filter(run => !url.searchParams.has('planId') || Number(run.plan.id) === Number(url.searchParams.get('planId'))), skip = Number(url.searchParams.get('$skip')); return send({value: runs.slice(skip, skip + 1)});}
    const resultsPath = path.match(/^test\/runs\/(\d+)\/results$/), runPath = path.match(/^test\/runs\/(\d+)$/);
    if (resultsPath) {
      const values = Number(resultsPath[1]) === state.run?.id ? state.results : state.resultsByRun.get(Number(resultsPath[1])); if (!values) return send({}, 404);
      if (req.method === 'PATCH') {for (const row of body) Object.assign(values.find(item => item.id === row.id), row); return send({value: values});}
      return send({value: values.slice(Number(url.searchParams.get('$skip')), Number(url.searchParams.get('$skip')) + 1)});
    }
    if (runPath) {const run = state.runs.get(Number(runPath[1])); if (!run) return send({}, 404); if (req.method === 'PATCH') Object.assign(run, body); return send(run);}
    if (path === 'git/repositories/harness') return send(state.repository);
    if (path.endsWith('/refs')) return send({value: [{name: `refs/${url.searchParams.get('filter')}`} ]});
    if (path.endsWith('/pullrequests') && req.method === 'POST') { state.pr = {...body, pullRequestId: 77, repository: state.repository}; return send(state.pr); }
    if (path.endsWith('/pullrequests/77')) return send(state.pr);
    send({}, 404);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const fetchImpl = (url, init) => {
    const parsed = new URL(url);
    if (parsed.origin !== new URL(config.organizationUrl).origin || !(parsed.pathname.startsWith(projectPrefix) || parsed.pathname === `/collection/_apis/projects/${encodeURIComponent(config.project)}`)) throw new Error('Unexpected fixture destination');
    return fetch(`http://127.0.0.1:${server.address().port}${parsed.pathname}${parsed.search}`, init);
  };
  const client = createAdoClient({configuration: {...config, ...overrides}, roots: core.roots, resolveCredential: () => credential, fetchImpl});
  const receipts = () => {
    const dir = join(core.roots.projectRoot, '.harness/state/integrations');
    return existsSync(dir) ? readdirSync(dir).map(file => readFileSync(join(dir, file), 'utf8').trim().split('\n').map(line => JSON.parse(line))) : [];
  };
  return {...core, config, client, state, fetchImpl, credential, receipts};
}
