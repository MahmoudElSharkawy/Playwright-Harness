// Fixed validation process plumbing, never a scenario executor.
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

export {npmPath} from '../lib/npm.mjs';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function command(args, {cwd, env = {}, timeout = 300000, log} = {}) {
  const result = spawnSync(process.execPath, args, {cwd, env: {...process.env, ...env}, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024});
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  if (log) writeFileSync(log, output, {flag: 'wx', mode: 0o600});
  return {status: result.status === 0 && !result.error ? 'PASS' : 'FAIL', exitCode: result.status, diagnostic: result.error?.code ?? null, stdout: result.stdout ?? '', output, sha256: hash(output)};
}
