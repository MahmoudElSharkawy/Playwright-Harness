// Fixed native-proof recovery, using protected ownership receipts and existing native mechanics.
import assert from 'node:assert/strict';
import {readFile, readdir, realpath, lstat, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {within} from '../lib/skill-roots.mjs';
import {processCall} from '../lib/browser/processes.mjs';
import {recoverOwnedRun} from '../lib/browser/recovery.mjs';

const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const absent = reply => reply.exitCode !== 0 && !reply.kind && /No such (?:object|container)/i.test(reply.stderr);
async function plain(path, kind) {const stat = await lstat(path); assert(!stat.isSymbolicLink() && (kind === 'directory' ? stat.isDirectory() : stat.isFile()), 'Recovery path is not owned plain storage.'); return stat;}
export async function recoverNativeProof(packageRoot, consumer) {
  const result = {complete: true, databases: 0, browsers: 0, failures: []};
  try {await plain(consumer, 'directory'); consumer = await realpath(consumer); assert(!within(await realpath(packageRoot), consumer));}
  catch (error) {if (error.code === 'ENOENT') return result; return {...result, complete: false, failures: ['CONSUMER_BOUNDARY']};}
  const fail = value => {result.complete = false; result.failures.push(value);};
  const docker = args => processCall('docker', args, {timeoutMs: 30000});
  try {
    const path = join(consumer, 'infrastructure-ownership.jsonl'); assert((await plain(path, 'file')).size <= 1024 * 1024);
    const records = (await readFile(path, 'utf8')).trim().split('\n');
    for (const line of records) {
      try {
        const {name, owner} = JSON.parse(line);
        assert(new RegExp(`^harness-m11-(?:sqlserver|postgresql)-${uuid}$`).test(name) && new RegExp(`^${uuid}$`).test(owner));
        const inspected = await docker(['container', 'inspect', '--format', '{{.Id}} {{index .Config.Labels "playwright-harness.owner"}}', name]);
        if (absent(inspected)) continue;
        assert.equal(inspected.exitCode, 0); const [id, label] = inspected.stdout.trim().split(' ');
        assert(/^[a-f0-9]{64}$/.test(id) && label === owner, 'Container ownership differs.');
        const removed = await docker(['container', 'rm', '--force', id]); assert.equal(removed.exitCode, 0);
        assert(absent(await docker(['container', 'inspect', id]))); result.databases++;
      } catch {fail('DATABASE_RECOVERY');}
    }
  } catch (error) {if (error.code !== 'ENOENT') fail('DATABASE_JOURNAL');}
  const runs = join(consumer, '.harness/runs');
  try {
    await plain(join(consumer, '.harness'), 'directory'); await plain(runs, 'directory');
    const candidates = [];
    for (const entry of await readdir(runs, {withFileTypes: true})) {
      if (entry.isSymbolicLink()) {fail('BROWSER_BOUNDARY'); continue;}
      if (!entry.isDirectory()) continue;
      const outer = join(runs, entry.name); candidates.push(outer);
      // Standalone: runs/run/protected. Parallel: runs/batch/run/protected.
      for (const inner of await readdir(outer, {withFileTypes: true})) {
        if (inner.isSymbolicLink()) {fail('BROWSER_BOUNDARY'); continue;}
        if (inner.isDirectory() && !['protected', 'evidence'].includes(inner.name)) candidates.push(join(outer, inner.name));
      }
    }
    for (const run of candidates) {
      try {
        await plain(run, 'directory');
        const workRoot = join(run, 'protected');
        try {await plain(workRoot, 'directory');} catch (error) {if (error.code === 'ENOENT') continue; throw error;}
        const recovery = await recoverOwnedRun(packageRoot, consumer, run); assert(recovery.complete, 'Browser ownership recovery did not complete.'); result.browsers++;
      } catch {fail('BROWSER_RECOVERY');}
    }
  } catch (error) {if (error.code !== 'ENOENT') fail('BROWSER_JOURNAL');}
  return result;
}
