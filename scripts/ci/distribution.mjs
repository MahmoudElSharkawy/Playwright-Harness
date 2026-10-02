import assert from 'node:assert/strict';
import {readFileSync, realpathSync} from 'node:fs';
import {join} from 'node:path';
import {within} from '../lib/skill-roots.mjs';

const identity = ([path, item]) => `${path.split('node_modules/').at(-1)}@${item.version}`;
/** Constrain the fresh validation consumer to the already-cleared published graph.
 * npm can re-resolve compatible transitive ranges while relocating a shrinkwrap.
 */
export function clearedOverrides(expected) {
  const entries = Object.entries(expected.packages).filter(([path]) => path), versions = new Map();
  assert(entries.length > 0, 'Empty dependency lock.');
  for (const [path, item] of entries) {
    const name = path.split('node_modules/').at(-1);
    assert(typeof item.version === 'string' && item.version.length > 0, 'Missing cleared dependency version.');
    assert(!versions.has(name) || versions.get(name) === item.version, 'Multiple cleared versions require scoped installation constraints.');
    versions.set(name, item.version);
  }
  return Object.fromEntries(versions);
}
/** npm may relocate or duplicate nodes when installing a shrinkwrapped dependency.
 * Require exactly the cleared package identities and tarball integrity, not one layout.
 */
export function validateInstalledGraph(installation, expected) {
  const root = realpathSync(installation), actual = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const expectedEntries = Object.entries(expected.packages).filter(([path]) => path);
  assert(expectedEntries.length > 0, 'Empty dependency lock.');
  const allowed = new Map(expectedEntries.map(entry => [identity(entry), entry[1]])), seen = new Set(); let installedNodes = 0;
  for (const entry of Object.entries(actual.packages).filter(([path]) => path && path !== 'node_modules/playwright-pom-harness')) {
    const [path, item] = entry, key = identity(entry), cleared = allowed.get(key);
    assert(cleared && item.integrity === cleared.integrity && item.resolved === cleared.resolved, 'Installed dependency lacks cleared provenance.');
    assert(path.startsWith('node_modules/') && !path.split('/').includes('..'), 'Invalid dependency path.');
    const directory = realpathSync(join(root, path)); assert(within(root, directory), 'Installed dependency escapes its owned installation.');
    const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    assert.equal(`${metadata.name}@${metadata.version}`, key, 'Installed package metadata differs from its lock.'); seen.add(key); installedNodes++;
  }
  assert.deepEqual([...seen].sort(), [...allowed.keys()].sort(), 'Installed dependency scope differs.');
  return {dependencyIdentities: seen.size, installedNodes};
}
