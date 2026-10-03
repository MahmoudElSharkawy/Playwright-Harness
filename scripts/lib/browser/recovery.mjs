import {readFile, realpath, lstat, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {within} from '../skill-roots.mjs';
import {processCall, stopTree, treeGone} from './processes.mjs';
import {nativeCliInstallation} from './native-cli.mjs';

/** Recover only this run's recorded session and process identities; never global native data. */
export async function recoverOwnedRun(packageRoot, projectRoot, runRoot) {
  const failures = []; let protectedRoot, protectedFound = false;
  try {
    const project = await realpath(projectRoot), installed = await realpath(packageRoot), actual = await realpath(runRoot);
    if (!within(project, actual) || within(installed, actual) || (await lstat(runRoot)).isSymbolicLink()) throw new Error();
    protectedRoot = join(actual, 'protected');
    try {await lstat(protectedRoot);} catch (error) {if (error.code === 'ENOENT') return {complete: true, failures}; throw error;}
    protectedFound = true;
    if ((await lstat(protectedRoot)).isSymbolicLink() || await realpath(protectedRoot) !== protectedRoot) throw new Error();
    const file = join(protectedRoot, 'native-ownership.json'); if ((await lstat(file)).size > 1024 * 1024 || (await lstat(file)).isSymbolicLink()) throw new Error();
    const record = JSON.parse(await readFile(file, 'utf8'));
    if (record.version !== 1 || !/^harness_[a-f0-9]{32}$/.test(record.session) || !['prepared', 'opening', 'opened'].includes(record.stage) || !Array.isArray(record.trees)) throw new Error();
    for (const tree of record.trees) if (!Array.isArray(tree) || !tree.length || tree.some(item => !Number.isSafeInteger(item.pid) || item.pid < 1 || typeof item.identity !== 'string' || !/^\d+$/.test(item.identity))) throw new Error();
    const deadline = Date.now() + 30000;
    {
      const {executable} = nativeCliInstallation(packageRoot);
      const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|PLAYWRIGHT_BROWSERS_PATH)$/i.test(name)));
      const close = await processCall(process.execPath, [executable, '--json', `-s=${record.session}`, 'close'], {cwd: protectedRoot, env: environment, timeoutMs: 10000});
      if (close.kind || close.exitCode !== 0) throw new Error();
      const response = JSON.parse(close.stdout); if (response.session !== record.session || !['closed', 'not-open'].includes(response.status)) throw new Error();
      if (record.stage !== 'prepared' && !record.trees.length && response.status !== 'closed') return {complete: false, failures: ['OPEN_EFFECT_UNCERTAIN']};
      for (const tree of record.trees) {if (!await treeGone(tree, deadline)) await stopTree(tree, deadline); if (!await treeGone(tree, deadline)) failures.push('PROCESS_SURVIVED');}
      const cleared = await processCall(process.execPath, [executable, '--json', `-s=${record.session}`, 'delete-data'], {cwd: protectedRoot, env: environment, timeoutMs: Math.max(1, deadline - Date.now())});
      if (cleared.exitCode !== 0 || cleared.kind) failures.push('NATIVE_DATA');
      const listed = await processCall(process.execPath, [executable, '--json', `-s=${record.session}`, 'list'], {cwd: protectedRoot, env: environment, timeoutMs: Math.max(1, deadline - Date.now())});
      if (listed.kind || listed.exitCode !== 0 || !Array.isArray(JSON.parse(listed.stdout).browsers) || JSON.parse(listed.stdout).browsers.some(item => item.name === record.session)) failures.push('NATIVE_SESSION');
    }
    if (!failures.length) {if (await realpath(protectedRoot) !== protectedRoot || !within(actual, protectedRoot)) throw new Error(); await rm(protectedRoot, {recursive: true});}
  } catch (error) {if (error.code !== 'ENOENT' || protectedFound) failures.push('OWNERSHIP_RECOVERY');}
  return {complete: !failures.length, failures};
}
