import {rememberTree, refreshTree, stopTree, treeGone} from './browser/processes.mjs';

/** Observe only this spawned native host. Unknown ownership permanently fails the proof. */
export async function observeHostProcess(child, {inspect = rememberTree, refresh = refreshTree, stop = stopTree, gone = treeGone, timeoutMs = 600000} = {}) {
  const completion = new Promise(resolve => {child.once('error', () => resolve(null)); child.once('close', resolve);});
  let tree = [], timedOut = false, cleanupError = false, ownershipInspectionFailed = false;
  try {tree = await inspect(child.pid); if (!tree.length) throw new Error('Empty ownership record.');}
  catch {ownershipInspectionFailed = true; cleanupError = true; child.kill();}
  let refreshing = Promise.resolve();
  const watcher = setInterval(() => {refreshing = refreshing.then(() => refresh(tree, Date.now() + 10000)).catch(() => {cleanupError = true;});}, 20000);
  const timer = setTimeout(() => {
    timedOut = true;
    void refreshing.then(() => stop(tree, Date.now() + 30000)).catch(() => {cleanupError = true;}).finally(() => child.kill());
  }, timeoutMs);
  const exitCode = await completion; clearTimeout(timer); clearInterval(watcher); await refreshing;
  try {await stop(tree, Date.now() + 30000); if (!await gone(tree, Date.now() + 10000)) cleanupError = true;}
  catch {cleanupError = true;}
  return {exitCode, timedOut, ownedProcessesStopped: !cleanupError, ownershipInspectionFailed};
}
