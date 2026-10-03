import {decodeEntities} from '../integrations/ado-steps.mjs';
import {sourceExpectations} from '../generation/handoff.mjs';
import {secretFindings} from '../package-validation.mjs';
import {data, fingerprint, requireThat} from '../execution-core/data.mjs';

const sensitive = name => /password|passwd|pwd|secret|token|credential|authorization|connectionstring|api.?key|cookie/i.test(name);
export function parameterNames(xml) {
  if (!xml || /^\s*<parameters\s*\/>\s*$/i.test(xml)) return [];
  requireThat(typeof xml === 'string' && /<parameters\b/.test(xml), 'parameters-without-data');
  const names = [...xml.matchAll(/<param\b[^>]*\bname=(?:"([^"]+)"|'([^']+)')[^>]*\/?\s*>/g)].map(match => decodeEntities(match[1] ?? match[2]));
  requireThat(names.length > 0 && new Set(names.map(name => name.toLowerCase())).size === names.length && names.every(name => /^[A-Za-z_][\w -]{0,79}$/.test(name)), 'parameters-without-data');
  return names;
}
/** ADO's bounded DataSet subset. Text values retain whitespace and empty cells. */
export function parseIterations(xml) {
  if (!xml || /^\s*<NewDataSet\s*\/>\s*$/i.test(xml) || /^\s*<NewDataSet>\s*<\/NewDataSet>\s*$/i.test(xml)) return [];
  requireThat(typeof xml === 'string' && xml.length <= 2 * 1024 * 1024 && !/<!DOCTYPE|<!ENTITY/i.test(xml), 'data-table-unparsable');
  const rows = [...xml.matchAll(/<Table1\b[^>]*>([\s\S]*?)<\/Table1>/g)];
  requireThat(rows.length > 0 && rows.length === (xml.match(/<Table1\b/g) ?? []).length, 'data-table-unparsable');
  return rows.map(row => {
    const value = {}, cells = [...row[1].matchAll(/<([\w.-]+)\b[^>]*?(?:\/\s*>|>([\s\S]*?)<\/\1\s*>)/g)];
    requireThat(cells.length > 0, 'data-table-unparsable');
    for (const cell of cells) {
      const name = cell[1].replace(/_x([\da-f]{4})_/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
      requireThat(!Object.hasOwn(value, name) && !['__proto__', 'constructor', 'prototype'].includes(name) && !/<[A-Za-z]/.test(cell[2] ?? ''), 'data-table-unparsable');
      value[name] = decodeEntities((cell[2] ?? '').replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1'));
    }
    return value;
  });
}
export function substitute(text, bindings) {
  const entries = Object.entries(bindings).sort((a, b) => b[0].length - a[0].length); if (!entries.length) return String(text);
  const values = new Map(entries.map(([name, value]) => [name.toLowerCase(), value])), names = entries.map(([name]) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return String(text).replace(new RegExp(`(?<![\\w@.])@(${names})(?!\\w)`, 'gi'), (_, name) => String(values.get(name.toLowerCase())));
}
/** Convert a tolerant read-only ADO snapshot without writing legacy fetch artifacts. */
export function prepareSource(fetched, scope) {
  const scenarios = [], excluded = [...(fetched.excluded ?? [])], cases = [], sharedSteps = {};
  for (const tc of fetched.cases) {
    try {
      requireThat(tc.steps?.length > 0 && tc.steps.length <= 1000, tc.steps?.length ? 'step-limit' : 'no-steps');
      requireThat(!tc.sharedParameterSet, 'shared-parameter-set');
      const names = [...parameterNames(tc.parameters)];
      for (const name of tc.sharedParameters ?? []) if (!names.some(existing => existing.toLowerCase() === name.toLowerCase())) names.push(name);
      const rows = parseIterations(tc.dataTableXml);
      requireThat(!names.length || rows.length > 0, 'parameters-without-data');
      requireThat(rows.length <= 100, 'iteration-limit');
      requireThat(!tc.steps.some(step => secretFindings('expected.json', step.expected ?? '').length), 'credential-in-expected');
      const template = tc.steps.map(step => ({action: step.action, expected: step.expected ? [step.expected] : [], ...(step.fromShared ? {fromShared: step.fromShared} : {})}));
      const generated = (rows.length ? rows : [{}]).map((row, index) => {
        const values = {}, needsBinding = [];
        for (const name of names) {
          const column = Object.keys(row).find(key => key.toLowerCase() === name.toLowerCase());
          requireThat(column !== undefined, 'parameters-without-data');
          if (sensitive(name) || secretFindings('parameter.json', JSON.stringify(row[column])).length) needsBinding.push(name); else values[name] = row[column];
        }
        for (const name of tc.sharedParameters ?? []) requireThat(Object.keys(row).some(key => key.toLowerCase() === name.toLowerCase()), 'shared-step-parameters-unbound');
        const bindings = values;
        const scenario = {id: `tc-${tc.id}-r${index + 1}`, caseId: tc.id, iteration: index + 1, title: tc.title, bindings, needsBinding,
          steps: template.map((step, stepIndex) => ({position: stepIndex + 1, action: substitute(step.action, bindings), expected: step.expected.map(text => substitute(text, bindings)),
            actionTemplate: step.action, expectedTemplates: step.expected, verificationOnly: !step.action && step.expected.length > 0, empty: !step.action && !step.expected.length,
            ...(step.fromShared ? {fromShared: step.fromShared} : {})}))};
        if (!scenario.steps.some(step => step.expected.length)) scenario.steps.at(-1).expected.push('Source expectations are missing; manual review is required.');
        const keys = sourceExpectations({scenarios: [scenario]});
        scenario.expectations = keys.map(key => ({...key, synthetic: !template.some(step => step.expected.length), template: template[key.step - 1].expected[key.expected - 1] ?? 'missing-expectation'}));
        return data(scenario, 2 * 1024 * 1024);
      });
      requireThat(scenarios.length + generated.length <= 500, 'iteration-limit');
      scenarios.push(...generated);
      cases.push({id: tc.id, rev: tc.rev, contentSha256: tc.contentSha256 ?? fingerprint({title: tc.title, steps: template, parameters: tc.parameters, data: tc.dataTableXml ?? null}), sharedIds: Object.keys(tc.sharedRevisions ?? {}).map(Number)});
      Object.assign(sharedSteps, tc.sharedRevisions ?? {});
    } catch (error) {
      const reasons = ['no-steps', 'step-limit', 'shared-parameter-set', 'parameters-without-data', 'iteration-limit', 'data-table-unparsable', 'shared-step-parameters-unbound', 'credential-in-expected'];
      excluded.push({id: tc.id, reason: reasons.includes(error.message) ? error.message : 'unparsable-steps'});
    }
  }
  requireThat(scenarios.length > 0, 'No executable cases; inspect source exclusions.');
  return data({version: 1, scope, organizationUrl: fetched.organizationUrl, project: fetched.project, title: fetched.suiteName ?? fetched.storyTitle,
    scenarios, cases, sharedSteps, excluded, ...(fetched.storyRev ? {scopeRev: fetched.storyRev} : {})}, 2 * 1024 * 1024);
}
/** Delivery-only freshness check. Shared-step changes flag every dependent case. */
export async function checkSourceRevisions(source, adoSource) {
  const ids = [...new Set([...source.cases.map(tc => tc.id), ...Object.keys(source.sharedSteps).map(Number)])];
  const current = await adoSource.revisions(ids), changes = [];
  for (const tc of source.cases) {
    const dependencies = tc.sharedIds.filter(id => current.get(id) !== source.sharedSteps[id]);
    if (current.get(tc.id) !== tc.rev || dependencies.length) changes.push({caseId: tc.id, executed: tc.rev, current: current.get(tc.id) ?? null, sharedSteps: dependencies.map(id => ({id, executed: source.sharedSteps[id], current: current.get(id) ?? null}))});
  }
  return changes;
}
