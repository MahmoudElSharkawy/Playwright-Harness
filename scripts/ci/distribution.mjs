import assert from 'node:assert/strict';
import {readFileSync, realpathSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {within} from '../lib/skill-roots.mjs';
import {RUNTIME_BUNDLE_RECORD, runtimeBundleFiles, validateRuntimeBundle} from '../lib/package-validation.mjs';
import {archiveFiles} from './archive.mjs';

const identity = ([path, item]) => `${path.split('node_modules/').at(-1)}@${item.version}`;
/** npm may relocate or duplicate nodes when installing a shrinkwrapped dependency.
 * Require exactly the cleared package identities and tarball integrity, not one layout.
 */
export function validateInstalledGraph(installation, expected, archive) {
  const root = realpathSync(installation), actual = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const harness = 'node_modules/playwright-pom-harness', recordFile = join(root, harness, RUNTIME_BUNDLE_RECORD);
  let bundled;
  if (existsSync(recordFile)) {
    const record = JSON.parse(readFileSync(recordFile, 'utf8'));
    if (archive) assert.deepEqual(record, JSON.parse(archiveFiles(archive).get(RUNTIME_BUNDLE_RECORD)?.toString('utf8')), 'Installed runtime build record differs from the trusted archive.');
    validateRuntimeBundle(runtimeBundleFiles(join(root, harness)), expected, record);
    bundled = new Set(Object.keys(record.packages).map(path => `${harness}/${path}`));
  }
  const expectedEntries = Object.entries(expected.packages).filter(([path]) => path);
  assert(expectedEntries.length > 0, 'Empty dependency lock.');
  const allowed = new Map(expectedEntries.map(entry => [identity(entry), entry[1]])), seen = new Set(); let installedNodes = 0;
  for (const entry of Object.entries(actual.packages).filter(([path]) => path && path !== 'node_modules/playwright-pom-harness')) {
    const [path, item] = entry, key = identity(entry), cleared = allowed.get(key);
    const verifiedBundle = bundled?.has(path) && item.inBundle === true;
    assert(cleared && (item.integrity === cleared.integrity || verifiedBundle && item.integrity === undefined)
      && (item.resolved === cleared.resolved || verifiedBundle && item.resolved === undefined), 'Installed dependency lacks cleared provenance.');
    assert(path.startsWith('node_modules/') && !path.split('/').includes('..'), 'Invalid dependency path.');
    const directory = realpathSync(join(root, path)); assert(within(root, directory), 'Installed dependency escapes its owned installation.');
    const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    assert.equal(`${metadata.name}@${metadata.version}`, key, 'Installed package metadata differs from its lock.'); seen.add(key); installedNodes++;
  }
  assert.deepEqual([...seen].sort(), [...allowed.keys()].sort(), 'Installed dependency scope differs.');
  return {dependencyIdentities: seen.size, installedNodes};
}
