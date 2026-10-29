import {requireAssessedResult} from '../execution-core/index.mjs';
import {requireValue} from './config.mjs';
import {externalIdentity} from './delivery.mjs';

export function automationEligible(rows, value) {
  requireValue(['Automated', 'Not Automated'].includes(value), 'Choose Automated or Not Automated.');
  return rows.filter(row => value !== 'Automated' || row.status === 'PASS' || row.status === 'FAIL' && row.classification === 'app-defect');
}

/** Legacy automated verification keeps its existing two-green gate for every provider. */
export function prepareLegacyRows(manifest, state, convertId = value => {requireValue(externalIdentity(value), 'Invalid external case identity.'); return value;}) {
  requireValue(Array.isArray(manifest.cases) && manifest.cases.length > 0 && state?.cases && typeof state.cases === 'object', 'Legacy publication needs a manifest and completed verification records.');
  const ids = manifest.cases.map(item => convertId(item.id));
  requireValue(new Set(ids).size === ids.length && Object.keys(state.cases).length === ids.length && Object.keys(state.cases).every(id => ids.includes(convertId(id))), 'Legacy verification scope does not match the manifest.');
  const statuses = {passed: 'PASS', failed: 'FAIL', fixme: 'FAIL', blocked: 'BLOCKED', skipped: 'SKIPPED', 'needs-review': 'NEEDS_REVIEW'};
  return ids.map(caseId => {
    const item = state.cases[caseId]; requireValue(item && Object.hasOwn(statuses, item.status), 'Incomplete or unknown legacy verification status.');
    if (item.status === 'passed') requireValue(Number.isInteger(item.greens) && item.greens >= 2, 'Legacy passed cases require two scoped green runs.');
    const classification = item.classification ?? 'unclassified';
    requireValue(['app-defect', 'script-defect', 'environment', 'unclassified'].includes(classification), 'Unknown legacy failure classification.');
    return {caseId, status: statuses[item.status], stability: 'stable', classification};
  });
}

/** Aggregate assessed iteration history once; native adapters only map the resulting statuses. */
export function prepareExecutionRows(results, scope, comments = {}) {
  results.forEach(requireAssessedResult);
  requireValue(Array.isArray(scope) && scope.length > 0 && scope.length <= 500 && new Set(scope.map(item => item.id)).size === scope.length && scope.every(item => externalIdentity(item.caseId)), 'Execution publication needs unique frozen iteration scope.');
  requireValue(results.every(result => result.scenarios.every(scenario => scope.some(item => item.id === scenario.id))), 'Assessed result is outside publication scope.');
  const cases = [...new Set(scope.map(item => item.caseId))], rows = [];
  for (const caseId of cases) {
    const iterations = scope.filter(item => item.caseId === caseId), relevant = results.flatMap(result => result.scenarios).filter(scenario => iterations.some(item => item.id === scenario.id));
    if (!relevant.length) continue;
    const statuses = iterations.map(item => {const history = relevant.filter(scenario => scenario.id === item.id); return history.some(scenario => scenario.status === 'FAIL') ? 'FAIL' : history.at(-1)?.status ?? 'BLOCKED';});
    const status = ['FAIL', 'NEEDS_REVIEW', 'BLOCKED'].find(value => statuses.includes(value)) ?? (statuses.every(value => value === 'SKIPPED') ? 'SKIPPED' : 'PASS');
    const comment = comments[caseId]; if (comment !== undefined) requireValue(typeof comment === 'string' && comment.length <= 400 && /^[\x20-\x7e]*$/.test(comment), 'Execution comments must be at most 400 ASCII characters.');
    rows.push({caseId, status, stability: relevant.some(item => item.stability === 'unstable') ? 'unstable' : 'stable', classification: 'manual-execution', ...(comment === undefined ? {} : {comment})});
  }
  return rows;
}
