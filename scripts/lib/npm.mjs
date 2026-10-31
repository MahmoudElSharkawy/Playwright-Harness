import assert from 'node:assert/strict';
import {existsSync, realpathSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';

/** The npm CLI script to run with process.execPath: the npm that launched this process,
 * otherwise Node's bundled npm. Never a shell shim such as npm.cmd.
 */
export function npmPath() {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
  const path = candidates.find(path => path && existsSync(path)); if (!path) throw new Error('Node-bundled npm is required.'); return realpathSync(path);
}

/** Constrain a consumer to the already-cleared published graph.
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
