import {readdirSync, readFileSync, writeFileSync, mkdirSync, lstatSync, openSync, closeSync, unlinkSync, chmodSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join, relative} from 'node:path';
import {consumerRoots, consumerPath} from '../consumer-paths.mjs';
import {within} from '../skill-roots.mjs';
import {data, digest, fingerprint, id, requireThat} from '../execution-core/data.mjs';

export function rootsFor(roots) {return consumerRoots(roots.projectRoot, roots.packageRoot);}
export function location(roots, sourceId) {id(sourceId); return consumerPath(rootsFor(roots), `.harness/state/generation/${sourceId}`);}
export function relativeFile(roots, file) {
  requireThat(typeof file === 'string' && file.length && !/[\\\r\n\0]/.test(file) && !file.split('/').some(p => ['', '.', '..'].includes(p)) && !/^[A-Za-z]:/.test(file), 'Use a relative consumer file path.');
  return consumerPath(rootsFor(roots), file);
}

/** Freeze consumer behavior, data and dependency declarations, including additions/deletions.
 * Installed packages and generated output have separate ownership. Dependencies are represented
 * by lockfiles; reviewed external imports and environment references remain a review obligation.
 */
export function snapshot(roots) {
  roots = rootsFor(roots); const files = [], excluded = new Set(['.git', '.agents', '.claude', '.codex', '.validation', 'node_modules', 'test-results', 'playwright-report', 'blob-report', 'allure-results', 'allure-report', 'reports', 'ctrf', '.playwright-cli', 'executions']);
  let bytes = 0;
  function walk(directory, prefix = '') {
    for (const entry of readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = prefix + entry.name, path = join(directory, entry.name);
      if ((!prefix && excluded.has(entry.name)) || entry.name === 'node_modules' || entry.name === '.env' || entry.name.startsWith('.env.') || /\.(?:pem|key|pfx)$/i.test(entry.name) || within(roots.packageRoot, path)) continue;
      if (name === '.harness') {for (const folder of ['project.json', 'targets.json', 'knowledge']) {
        const child = join(path, folder); let stat; try {stat = lstatSync(child);} catch (error) {if (error.code === 'ENOENT') continue; throw error;}
        requireThat(!stat.isSymbolicLink(), 'Frozen inputs cannot be linked.');
        if (stat.isDirectory()) walk(child, `.harness/${folder}/`); else add(`.harness/${folder}`, child);
      } continue;}
      requireThat(!entry.isSymbolicLink(), 'Consumer behavior contains a link; use immutable installed dependencies or ordinary files.');
      if (entry.isDirectory()) walk(path, name + '/'); else if (entry.isFile()) add(name, path);
    }
  }
  function add(name, path) {
    const stat = lstatSync(path); bytes += stat.size;
    requireThat(files.length < 10000 && stat.size <= 16 * 1024 * 1024 && bytes <= 64 * 1024 * 1024, 'Generation snapshot exceeds bounds.');
    relativeFile(roots, name); files.push({path: name, sha256: digest(readFileSync(path))});
  }
  walk(roots.projectRoot); requireThat(files.length > 0, 'Empty generation snapshot.');
  const implementation = [];
  const library = directory => {for (const entry of readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name); if (entry.isDirectory()) library(path); else implementation.push([relative(roots.packageRoot, path).replaceAll('\\', '/'), digest(readFileSync(path))]);
  }};
  library(join(roots.packageRoot, 'scripts/lib'));
  for (const name of ['VERSION', 'npm-shrinkwrap.json']) implementation.push([name, digest(readFileSync(join(roots.packageRoot, name)))]);
  const runtimeFingerprint = fingerprint(implementation);
  return {files, runtimeFingerprint, fingerprint: fingerprint({files, runtimeFingerprint, node: process.version})};
}

const protectedDirectories = new Set();
export function protect(directory) {
  if (protectedDirectories.has(directory)) return;
  if (process.platform === 'win32') {
    const owner = execFileSync('whoami', [], {encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000}).trim();
    execFileSync('icacls', [directory, '/inheritance:r', '/grant:r', `${owner}:(OI)(CI)F`], {windowsHide: true, stdio: 'pipe', timeout: 10000});
  } else chmodSync(directory, 0o700);
  protectedDirectories.add(directory);
}

/** Append-only snapshots with a hash chain and an exclusive writer. No crash lock takeover. */
export async function transaction(roots, sourceId, action) {
  const directory = location(roots, sourceId); mkdirSync(directory, {recursive: true, mode: 0o700});
  protect(directory);
  const lock = join(directory, 'write.lock'), fd = openSync(lock, 'wx', 0o600);
  try {
    const entries = readdirSync(directory).filter(name => /^\d{6}\.json$/.test(name)).sort();
    requireThat(entries.length < 500, 'Generation history limit reached.');
    let state, previous = null;
    for (let index = 0; index < entries.length; index++) {
      requireThat(entries[index] === `${String(index + 1).padStart(6, '0')}.json`, 'Generation history has a gap.');
      const path = join(directory, entries[index]); requireThat(lstatSync(path).isFile() && lstatSync(path).size <= 2 * 1024 * 1024, 'Invalid generation history file.');
      const record = JSON.parse(readFileSync(path, 'utf8'));
      requireThat(record.previous === previous && record.sha256 === fingerprint(record.state), 'Generation history integrity mismatch.');
      state = record.state; previous = record.sha256;
    }
    const save = next => {
      const checked = data(next); const file = join(directory, `${String(entries.length + 1).padStart(6, '0')}.json`);
      writeFileSync(file, JSON.stringify({previous, sha256: fingerprint(checked), state: checked}, null, 2), {flag: 'wx', mode: 0o600, flush: true});
      entries.push(file); previous = fingerprint(checked);
    };
    return await action(state, save, directory);
  } finally {closeSync(fd); unlinkSync(lock);}
}

export function reviewArtifact(roots, file) {
  const path = relativeFile(roots, file), bytes = readFileSync(path);
  requireThat(bytes.length > 0 && bytes.length < 256 * 1024, 'Review evidence is missing or too large.');
  data({text: bytes.toString('utf8')});
  return {path: relative(roots.projectRoot, path).replaceAll('\\', '/'), sha256: digest(bytes)};
}
