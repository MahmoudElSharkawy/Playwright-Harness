import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import * as validation from '../scripts/lib/package-validation.mjs';
import {validateInstalledGraph} from '../scripts/ci/distribution.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const item = {version: '1.0.0', resolved: 'https://registry.npmjs.org/synthetic/-/synthetic-1.0.0.tgz', integrity: 'sha512-synthetic'};
  const lock = {packages: {'': {}, 'node_modules/synthetic': item}};
  const files = new Map([
    ['node_modules/synthetic/package.json', Buffer.from(JSON.stringify({name: 'synthetic', version: '1.0.0'}))],
    ['node_modules/synthetic/LICENSE', Buffer.from('Synthetic license fixture\n')],
    ['node_modules/synthetic/index.js', Buffer.from('export default 1;\n')]
  ]);
  const list = [...files].map(([path, bytes]) => [path.slice('node_modules/synthetic/'.length), digest(bytes)]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const record = {schemaVersion: 1, packages: {'node_modules/synthetic': {...item, filesSha256: digest(JSON.stringify(list))}}};
  return {item, lock, files, record};
}
function temporary(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'harness-bundle-'));
  t.after(() => rmSync(root, {recursive: true})); return root;
}
function put(root, file, value) {
  mkdirSync(dirname(join(root, file)), {recursive: true});
  writeFileSync(join(root, file), Buffer.isBuffer(value) ? value : JSON.stringify(value));
}

test('runtime bundle integrity preserves exact cleared package bytes and upstream notices', () => {
  const {lock, files, record} = fixture();
  assert.deepEqual(validation.runtimeBundleIntegrity(files, lock), record);
  assert.deepEqual(validation.validateRuntimeBundle(files, lock, record), [...files.keys()].sort());
  for (const change of [
    map => map.delete('node_modules/synthetic/LICENSE'),
    map => map.set('node_modules/synthetic/index.js', Buffer.from('changed')),
    map => map.set('node_modules/synthetic/private.env', Buffer.from('extra')),
    map => map.set('node_modules/extra/package.json', Buffer.from('{"name":"extra","version":"1.0.0"}')),
    map => map.set('examples/node_modules/synthetic/index.js', Buffer.from('extra'))
  ]) {
    const changed = new Map(files); change(changed);
    assert.throws(() => validation.validateRuntimeBundle(changed, lock, record), /bundle/i);
  }
  assert.throws(() => validation.validateRuntimeBundle(new Map(), lock, record), /bundle/i);
  const altered = structuredClone(record); altered.packages['node_modules/synthetic'].integrity = 'changed';
  assert.throws(() => validation.validateRuntimeBundle(files, lock, altered), /bundle/i);
});

test('publication allows only the validated root runtime file list', () => {
  const {files} = fixture(), source = ['README.md', 'package.json'], scope = {files: source, unexpected: []};
  const runtime = [...files.keys()];
  assert.deepEqual(validation.publicationFindings(scope, [...source, ...runtime], runtime), []);
  for (const extra of ['node_modules/unreviewed/index.js', 'examples/node_modules/synthetic/index.js', '.m1-private/recovery.dpapi']) {
    assert(validation.publicationFindings(scope, [...source, ...runtime, extra], runtime).some(item => item.file === extra));
  }
  assert(validation.publicationFindings(scope, [...source, ...runtime.slice(1)], runtime).some(item => item.rule === 'missing-packed-file'));
});

test('installed bundled nodes may omit outer registry metadata only when their verified bytes retain provenance', t => {
  const root = temporary(t), {lock, files, record} = fixture(), prefix = 'node_modules/playwright-pom-harness';
  for (const [file, bytes] of files) put(root, `${prefix}/${file}`, bytes);
  put(root, `${prefix}/scripts/runtime-bundle-integrity.json`, record);
  const path = `${prefix}/node_modules/synthetic`, outer = {packages: {'': {}, [prefix]: {version: '1.0.0'}, [path]: {version: '1.0.0', inBundle: true}}};
  put(root, 'package-lock.json', outer);
  assert.deepEqual(validateInstalledGraph(root, lock), {dependencyIdentities: 1, installedNodes: 1});
  put(root, `${prefix}/node_modules/synthetic/index.js`, Buffer.from('tampered'));
  assert.throws(() => validateInstalledGraph(root, lock), /bundle/i);
  put(root, `${prefix}/node_modules/synthetic/index.js`, files.get('node_modules/synthetic/index.js'));
  outer.packages[path].resolved = 'https://example.test/foreign.tgz'; put(root, 'package-lock.json', outer);
  assert.throws(() => validateInstalledGraph(root, lock), /provenance/i);
  assert.equal(readFileSync(join(root, `${prefix}/node_modules/synthetic/LICENSE`), 'utf8'), 'Synthetic license fixture\n');
});
