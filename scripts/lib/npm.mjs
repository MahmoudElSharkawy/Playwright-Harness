import {existsSync, realpathSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';

/** The npm CLI script to run with process.execPath: the npm that launched this process,
 * otherwise Node's bundled npm. Never a shell shim such as npm.cmd.
 */
export function npmPath() {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
  const path = candidates.find(path => path && existsSync(path)); if (!path) throw new Error('Node-bundled npm is required.'); return realpathSync(path);
}
