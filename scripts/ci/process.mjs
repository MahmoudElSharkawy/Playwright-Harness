// Fixed validation process plumbing, never a scenario executor.
import {spawnSync} from 'node:child_process';
import {existsSync, realpathSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {createHash} from 'node:crypto';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function npmPath() {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
  const path = candidates.find(path => path && existsSync(path)); if (!path) throw new Error('Node-bundled npm is required.'); return realpathSync(path);
}
export function command(args, {cwd, env = {}, timeout = 300000, log} = {}) {
  const result = spawnSync(process.execPath, args, {cwd, env: {...process.env, ...env}, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024});
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  if (log) writeFileSync(log, output, {flag: 'wx', mode: 0o600});
  return {status: result.status === 0 && !result.error ? 'PASS' : 'FAIL', exitCode: result.status, diagnostic: result.error?.code ?? null, output, sha256: hash(output)};
}
