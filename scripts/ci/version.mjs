// Version preparation checks shared by the full checklist and dependency-free release jobs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

export function checkVersionContracts(root) {
  const json = name => JSON.parse(readFileSync(join(root, name), 'utf8'));
  const pkg = json('package.json'), lock = json('npm-shrinkwrap.json'), plugin = json('.claude-plugin/plugin.json');
  assert.equal(pkg.version, readFileSync(join(root, 'VERSION'), 'utf8').trim()); assert.equal(plugin.version, pkg.version);
  assert.equal(lock.version, pkg.version); assert.equal(lock.packages[''].version, pkg.version); assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  assert.equal(pkg.private, true, 'Release requires a separate explicit decision.'); assert.deepEqual(plugin.skills, ['./.agents/skills/']);
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').replaceAll('\r\n', '\n');
  const newest = changelog.match(/^## (\d+\.\d+\.\d+)\b.*\n([\s\S]*?)(?=^## \d+\.\d+\.\d+\b|(?![\s\S]))/m);
  assert.equal(newest?.[1], pkg.version, 'The newest CHANGELOG version heading must be the package version.');
  assert.match(newest[2], /^### Upgrade actions\n+- \S/m, 'The newest CHANGELOG version needs an "### Upgrade actions" list.');
  return {pkg, lock, plugin, notes: newest[0].trim()};
}
