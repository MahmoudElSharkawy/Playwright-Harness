import {spawn} from 'node:child_process';
import {appendFileSync, writeFileSync, readFileSync} from 'node:fs';
import {observeHostProcess} from '../lib/host-proof-processes.mjs';
import {hash} from './process.mjs';

/** A deadline remains a failure even when cooperative cleanup completes. */
export async function nativeProcess(script, consumer, {cwd, log, timeoutMs = 1200000, graceMs = 180000} = {}) {
  writeFileSync(log, '', {flag: 'wx', mode: 0o600});
  const child = spawn(process.execPath, [script, consumer], {cwd, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc']});
  let timedOut = false, bytes = 0, outputLimited = false, logFailed = false;
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 16 * 1024 * 1024) {outputLimited = true; return;}
    try {appendFileSync(log, chunk);} catch {logFailed = true; if (child.connected) child.send({type: 'cancel-native-proof'}, () => {});}
  });
  const timer = setTimeout(() => {
    timedOut = true;
    if (child.connected) child.send({type: 'cancel-native-proof'}, () => {});
  }, timeoutMs);
  let result;
  try {result = await observeHostProcess(child, {timeoutMs: timeoutMs + graceMs});}
  finally {clearTimeout(timer);}
  let sha256; try {sha256 = hash(readFileSync(log));} catch {logFailed = true;}
  const diagnostic = timedOut || result.timedOut ? 'TIMEOUT' : logFailed ? 'LOG_WRITE' : outputLimited ? 'OUTPUT_LIMIT' : result.ownedProcessesStopped ? null : 'PROCESS_CLEANUP';
  return {status: result.exitCode === 0 && !diagnostic ? 'PASS' : 'FAIL', ...result, timedOut: timedOut || result.timedOut, diagnostic, sha256};
}
