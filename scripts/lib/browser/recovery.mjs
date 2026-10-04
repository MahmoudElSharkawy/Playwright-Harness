import {readFile, realpath, lstat, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {within} from '../skill-roots.mjs';
import {processCall, stopTree, treeGone} from './processes.mjs';
import {nativeCliInstallation, nativeEnvironment} from './native-cli.mjs';

/** Recover only this run's recorded session and process identities; never global native data. */
export async function recoverOwnedRun(packageRoot, projectRoot, runRoot, {call = processCall, gone = treeGone, stop = stopTree, now = () => performance.now()} = {}) {
  const failures = []; let protectedRoot, protectedFound = false;
  try {
    const project = await realpath(projectRoot), installed = await realpath(packageRoot), actual = await realpath(runRoot);
    if (!within(project, actual) || within(installed, actual) || (await lstat(runRoot)).isSymbolicLink()) throw new Error();
    protectedRoot = join(actual, 'protected');
    try {await lstat(protectedRoot);} catch (error) {if (error.code === 'ENOENT') return {complete: true, failures}; throw error;}
    protectedFound = true;
    if ((await lstat(protectedRoot)).isSymbolicLink() || await realpath(protectedRoot) !== protectedRoot) throw new Error();
    const file = join(protectedRoot, 'native-ownership.json'), fileStat = await lstat(file); if (!fileStat.isFile() || fileStat.size > 1024 * 1024 || fileStat.isSymbolicLink()) throw new Error();
    const record = JSON.parse(await readFile(file, 'utf8'));
    if (record.version !== 1 || !/^harness_[a-f0-9]{32}$/.test(record.session) || !['prepared', 'opening', 'opened'].includes(record.stage) || !Array.isArray(record.trees)) throw new Error();
    for (const tree of record.trees) if (!Array.isArray(tree) || !tree.length || tree.some(item => !Number.isSafeInteger(item.pid) || item.pid < 1 || typeof item.identity !== 'string' || !/^\d+$/.test(item.identity))) throw new Error();
    const deadline = now() + 30000;
    const budget = maximum => Math.max(1, Math.min(maximum, deadline - now()));
    {
      const {executable} = nativeCliInstallation(packageRoot);
      const environment = nativeEnvironment();
      const native = (command, maximum) => call(process.execPath, [executable, '--json', `-s=${record.session}`, command], {cwd: protectedRoot, env: environment, timeoutMs: budget(maximum)});
      let closed = false, response;
      try {const close = await native('close', 10000); response = JSON.parse(close.stdout); closed = !close.kind && close.exitCode === 0 && response.session === record.session && ['closed', 'not-open'].includes(response.status);} catch {}
      const treeStart = now(), treeEnd = Math.min(deadline, treeStart + 10000);
      // All trees share each phase's deadline; a failed probe still leaves a stop and proof interval.
      const treeDeadline = offset => Date.now() + Math.max(1, Math.min(treeStart + offset, treeEnd) - now());
      const remainingTrees = [];
      for (const tree of record.trees) {let absent = false; try {absent = await gone(tree, treeDeadline(2000));} catch {} if (!absent) remainingTrees.push(tree);}
      for (const tree of remainingTrees) try {await stop(tree, treeDeadline(7000));} catch {}
      for (const tree of remainingTrees) {let absent = false; try {absent = await gone(tree, treeDeadline(10000));} catch {} if (!absent) failures.push('PROCESS_SURVIVED');}
      if (failures.length) return {complete: false, failures};
      if (record.stage !== 'prepared' && !record.trees.length && (!closed || response.status !== 'closed')) return {complete: false, failures: ['OPEN_EFFECT_UNCERTAIN']};
      // A failed close needs session-absence proof before deleting anything containing credentials.
      let verificationRemaining = 5000;
      if (!closed) {
        const started = now(), listed = await native('list', 2500); verificationRemaining -= now() - started;
        const browsers = JSON.parse(listed.stdout).browsers;
        if (listed.kind || listed.exitCode !== 0 || !Array.isArray(browsers) || browsers.some(item => item.name === record.session)) return {complete: false, failures: ['NATIVE_SESSION']};
      }
      const cleared = await native('delete-data', 5000);
      if (cleared.exitCode !== 0 || cleared.kind) failures.push('NATIVE_DATA');
      const listed = await native('list', verificationRemaining);
      if (listed.kind || listed.exitCode !== 0 || !Array.isArray(JSON.parse(listed.stdout).browsers) || JSON.parse(listed.stdout).browsers.some(item => item.name === record.session)) failures.push('NATIVE_SESSION');
    }
    if (!failures.length) {if (await realpath(protectedRoot) !== protectedRoot || !within(actual, protectedRoot)) throw new Error(); await rm(protectedRoot, {recursive: true});}
  } catch (error) {if (error.code !== 'ENOENT' || protectedFound) failures.push('OWNERSHIP_RECOVERY');}
  return {complete: !failures.length, failures};
}
