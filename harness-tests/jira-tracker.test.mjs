import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture} from './fixtures/execution-core.mjs';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';
const source = {provider: 'jira', siteUrl: 'https://example.atlassian.net', project: 'DEMO', testManagement: 'zephyr-scale'};
function setup(t, bound = source) {
  const {roots} = fixture(t), planId = bound ? 'DEMO-P1' : 1, ids = bound ? ['DEMO-T1', 'DEMO-T2'] : [101, 102];
  const put = (path, value) => {mkdirSync(dirname(join(roots.projectRoot, path)), {recursive: true}); writeFileSync(join(roots.projectRoot, path), typeof value === 'string' ? value : JSON.stringify(value));};
  put(`.harness/state/tracker/plan-${planId}.json`, {planId, ...(bound ? {source: bound} : {}), names: ['QA'], branches: [{name: 'Checkout', inScope: true}], suites: [{id: bound ? 'DEMO-R1' : 2, name: 'Checkout', branch: 0, cases: ids.map(id => ({id, title: 'Case', desc: '', verdict: 'k', note: ''}))}], manual: {[ids[1]]: 'Requires a person.'}});
  const run = (...args) => spawnSync(process.execPath, [join(roots.packageRoot, 'scripts/generate-tracker.mjs'), '--project-root', roots.projectRoot, '--plan', String(planId), '--json', ...args], {encoding: 'utf8', windowsHide: true});
  return {roots, planId, ids, put, run};
}
test('tracker preserves legacy numeric Azure registries and events', t => {
  const f = setup(t, null); f.put('.harness/state/tracker/history.jsonl', JSON.stringify({at: '2026-10-01', set: {done: [101]}}) + '\n');
  const result = f.run(); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /"passing": 1/);
});
test('tracker uses opaque Jira keys and only folds history bound to the same site/provider', t => {
  const f = setup(t); f.put('.harness/state/tracker/history.jsonl', [JSON.stringify({at: '2026-10-01', sourceIdentity: fingerprint({...source, siteUrl: 'https://example-other.atlassian.net'}), set: {done: ['DEMO-T1']}}), JSON.stringify({at: '2026-10-02', sourceIdentity: fingerprint(source), set: {doing: ['DEMO-T1']}})].join('\n') + '\n');
  const result = f.run(); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /"doing": 1/); assert.match(result.stdout, /"passing": 0/); assert.match(result.stdout, /"manual": 1/);
  const html = readFileSync(join(f.roots.projectRoot, `reports/tracker/plan-${f.planId}-tracker.html`), 'utf8'); assert(html.includes('DEMO-T1')); assert(html.includes(fingerprint(source)));
});
test('tracker sync refuses native state from another site or a stale source fingerprint', t => {
  const f = setup(t); f.put('.harness/state/tracker/history.jsonl', '');
  const folder = 'execution-tests/jira-suite-DEMO-R1-synthetic';
  f.put(folder + '/_suite.json', {...source, sourceFingerprint: 'current', cases: [{id: 'DEMO-T1'}]});
  f.put(folder + '/_verify-state.json', {sourceFingerprint: 'old', cases: {'DEMO-T1': {status: 'passed'}}});
  let result = f.run('--sync', '--dry-run'); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /"passing": 0/);
  f.put(folder + '/_verify-state.json', {sourceFingerprint: 'current', cases: {'DEMO-T1': {status: 'passed'}}});
  result = f.run('--sync', '--dry-run'); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /"passing": 1/); assert(result.stdout.includes(fingerprint(source)));
  f.put(folder + '/_suite.json', {...source, siteUrl: 'https://example-other.atlassian.net', sourceFingerprint: 'current'});
  result = f.run('--sync', '--dry-run'); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /"passing": 0/);
});
test('no-plugin local tracker uses local identities and history without tracker credentials', t => {
  const bound = {provider: 'local', id: 'checkout'}, f = setup(t, bound);
  f.put('.harness/integrations.json', 'deliberately unused malformed remote configuration');
  f.put('.harness/state/tracker/history.jsonl', JSON.stringify({at: '2026-10-01', sourceIdentity: fingerprint(bound), set: {done: ['DEMO-T1']}}) + '\n');
  const result = f.run('--sync', '--dry-run'); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /"passing": 1/);
});
