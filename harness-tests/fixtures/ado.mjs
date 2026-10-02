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
  const state = {points: [{id: 11, testCase: {id: '101'}}, {id: 12, testCase: {id: '102'}}], results: [], run: undefined, pr: undefined, fault: undefined, requests, items,
    project, repository: {id: '11111111-2222-3333-4444-555555555555', name: 'harness', defaultBranch: 'refs/heads/main', project}};
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
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
    if (path === 'wit/workitemsbatch') return send({value: body.ids.flatMap(id => items.has(id) ? [{...items.get(id), fields: Object.fromEntries(Object.entries(items.get(id).fields).filter(([name]) => body.fields.includes(name)))}] : [])});
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
      state.run = {id: 55, state: 'InProgress'}; state.results = body.pointIds.map((id, i) => ({id: i + 71, testPoint: {id}, state: 'InProgress'})); return send(state.run);
    }
    if (path === 'test/runs/55/results') {
      if (req.method === 'PATCH') { for (const row of body) Object.assign(state.results.find(item => item.id === row.id), row); return send({value: state.results}); }
      return send({value: state.results.slice(Number(url.searchParams.get('$skip')), Number(url.searchParams.get('$skip')) + 1)});
    }
    if (path === 'test/runs/55') { if (req.method === 'PATCH') Object.assign(state.run, body); return send(state.run); }
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
