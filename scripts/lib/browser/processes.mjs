import {spawn} from 'node:child_process';
import {readFile, readdir} from 'node:fs/promises';

export async function processCall(executable, args, {cwd, env, timeoutMs = 30000, signal, maxBytes = 2 * 1024 * 1024} = {}) {
  if (signal?.aborted || timeoutMs <= 0) return {stdout: '', stderr: '', exitCode: null, kind: signal?.aborted ? 'CANCELLED' : 'TIMEOUT', dispatched: false};
  return await new Promise(resolve => {
    let stdout = '', stderr = '', bytes = 0, dispatched = false, kind;
    const child = spawn(executable, args, {cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    const stop = reason => {kind ??= reason; child.kill();};
    const abort = () => stop('CANCELLED'), timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
    signal?.addEventListener('abort', abort, {once: true});
    child.once('spawn', () => {dispatched = true; if (signal?.aborted) abort();});
    for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.on('data', chunk => {
      bytes += chunk.length; if (bytes > maxBytes) {stop('OUTPUT_LIMIT'); return;}
      if (name === 'stdout') stdout += chunk; else stderr += chunk;
    });
    child.once('error', () => {kind ??= 'SPAWN_FAILURE';});
    child.once('close', exitCode => {clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve({stdout, stderr, exitCode, kind, dispatched});});
  });
}

export async function processInventory(deadlineAt = Infinity) {
  if (Date.now() >= deadlineAt) throw new Error('Owned process inspection deadline exceeded.');
  if (process.platform === 'win32') {
    const reply = await processCall('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,@{Name="Identity";Expression={$_.CreationDate.ToFileTimeUtc().ToString()}} | ConvertTo-Json -Compress'], {timeoutMs: Math.min(10000, deadlineAt - Date.now())});
    if (reply.exitCode !== 0) throw new Error('Owned process inspection failed.');
    return JSON.parse(reply.stdout).map(item => ({pid: item.ProcessId, parent: item.ParentProcessId, identity: item.Identity}));
  }
  if (process.platform !== 'linux') throw new Error('Browser ownership is supported on Windows and Linux only.');
  const result = [];
  for (const name of await readdir('/proc')) if (/^\d+$/.test(name)) {
    try {
      const stat = await readFile(`/proc/${name}/stat`, 'utf8'), fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (fields[0] !== 'Z') result.push({pid: Number(name), parent: Number(fields[1]), identity: fields[19]});
    } catch (error) {if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;}
  }
  return result;
}

const alive = (all, process) => all.some(item => item.pid === process.pid && item.identity === process.identity);
// A child cannot predate its parent. Windows keeps a dead parent's PID on its children
// and reuses PIDs, so an older process naming a member's PID belongs to an earlier holder.
const created = item => /^\d+$/.test(item.identity) ? BigInt(item.identity) : undefined;
const childOf = (item, parent) => item.parent === parent.pid && created(item) !== undefined && created(parent) !== undefined && created(item) >= created(parent);
export function expandTree(all, tree) {
  for (let index = 0; index < tree.length; index++) tree.push(...all.filter(item => childOf(item, tree[index]) && !tree.some(known => known.pid === item.pid)));
  return tree;
}
export async function rememberTree(pid) {
  const all = await processInventory(), tree = all.filter(item => item.pid === pid);
  if (!Number.isSafeInteger(pid) || tree.length !== 1) throw new Error('Owned daemon identity unavailable.');
  return expandTree(all, tree);
}
export async function refreshTree(tree, deadlineAt) {
  const all = await processInventory(deadlineAt), active = expandTree(all, tree.filter(item => alive(all, item)));
  for (const item of active) if (!tree.some(known => known.pid === item.pid && known.identity === item.identity)) tree.push(item);
}
export async function stopTree(tree, deadlineAt) {
  await refreshTree(tree, deadlineAt);
  // Check creation identity again immediately before every kill; never kill by name.
  for (const item of [...tree].reverse()) if (alive(await processInventory(deadlineAt), item)) {
    try {process.kill(item.pid, 'SIGKILL');} catch (error) {if (error.code !== 'ESRCH') throw error;}
  }
}
export async function treeGone(tree, deadlineAt) {const all = await processInventory(deadlineAt); return !tree.some(item => alive(all, item));}
