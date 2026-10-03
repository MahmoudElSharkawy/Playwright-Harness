import {mkdirSync, readFileSync, writeFileSync, renameSync, lstatSync, existsSync, readdirSync, unlinkSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {consumerRoots, consumerPath} from '../consumer-paths.mjs';
import {data, fingerprint, id, requireThat} from '../execution-core/data.mjs';
import {protect} from '../generation/storage.mjs';

export const EXECUTION_VERSION = 1;
const commitPause = new Int32Array(new SharedArrayBuffer(4));
function commit(temporary, file) {
  for (let attempt = 0; ; attempt++) {
    try {renameSync(temporary, file); return;}
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 7) throw error;
      // Retry the same local atomic commit after a short reader/sharing window.
      // This never repeats a browser, API, database or ADO operation.
      Atomics.wait(commitPause, 0, 0, 10 * (attempt + 1));
    }
  }
}
export function executionDirectory(roots, executionId) {
  id(executionId); return consumerPath(consumerRoots(roots.projectRoot, roots.packageRoot), `.harness/runs/${executionId}`);
}
export function ownedFile(roots, executionId, path) {
  id(executionId);
  requireThat(typeof path === 'string' && path.length && !/[\\:\r\n\0]/.test(path) && path.split('/').every(part => part && !['.', '..'].includes(part)), 'Invalid execution file.');
  return consumerPath(consumerRoots(roots.projectRoot, roots.packageRoot), `.harness/runs/${executionId}/${path}`);
}
export function readBounded(file, maximum = 2 * 1024 * 1024) {
  const stat = lstatSync(file); requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum, 'Execution input is missing, linked or too large.');
  return JSON.parse(readFileSync(file, 'utf8'));
}
/** Atomic owner-only records; a caller selects exclusive creation for immutable receipts. */
export function writeJson(file, value, {exclusive = false, maximum = 2 * 1024 * 1024} = {}) {
  const body = JSON.stringify(data(value, maximum), null, 2) + '\n';
  mkdirSync(dirname(file), {recursive: true, mode: 0o700});
  if (exclusive) {writeFileSync(file, body, {flag: 'wx', mode: 0o600, flush: true}); return;}
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {writeFileSync(temporary, body, {flag: 'wx', mode: 0o600, flush: true}); commit(temporary, file);}
  finally {if (existsSync(temporary)) unlinkSync(temporary);}
}
export function createExecution(roots, source, refinement, options = {}) {
  const executionId = options.id ?? `execute-${randomUUID()}`, directory = executionDirectory(roots, executionId);
  mkdirSync(dirname(directory), {recursive: true, mode: 0o700});
  mkdirSync(directory, {mode: 0o700, recursive: false}); protect(directory);
  writeJson(join(directory, 'source.json'), source, {exclusive: true});
  writeJson(join(directory, 'refinement.json'), refinement, {exclusive: true});
  writeJson(join(directory, 'execution.json'), {version: 1, id: executionId, createdAt: Date.now(), sourceFingerprint: fingerprint(source), runs: [], checkpoint: Boolean(options.checkpoint), diagnostics: options.diagnostics ?? 'end'}, {exclusive: true});
  return {executionId, directory, scenarios: source.scenarios.length, exclusions: source.excluded};
}
export function readExecution(roots, executionId) {
  const directory = executionDirectory(roots, executionId), execution = readBounded(join(directory, 'execution.json'));
  requireThat(execution.version === 1 && execution.id === executionId, 'Wrong execution identity.');
  const source = readBounded(join(directory, 'source.json'));
  requireThat(fingerprint(source) === execution.sourceFingerprint, 'Captured source changed.');
  return {directory, execution, source};
}
export function readFrozen(roots, executionId) {
  const loaded = readExecution(roots, executionId), freeze = readBounded(join(loaded.directory, 'freeze.json'));
  const refinement = readBounded(join(loaded.directory, 'refinement.json'));
  requireThat(loaded.execution.freezeFingerprint === fingerprint(freeze), 'Frozen execution receipt changed.');
  requireThat(freeze.version === 1 && freeze.sourceFingerprint === loaded.execution.sourceFingerprint && freeze.refinementFingerprint === fingerprint(refinement), 'Frozen refinement or source changed.');
  requireThat(freeze.environmentFingerprint === fingerprint(freeze.environment), 'Frozen environment changed.');
  return {...loaded, freeze, refinement};
}
export function saveExecution(roots, executionId, execution) {writeJson(ownedFile(roots, executionId, 'execution.json'), execution);}
export function listRunRecords(roots, executionId) {
  const path = ownedFile(roots, executionId, 'snapshots');
  if (!existsSync(path)) return [];
  return readdirSync(path).filter(name => /^[A-Za-z0-9_-]+\.json$/.test(name)).map(name => readBounded(join(path, name)));
}
