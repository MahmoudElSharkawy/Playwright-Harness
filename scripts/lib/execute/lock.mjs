import {mkdirSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {consumerPath} from '../consumer-paths.mjs';
import {processInventory} from '../browser/processes.mjs';
import {recoverOwnedRun} from '../browser/recovery.mjs';
import {readOptional, writeJson, publishExclusive} from './storage.mjs';
import {requireThat, id, fingerprint} from '../execution-core/data.mjs';
import {protect} from '../generation/storage.mjs';

const same = (all, item) => item && all.some(process => process.pid === item.pid && process.identity === item.identity);
const selfIdentities = new WeakMap();
export async function processIdentity(pid = process.pid, inventory = processInventory) {
  if (pid === process.pid && selfIdentities.has(inventory)) return selfIdentities.get(inventory);
  const item = (await inventory()).find(item => item.pid === pid); requireThat(item, 'Process creation identity is unavailable.');
  const identity = {pid: item.pid, identity: item.identity}; if (pid === process.pid) selfIdentities.set(inventory, identity); return identity;
}
export function lockPaths(roots, key = 'active') {
  id(key);
  const directory = consumerPath(roots, '.harness/state/execute'); mkdirSync(directory, {recursive: true, mode: 0o700});
  protect(directory);
  return {directory, lock: join(directory, `${key}.lock`), mutex: join(directory, `${key}.lock.mutex`)};
}
/** Serialize short lock transitions. Absence is established by creation identity, never age. */
export async function withTransition(roots, action, {inventory = processInventory, key = 'active', attempts = 100} = {}) {
  const paths = lockPaths(roots, key), holder = {...await processIdentity(process.pid, inventory), nonce: randomUUID()};
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {publishExclusive(paths.mutex, JSON.stringify(holder)); break;}
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try {owner = readOptional(paths.mutex);} catch (error) {
        if (!(error instanceof SyntaxError) && !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
        requireThat(attempt < attempts - 1, 'BUSY: execution mutex is not readable.'); continue;
      }
      if (!owner) {requireThat(attempt < attempts - 1, 'BUSY: execution mutex changed.'); continue;}
      const all = await inventory();
      if (!same(all, owner)) {
        if (fingerprint(readOptional(paths.mutex)) === fingerprint(owner)) try {unlinkSync(paths.mutex);} catch (error) {if (error.code !== 'ENOENT') throw error;}
        if (attempt === attempts - 1) throw new Error('BUSY: stale ownership changed; retry the command.');
        continue;
      }
      requireThat(attempt < attempts - 1, 'BUSY: execution ownership transition is active.'); await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  try {return await action(paths, readOptional(paths.lock));}
  finally {const owner = readOptional(paths.mutex); if (owner && fingerprint(owner) === fingerprint(holder)) try {unlinkSync(paths.mutex);} catch (error) {if (error.code !== 'ENOENT') throw error;}}
}
export async function acquireLauncher(roots, {executionId, runId}, options = {}) {
  return withTransition(roots, async (paths, current) => {
    if (current) {
      const all = await (options.inventory ?? processInventory)();
      requireThat(!['launcher', 'spawned', 'host'].some(name => same(all, current[name])), 'BUSY: an execution host already owns the lock.');
      const recovery = await (options.recover ?? recoverOwnedRun)(roots.packageRoot, roots.projectRoot, consumerPath(roots, `.harness/runs/${current.executionId}/${current.runId}`));
      requireThat(recovery.complete, 'Owned run recovery requires remediation.'); unlinkSync(paths.lock);
    }
    const record = {version: 1, state: 'launching', nonce: randomUUID(), executionId, runId, launcher: await processIdentity(process.pid, options.inventory ?? processInventory)};
    writeJson(paths.lock, record, {exclusive: true}); return record;
  }, options);
}
export async function recordSpawned(roots, nonce, spawned, options = {}) {
  return withTransition(roots, (paths, current) => {requireThat(current?.nonce === nonce, 'Launch lock changed.'); writeJson(paths.lock, {...current, spawned});}, options);
}
export async function claimHost(roots, nonce, options = {}) {
  const host = await processIdentity(process.pid, options.inventory ?? processInventory);
  return withTransition(roots, (paths, current) => {requireThat(current?.nonce === nonce && current.state === 'launching', 'Launch ownership changed.'); const next = {...current, state: 'running', host}; writeJson(paths.lock, next); return next;}, options);
}
export async function releaseHost(roots, nonce, options = {}) {
  return withTransition(roots, (paths, current) => {if (current?.nonce !== nonce) return false; unlinkSync(paths.lock); return true;}, options);
}
export async function lockStatus(roots) {const {lock} = lockPaths(roots); return readOptional(lock);}
