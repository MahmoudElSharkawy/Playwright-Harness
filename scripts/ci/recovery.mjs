// Fixed native-proof recovery, using protected ownership receipts and existing native mechanics.
import assert from 'node:assert/strict';
import {readFile, readdir, realpath, lstat, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {within} from '../lib/skill-roots.mjs';
import {processCall, stopTree, treeGone} from '../lib/browser/processes.mjs';

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
        const file = join(workRoot, 'native-ownership.json'); assert((await plain(file, 'file')).size <= 1024 * 1024);
        const record = JSON.parse(await readFile(file, 'utf8'));
        assert(record.version === 1 && /^harness_[a-f0-9]{32}$/.test(record.session) && ['prepared', 'opening', 'opened'].includes(record.stage) && Array.isArray(record.trees));
        for (const tree of record.trees) assert(Array.isArray(tree) && tree.length > 0 && tree.every(item => Number.isSafeInteger(item.pid) && item.pid > 0 && typeof item.identity === 'string' && /^\d+$/.test(item.identity)));
        const cli = args => processCall(process.execPath, [join(packageRoot, 'scripts/spikes/playwright-cli/node_modules/@playwright/cli/playwright-cli.js'), '--json', `-s=${record.session}`, ...args],
          {cwd: workRoot, timeoutMs: 30000, env: {...process.env, CI: '1', NO_UPDATE_NOTIFIER: '1'}});
        const closed = await cli(['close']); assert.equal(closed.exitCode, 0); const close = JSON.parse(closed.stdout);
        assert(close.session === record.session && ['closed', 'not-open'].includes(close.status));
        // A lost open response is recoverable through a live named-session close. If
        // neither a live close nor process identities exist, preserve uncertainty.
        assert(record.stage === 'prepared' || record.trees.length || close.status === 'closed', 'Open effect remains uncertain.');
        for (const tree of record.trees) {if (!await treeGone(tree)) await stopTree(tree, Date.now() + 30000); assert(await treeGone(tree));}
        const deleted = await cli(['delete-data']); assert.equal(deleted.exitCode, 0);
        const listed = await cli(['list']); assert.equal(listed.exitCode, 0);
        assert(Array.isArray(JSON.parse(listed.stdout).browsers) && !JSON.parse(listed.stdout).browsers.some(item => item.name === record.session));
        assert(within(consumer, await realpath(workRoot)) && await realpath(workRoot) === workRoot); await plain(workRoot, 'directory');
        await rm(workRoot, {recursive: true}); result.browsers++;
      } catch {fail('BROWSER_RECOVERY');}
    }
  } catch (error) {if (error.code !== 'ENOENT') fail('BROWSER_JOURNAL');}
  return result;
}
