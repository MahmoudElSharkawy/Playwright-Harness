import {lstatSync, realpathSync, openSync, closeSync, fstatSync, readSync, constants} from 'node:fs';
import {resolve} from 'node:path';
import {resolveSkillRoots, within} from '../skill-roots.mjs';
import {data, frozen, digest, requireThat, integer, id, keys, identity, oneOf, EVIDENCE_KINDS} from './data.mjs';
import {requireRun} from './inputs.mjs';

function evidenceFile(run, roots, path) {
  requireRun(run);
  requireThat(typeof path === 'string' && path.startsWith('evidence/') && !path.includes('\\') && !path.includes(':') && path.split('/').every(part => part.length > 0 && !['.', '..'].includes(part)), 'Evidence needs a relative path under evidence/.');
  const checkedRoots = resolveSkillRoots(roots), evidenceRoot = resolve(checkedRoots.runRoot, 'evidence'), lexical = resolve(checkedRoots.runRoot, path);
  requireThat(within(evidenceRoot, lexical), 'Evidence escapes its evidence directory.');
  let handle;
  try {
    const rootStat = lstatSync(evidenceRoot), actualRoot = realpathSync(evidenceRoot), actual = realpathSync(lexical);
    requireThat(rootStat.isDirectory() && !rootStat.isSymbolicLink() && within(evidenceRoot, actualRoot) && within(actualRoot, evidenceRoot), 'Evidence root must not redirect to other storage.');
    requireThat(within(actualRoot, actual) && !within(checkedRoots.packageRoot, actual) && !lstatSync(lexical).isSymbolicLink(), 'Evidence escapes its ownership boundary.');
    handle = openSync(actual, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(handle), maximum = run.inputs.limits.maxEvidenceBytes;
    requireThat(stat.isFile() && integer(stat.size, 1, maximum), 'Evidence must be a nonempty bounded file.');
    const bytes = Buffer.alloc(stat.size + 1); let size = 0, count;
    while (size < bytes.length && (count = readSync(handle, bytes, size, bytes.length - size, size)) > 0) size += count;
    requireThat(size === stat.size && fstatSync(handle).size === stat.size, 'Evidence changed while being read.');
    return {actual, bytes: size, sha256: digest(bytes.subarray(0, size))};
  } catch { throw new Error('Evidence is missing, unsafe, changed or outside its limit.'); }
  finally { if (handle !== undefined) closeSync(handle); }
}

function metadata(run, input, withIntegrity) {
  const record = data(input);
  keys(record, ['id', 'identity', 'kind', 'path', 'sanitized', ...(withIntegrity ? ['bytes', 'sha256'] : [])], 'evidence');
  id(record.id); identity(record.identity); oneOf(record.kind, EVIDENCE_KINDS);
  requireThat(record.identity.runId === run.id && run.inputs.scenarios.some(scenario => scenario.id === record.identity.scenarioId), 'Wrong evidence execution identity.');
  requireThat(record.sanitized === true, 'Only sanitized evidence can be registered.');
  if (withIntegrity) requireThat(integer(record.bytes, 1, run.inputs.limits.maxEvidenceBytes) && /^[a-f0-9]{64}$/.test(record.sha256), 'Invalid artifact integrity metadata.');
  return record;
}

/** Register an already-sanitized observation; authentication/before-state files are never evidence. */
export function registerEvidence(run, roots, input) {
  requireRun(run); const record = metadata(run, input, false), file = evidenceFile(run, roots, record.path);
  return frozen({...record, bytes: file.bytes, sha256: file.sha256});
}

/** Re-read every artifact at the verdict boundary; do not trust a stored hash without its file. */
export function verifyEvidence(run, roots, input) {
  requireRun(run); const record = metadata(run, input, true), file = evidenceFile(run, roots, record.path);
  requireThat(record.bytes === file.bytes && record.sha256 === file.sha256, 'Artifact integrity mismatch.');
  return {record: frozen(record), actual: file.actual};
}
