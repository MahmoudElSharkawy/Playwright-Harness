import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {defineOperation, createRun} from '../execution-core/index.mjs';
import {data, fingerprint, id, keys, requireThat, PHASES} from '../execution-core/data.mjs';
import {defineApiOperation} from '../api/definition.mjs';
import {defineDatabaseOperation} from '../database/definition.mjs';
import {browserLifecycleOperations} from '../browser/index.mjs';
import {loadEnvironment} from '../project-config.mjs';
import {consumerEnvironment} from '../consumer-env.mjs';
import {consumerPath} from '../consumer-paths.mjs';
import {readExecution, readBounded, writeJson, saveExecution} from './storage.mjs';

export const normalize = value => String(value).replace(/\s+/g, ' ').trim().toLowerCase();
const phases = Object.fromEntries(PHASES.map((phase, index) => [phase, Math.min(index, 3)]));
export const conditionId = (key, index) => `condition-${fingerprint([key, index]).slice(0, 24)}`;
export function subjectDetails(subject) {
  if (subject === 'page') return {kind: 'page'};
  keys(subject, ['region', 'element'], 'condition subject');
  requireThat(Object.keys(subject).length === 1, 'Choose one condition subject.');
  const kind = subject.region ? 'region' : 'element', value = subject[kind];
  keys(value, kind === 'element' ? ['role', 'name'] : ['name'], 'condition subject');
  requireThat(typeof value.name === 'string' && value.name.trim(), 'Subject needs a name.');
  if (value.role !== undefined) requireThat(typeof value.role === 'string' && /^[a-z]+$/.test(value.role), 'Invalid subject role.');
  return {kind, ...value};
}
export function draftRefinement(source, environment) {
  const target = environment.browserTargets?.[0], family = target ? 'browser' : environment.apiTargets[0] ? 'api' : 'database';
  return {version: 1, environment: environment.name, references: {}, scenarios: source.scenarios.map(scenario => ({id: scenario.id, steps: scenario.steps.filter(step => !step.empty || scenario.expectations.some(expected => expected.step === step.position)).map(step => ({
    id: `s${String(step.position).padStart(3, '0')}`, phase: 'EXERCISE', family, target: target ?? environment.apiTargets[0] ?? environment.databaseTargets[0], capability: 'mutations', sourceSteps: [step.position], inputs: [],
    expectations: scenario.expectations.filter(expected => expected.step === step.position).map(expected => ({key: expected.key, conditions: [{text: expected.description, predicate: 'observational', subject: 'page', expected: null, precondition: false, exact: false, ambiguous: false}]}))
  }))}))};
}
function references(roots, input) {
  const values = {};
  for (const [name, reference] of Object.entries(input ?? {})) {
    id(name); keys(reference, ['file', 'path', 'env'], 'reference data');
    requireThat(Boolean(reference.file) !== Boolean(reference.env), 'Reference needs one file or environment name.');
    let value, approved = false;
    if (reference.env) {
      requireThat(/^[A-Z][A-Z0-9_]*$/.test(reference.env) && !/PASSWORD|SECRET|TOKEN|CREDENTIAL|KEY|AUTH/i.test(reference.env), 'Use a non-secret reference variable.');
      value = process.env[reference.env]; approved = value !== undefined;
    } else {
      const file = consumerPath(roots, reference.file), git = args => spawnSync('git', ['-c', `safe.directory=${roots.projectRoot}`, ...args], {cwd: roots.projectRoot, encoding: 'utf8', windowsHide: true});
      if (existsSync(file)) {
        value = readBounded(file); for (const part of reference.path ?? []) value = value?.[part];
        approved = git(['ls-files', '--error-unmatch', '--', reference.file]).status === 0 && git(['status', '--porcelain', '--', reference.file]).stdout.trim() === '';
      }
    }
    values[name] = value === undefined ? {assumed: true} : {value: data(value), assumed: !approved};
  }
  return values;
}
/** Resolve only frozen expected sources; actual reads never become an implicit oracle. */
export function expectedValue(condition, scenario, references = {}, outputs = new Map()) {
  const expected = condition.expected;
  if (expected === null || expected === undefined) return {value: null, source: 'none'};
  keys(expected, ['source', 'value'], 'expected value');
  requireThat(typeof expected.source === 'string', 'Expected source is required.');
  const [kind, ...tail] = expected.source.split(':'), name = tail.join(':');
  if (kind === 'source-text') {requireThat(Object.hasOwn(expected, 'value') && normalize(condition.text).includes(normalize(expected.value)), 'Expected value must occur in its source condition.'); return {value: expected.value, source: expected.source};}
  if (kind === 'parameter') {requireThat(Object.hasOwn(scenario.bindings, name) && !scenario.needsBinding.includes(name), 'Expected parameter is unavailable.'); return {value: scenario.bindings[name], source: expected.source};}
  if (kind === 'reference') {requireThat(Object.hasOwn(references, name), 'Unknown reference value.'); return {value: references[name].value ?? null, source: expected.source, assumed: references[name].assumed};}
  if (kind === 'output') {id(name); const output = outputs.get(name); return {value: output?.value ?? null, source: expected.source, ...(output ? {producer: output.producer, subject: output.subject, family: output.family} : {missing: true})};}
  throw new Error('Unknown expected-value source.');
}
function validateCondition(condition, original, scenario, referenceValues) {
  keys(condition, ['text', 'predicate', 'subject', 'expected', 'precondition', 'exact', 'ambiguous'], 'condition');
  requireThat(typeof condition.text === 'string' && condition.text.trim() && typeof condition.predicate === 'string', 'Condition text and predicate are required.');
  requireThat(['present', 'absent', 'equals', 'url', 'count', 'observational'].includes(condition.predicate) || /^state:(enabled|disabled|checked|unchecked|visible|hidden)$/.test(condition.predicate), 'Unsupported condition predicate.');
  const subject = subjectDetails(condition.subject);
  requireThat(subject.kind === 'page' || normalize(condition.text).includes(normalize(subject.name)), 'Subject name must occur in its source condition.');
  for (const flag of ['precondition', 'exact', 'ambiguous']) requireThat(typeof condition[flag] === 'boolean', 'Condition flags must be explicit booleans.');
  if (condition.predicate === 'observational' || condition.predicate.startsWith('state:')) requireThat(condition.expected === null, 'State and observational predicates do not use an expected value.');
  else requireThat(condition.expected !== null, 'Deterministic predicate needs a traceable expected value.');
  const resolved = expectedValue(condition, scenario, referenceValues);
  if (resolved.assumed || resolved.missing && !condition.expected.source.startsWith('output:')) condition.ambiguous = true;
  return resolved;
}
function operationFor(step, contracts, scenario, referenceValues) {
  const source = {kind: 'inline', reference: 'execute-refinement', version: '1.0.0'};
  if (step.family === 'browser') return defineOperation({id: step.id, family: 'browser', target: step.target, capability: step.capability === 'reads' ? 'browserReads' : 'browserMutations', source,
    definition: {intent: scenario.steps.filter(item => step.sourceSteps.includes(item.position)).map(item => item.action).join('\n'), ...(step.readOnlyContract ? {readOnlyContract: step.readOnlyContract} : {})}});
  requireThat(step.operation && Array.isArray(step.checkProvenance), 'API/DB step needs an operation and per-condition checkProvenance.');
  const definition = step.operation.definition ?? step.operation, copied = data(definition), checks = copied.checks;
  requireThat(Array.isArray(checks) && step.checkProvenance.length === checks.length && checks.length === contracts.length, 'Map each API/DB condition to exactly one runtime check.');
  const seen = new Set();
  for (const check of checks) {
    const mapping = step.checkProvenance.find(item => item.check === check.id);
    requireThat(mapping, 'Runtime check has no source condition.'); keys(mapping, ['check', 'key', 'condition'], 'check provenance');
    const contract = contracts.find(item => item.key === mapping.key && item.index === mapping.condition);
    requireThat(contract && !seen.has(contract.id) && (contract.synthetic || contract.condition.predicate !== 'observational'), 'API/DB checks need unique deterministic source conditions.');
    const resolved = expectedValue(contract.condition, scenario, referenceValues);
    const wanted = contract.condition.predicate.startsWith('state:') ? ['enabled', 'checked', 'visible'].includes(contract.condition.predicate.slice(6)) : resolved.value;
    const parameter = contract.condition.expected?.source.startsWith('parameter:') ? contract.condition.expected.source.slice(10) : undefined;
    const boundName = source => step.inputs?.find(binding => binding.source === source)?.name;
    requireThat(contract.synthetic || fingerprint(check.equals) === fingerprint(wanted) || parameter && check.equals?.$input === boundName(`parameter:${parameter}`) || contract.condition.expected?.source.startsWith('output:') && check.equals?.$input === boundName(contract.condition.expected.source), 'API/DB check expected value differs from its frozen condition.');
    seen.add(contract.id); check.id = contract.id;
  }
  delete copied.id; delete copied.target; delete copied.source; delete copied.family; delete copied.capability; delete copied.fingerprint;
  return (step.family === 'api' ? defineApiOperation : defineDatabaseOperation)({id: step.id, target: step.target, source, ...copied});
}
/** Freeze once, including independent per-condition core keys for API/DB runtimes. */
export function freezeExecution(roots, executionId) {
  const loaded = readExecution(roots, executionId), refinement = data(readBounded(join(loaded.directory, 'refinement.json')), 2 * 1024 * 1024);
  keys(refinement, ['version', 'environment', 'references', 'scenarios', 'limits'], 'execution refinement');
  requireThat(refinement.version === 1 && refinement.scenarios?.length === loaded.source.scenarios.length, 'Refinement must cover every scenario.');
  const refinementFingerprint = fingerprint(refinement);
  const environment = loadEnvironment(roots, refinement.environment), referenceValues = references(roots, refinement.references), scenarios = [];
  for (const source of loaded.source.scenarios) {
    const refined = refinement.scenarios.find(item => item.id === source.id); requireThat(refined, 'Missing refined scenario.'); keys(refined, ['id', 'steps'], 'refined scenario');
    requireThat(Array.isArray(refined.steps) && refined.steps.length > 0 && refined.steps.length <= 1000, 'Refined steps must be bounded and nonempty.');
    const covered = new Set(), bound = new Set(), steps = [], expectations = [], ids = new Set(); let previous = -1;
    for (const step of refined.steps) {
      keys(step, ['id', 'phase', 'family', 'target', 'capability', 'sourceSteps', 'expectations', 'inputs', 'readOnlyContract', 'login', 'operation', 'checkProvenance', 'creates', 'cleanupResource', 'optional'], 'refined step');
      id(step.id); requireThat(!ids.has(step.id), 'Duplicate step id.'); ids.add(step.id);
      requireThat(Object.hasOwn(phases, step.phase) && phases[step.phase] >= previous, 'Refinement phases must be monotonic.'); previous = phases[step.phase];
      requireThat(['browser', 'api', 'database'].includes(step.family) && ['reads', 'mutations'].includes(step.capability), 'Invalid step family or capability.');
      requireThat(Array.isArray(step.sourceSteps) && step.sourceSteps.every(position => source.steps.some(item => item.position === position)), 'Step has unknown source positions.');
      step.sourceSteps.forEach(position => covered.add(position));
      if (step.capability === 'reads') {keys(step.readOnlyContract, ['reason'], 'read-only contract'); requireThat(typeof step.readOnlyContract.reason === 'string' && step.readOnlyContract.reason.trim(), 'Reads need an explicit contract.');}
      requireThat(Array.isArray(step.expectations) && Array.isArray(step.inputs ?? []), 'Step needs expectation and input arrays.');
      requireThat(step.optional === undefined || typeof step.optional === 'boolean', 'Optional must be a boolean.');
      requireThat(Array.isArray(step.creates ?? []), 'Created resources must be an array.');
      for (const binding of step.inputs ?? []) {
        keys(binding, ['name', 'source'], 'step input'); id(binding.name);
        requireThat(typeof binding.source === 'string' && /^(parameter|reference|output|env):.+$/.test(binding.source), 'Input needs a parameter, reference, output or protected environment source.');
        if (binding.source.startsWith('env:')) requireThat(/^[A-Z][A-Z0-9_]{0,79}$/.test(binding.source.slice(4)), 'Invalid protected environment reference.');
        if (binding.source.startsWith('parameter:')) requireThat(Object.hasOwn(source.bindings, binding.source.slice(10)) && !source.needsBinding.includes(binding.source.slice(10)), 'Input parameter needs a protected environment binding.');
        if (binding.source.startsWith('reference:')) requireThat(referenceValues[binding.source.slice(10)] && !referenceValues[binding.source.slice(10)].assumed, 'Input reference is unavailable or assumed.');
        if (binding.source.startsWith('output:')) id(binding.source.slice(7));
      }
      requireThat(new Set((step.inputs ?? []).map(binding => binding.name)).size === (step.inputs ?? []).length, 'Duplicate step input names.');
      const contracts = [];
      for (const expectation of step.expectations) {
        keys(expectation, ['key', 'conditions'], 'bound expectation');
        const original = source.expectations.find(item => item.key === expectation.key);
        requireThat(original && !bound.has(expectation.key) && Math.max(...step.sourceSteps, 0) >= original.step, 'Bind each source expectation once, at or after its source step.'); bound.add(expectation.key);
        requireThat(Array.isArray(expectation.conditions) && expectation.conditions.length > 0 && expectation.conditions.length <= 30 && normalize(expectation.conditions.map(condition => condition.text).join(' ')) === normalize(original.description), 'Conditions must preserve source text.');
        expectation.conditions.forEach((condition, index) => {
          validateCondition(condition, original, source, referenceValues);
          const contract = {id: conditionId(expectation.key, index + 1), key: expectation.key, index: index + 1, condition, synthetic: original.synthetic}; contracts.push(contract);
          expectations.push({id: contract.id, description: condition.text, operationId: step.id, invocationId: step.id, phase: step.phase, requiredEvidence: original.synthetic ? ['assertion'] : step.family === 'browser' ? ['assertion', 'snapshot'] : ['response', 'assertion']});
        });
      }
      const operation = operationFor(step, contracts, source, referenceValues), verificationOnly = step.sourceSteps.every(position => !source.steps[position - 1].action);
      requireThat((['apiReads', 'dbSelect', 'browserReads'].includes(operation.capability) ? 'reads' : 'mutations') === step.capability, 'Operation capability differs from the refined step.');
      if (step.login) {keys(step.login, ['user', 'landmark'], 'login'); id(step.login.user); requireThat(step.family === 'browser' && environment.targets.browser?.[step.target]?.users?.[step.login.user], 'Login user is not configured.'); requireThat(step.login.landmark === undefined || typeof step.login.landmark === 'string' && step.login.landmark.trim(), 'Login landmark must be nonempty text.');}
      for (const declaration of step.creates ?? []) {keys(declaration, ['resource', 'identityOutput', 'intent', 'cleanupStep'], 'created resource'); id(declaration.resource); id(declaration.identityOutput); requireThat(['temporary', 'persistent', 'no-obligation'].includes(declaration.intent), 'Unsupported resource intent.');
        if (declaration.intent === 'temporary') requireThat(refined.steps.some(item => item.id === declaration.cleanupStep && item.phase === 'CLEANUP' && item.cleanupResource === declaration.resource && item.inputs?.some(binding => binding.source === `output:${declaration.identityOutput}`)), 'Temporary resource needs cleanup bound to its identity.');
        if (step.family !== 'browser') requireThat(operation.definition.extract?.some(item => item.name === declaration.identityOutput), 'Resource identity must be extracted.');
      }
      requireThat((step.creates ?? []).length <= 1, 'One creation per step; split multiple creations into separate steps.');
      steps.push({...step, contracts, operation, verificationOnly});
    }
    requireThat(source.steps.every(step => step.empty || covered.has(step.position)) && bound.size === source.expectations.length, 'Refinement must cover source steps and expectations.');
    const resources = steps.flatMap(step => step.creates ?? []);
    requireThat(new Set(resources.map(resource => resource.resource)).size === resources.length && new Set(resources.map(resource => resource.identityOutput)).size === resources.length, 'Created resources need unique identities.');
    for (const step of steps.filter(step => step.cleanupResource)) {id(step.cleanupResource); requireThat(step.phase === 'CLEANUP' && resources.some(resource => resource.resource === step.cleanupResource && resource.intent === 'temporary' && resource.cleanupStep === step.id), 'Cleanup must belong to its declared temporary resource.');}
    const targets = steps.filter(step => step.family === 'browser').map(step => step.target); requireThat(new Set(targets).size <= 1, 'A scenario uses one owned browser target.');
    const operations = steps.map(step => step.operation); if (targets.length) operations.push(...browserLifecycleOperations(targets[0]));
    const limits = {maxAttempts: 3, timeoutMs: 2 * 60 * 60 * 1000, cleanupTimeoutMs: steps.some(step => step.phase === 'CLEANUP') ? 20 * 60 * 1000 : 10 * 60 * 1000, maxValueBytes: 256 * 1024, ...refinement.limits};
    requireThat(limits.timeoutMs <= 8 * 60 * 60 * 1000, 'Execution timeout exceeds 8 hours.');
    createRun({id: 'freeze-validation', environment, operations, scenarios: [{id: source.id, expectations}], limits});
    scenarios.push({id: source.id, steps, operations, expectations, limits, ...(targets.length ? {browserTarget: targets[0]} : {})});
  }
  const freeze = {version: 1, sourceFingerprint: loaded.execution.sourceFingerprint, refinementFingerprint, environment, environmentFingerprint: fingerprint(environment), referenceValues, scenarios};
  writeJson(join(loaded.directory, 'freeze.json'), freeze, {exclusive: true});
  saveExecution(roots, executionId, {...loaded.execution, freezeFingerprint: fingerprint(freeze)});
  return {executionId, status: 'FROZEN', scenarios: scenarios.length};
}
export function scopedReadiness(roots, freeze, scenarioId) {
  const scenarios = scenarioId ? freeze.scenarios.filter(item => item.id === scenarioId) : freeze.scenarios, environment = consumerEnvironment(roots), missing = new Set();
  for (const scenario of scenarios) for (const step of scenario.steps) {
    const target = freeze.environment.targets[step.family === 'database' ? 'databases' : step.family][step.target];
    requireThat(target, 'Refinement target is not enabled.');
    const refs = [...(step.family === 'database' ? [target.connectionRef] : step.family === 'api' ? [target.credentialRef] : step.login ? Object.values(target.users[step.login.user]) : []), ...(step.inputs ?? []).filter(binding => binding.source.startsWith('env:')).map(binding => binding.source)];
    for (const ref of refs.filter(Boolean)) if (!environment[ref.slice(4)]) missing.add(ref.slice(4));
  }
  return {ready: !missing.size, missing: [...missing]};
}
