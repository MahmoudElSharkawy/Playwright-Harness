import {sourceExpectations} from '../../scripts/lib/generation/handoff.mjs';

/** Synthetic, read-only acceptance cases; no imported team library or external case system. */
export function generationCases() {
  const cases = [{id: 'ui', title: 'The page displays the expected observation', description: 'The heading says Observed fixture', expected: 'Observed fixture'}];
  for (const family of ['api', 'sqlserver', 'postgresql']) for (const kind of ['catalog', 'helper', 'inline']) {
    const operationSource = {kind, reference: 'synthetic-observation', version: '1.0.0'};
    const id = family + kind[0].toUpperCase() + kind.slice(1);
    const first = kind === 'inline' ? 'An inline' : `A ${kind}`;
    const description = family === 'api' ? 'The response status is 200 and its JSON observation value is 42' : 'One row returns the bound observation value 42';
    const operation = family === 'api' ? {id: 'observe', target: 'api', source: operationSource, request: {method: 'GET', path: '/observation'},
      checks: [{id: 'status', select: {from: 'status', path: []}, equals: 200}, {id: 'expected', select: {from: 'json', path: ['value']}, equals: 42}], effects: {readOnlyContract: 'synthetic-read'}}
      : {id: 'observe', target: family, source: operationSource, ...(family === 'postgresql' ? {engine: 'postgresql'} : {}),
        sql: family === 'postgresql' ? 'SELECT $1::integer AS "Observed"' : 'SELECT @value AS Observed',
        parameters: [family === 'postgresql' ? {name: 'value', input: 'value', type: 'integer'} : {name: 'value', input: 'value', type: 'int'}],
        checks: [{id: 'count', select: {from: 'rowCount', path: []}, equals: 1}, {id: 'expected', select: {from: 'rows', path: [0, 'Observed']}, equals: {$input: 'value'}}]};
    cases.push({id, title: family === 'api' ? `${first} request returns the expected observation` : `${first} ${family === 'sqlserver' ? 'SQL Server' : 'PostgreSQL'} query returns the bound observation`,
      description, expected: 'PASS', definition: {family: family === 'api' ? 'api' : 'database', operation,
        values: family === 'api' ? [] : [{name: 'value', type: 'number', sensitivity: 'public', value: 42}]}});
  }
  const source = {version: 1, id: 'observations', title: 'Observations', scenarios: cases.map(c => ({id: c.id, title: c.title, steps: [{action: c.title, expected: [c.description]}]}))};
  const keys = sourceExpectations(source);
  return {source, cases: cases.map(c => ({...c, key: keys.find(e => e.scenarioId === c.id).key})),
    testData: Object.fromEntries(cases.map(c => [c.id, c]))};
}
