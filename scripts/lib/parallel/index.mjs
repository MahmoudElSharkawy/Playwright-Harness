import {randomUUID} from 'node:crypto';
import {mkdirSync, openSync, closeSync, writeFileSync, readFileSync, unlinkSync, lstatSync, realpathSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {consumerRoots, consumerPath} from '../consumer-paths.mjs';
import {resolveSkillRoots} from '../skill-roots.mjs';
import {runSequentialScenario} from '../sequential/index.mjs';
import {prepareSequential} from '../sequential/preflight.mjs';
import {createScenarioState, initializeStorage, finishScenario} from '../sequential/state.mjs';
import {checkExecutionWindow, requireAssessedResult} from '../execution-core/index.mjs';
import {operationInput} from '../execution-core/inputs.mjs';
import {data, frozen, keys, id, integer, oneOf, requireThat} from '../execution-core/data.mjs';

const reads = new Set(['apiReads', 'dbSelect', 'browserReads']);
const mutates = operation => !reads.has(operationInput(operation).capability);

function prepareJobs(jobs, concurrency) {
  requireThat(Array.isArray(jobs) && jobs.length > 0 && jobs.length <= 500, 'Batch needs 1 to 500 scenarios.');
  const prepared = jobs.map(job => {
    keys(job, ['id', 'run', 'options', 'callbacks', 'resources'], 'batch job'); id(job.id);
    requireThat(job.options?.signal === undefined, 'Use the batch cancellation signal.');
    const {options, callbacks} = prepareSequential(job.run, job.options, job.callbacks);
    const resources = data(job.resources ?? []);
    requireThat(Array.isArray(resources) && resources.length <= 500, 'Resource access must be a bounded array.');
    for (const resource of resources) {keys(resource, ['key', 'access'], 'resource access'); id(resource.key); requireThat(resource.key === resource.key.toLowerCase(), 'Resource keys must be lowercase.'); oneOf(resource.access, ['read', 'write']);}
    requireThat(new Set(resources.map(resource => resource.key)).size === resources.length, 'Duplicate resource access.');
    if (concurrency > 1) {
      requireThat(resources.length > 0, 'Parallel scenarios require explicit shared-resource access.');
      requireThat(resources.some(resource => resource.access === 'write') || ![...job.run.inputs.operations, ...options.explorations].some(mutates), 'Mutations require declared write access.');
    }
    return Object.freeze({id: job.id, run: job.run, options, callbacks, resources: frozen(resources)});
  });
  requireThat(new Set(prepared.map(job => job.id.toLowerCase())).size === prepared.length, 'Duplicate batch job identities.');
  requireThat(new Set(prepared.map(job => job.run.id.toLowerCase())).size === prepared.length, 'Duplicate batch run identities.');
  requireThat(prepared.reduce((count, job) => count + job.resources.length, 0) <= 1000, 'Batch resource access exceeds its bound.');
  if (concurrency > 1) {
    const access = new Map();
    for (const job of prepared) for (const resource of job.resources) {
      const previous = access.get(resource.key);
      requireThat(!previous || previous === 'read' && resource.access === 'read', 'Parallel scenarios have conflicting shared-resource access.');
      access.set(resource.key, resource.access);
    }
  }
  return prepared;
}

// Runtime exploration can introduce a definition after preflight. Do not let a
// read-only declaration acquire write access then. This does not grant permission.
function guardCallbacks(job, concurrency) {
  if (concurrency === 1 || job.resources.some(resource => resource.access === 'write')) return job.callbacks;
  return Object.fromEntries(Object.entries(job.callbacks).map(([phase, callback]) => [phase, context => {
    const guard = call => (input, ...args) => {requireThat(!mutates(input.operation), 'Mutations require declared write access.'); return call(input, ...args);};
    return callback(Object.freeze({...context, api: Object.freeze({execute: guard(context.api.execute)}), database: Object.freeze({execute: guard(context.database.execute)}),
      ...(context.browser ? {browser: Object.freeze({attempt: guard(context.browser.attempt)})} : {})}));
  }]));
}

/** A bounded queue of whole sequential lifecycles, not a dependency scheduler.
 * Callbacks remain trusted automation code. Claims describe the complete business
 * footprint (including cleanup), not target permissions or inferred SQL/HTTP effects.
 */
export async function runScenarioBatch(inputRoots, inputJobs, options = {}) {
  keys(options, ['concurrency', 'signal'], 'batch options');
  const {concurrency = 1, signal} = options;
  requireThat(integer(concurrency, 1, 8), 'Concurrency must be an integer from 1 to 8.');
  requireThat(signal === undefined || signal instanceof AbortSignal, 'Cancellation needs an AbortSignal.');
  const jobs = prepareJobs(inputJobs, concurrency), roots = consumerRoots(inputRoots.projectRoot, inputRoots.packageRoot);
  const batchId = `batch-${randomUUID()}`, startedAt = Date.now();
  const stateDirectory = consumerPath(roots, '.harness/state/parallel');
  mkdirSync(stateDirectory, {recursive: true, mode: 0o700});
  const lockPath = consumerPath(roots, '.harness/state/parallel/active.lock');
  // Fail closed on an active or stale lock; never take over another batch.
  const lock = openSync(lockPath, 'wx', 0o600);
  try {writeFileSync(lock, batchId);} finally {closeSync(lock);}
  const batchRelative = `.harness/runs/${batchId}`, batchRoot = consumerPath(roots, batchRelative);
  const entries = new Array(jobs.length); let next = 0;
  function write(path, value) {
    requireThat(consumerPath(roots, batchRelative) === batchRoot && !lstatSync(batchRoot).isSymbolicLink() && realpathSync(batchRoot) === batchRoot, 'Batch storage ownership changed.');
    writeFileSync(join(batchRoot, path), JSON.stringify(data(value), null, 2), {flag: 'wx', mode: 0o600});
  }
  async function worker() {
    while (next < jobs.length) {
      const index = next++, job = jobs[index];
      const runRoots = resolveSkillRoots({...roots, runRoot: consumerPath(roots, `${batchRelative}/${job.run.id}`)});
      const entry = {id: job.id, run: job.run, roots: runRoots};
      try {
        const window = checkExecutionWindow(job.run, {phase: 'SETUP', signal});
        if (!window.allowed) {
          const state = createScenarioState(job.run, runRoots);
          state.scenario.disposition = 'blocked'; state.scenario.reason = window.reason;
          state.observations.operations.push(...job.options.explorations);
          initializeStorage(state); entry.result = finishScenario(state); entry.dispatch = 'NOT_STARTED';
        } else {
          entry.dispatch = 'EXECUTED';
          entry.result = requireAssessedResult(await runSequentialScenario(job.run, runRoots, {...job.options, signal}, guardCallbacks(job, concurrency)));
          requireThat(entry.result.runId === job.run.id && entry.result.inputFingerprint === job.run.inputFingerprint, 'Batch result association differs.');
        }
      } catch {
        // Never turn incomplete/partially executed history into a claimed verdict.
        // Keep any runtime evidence in place; do not serialize arbitrary exceptions.
        delete entry.result; entry.dispatch = 'ERROR'; entry.failureClass = 'INCOMPLETE_EXECUTION';
      }
      entries[index] = Object.freeze(entry);
    }
  }
  try {
    mkdirSync(dirname(batchRoot), {recursive: true, mode: 0o700});
    mkdirSync(batchRoot, {mode: 0o700});
    for (const job of jobs) write(`input-${job.id}.json`, job.run);
    const workers = await Promise.allSettled(Array.from({length: Math.min(concurrency, jobs.length)}, worker));
    requireThat(workers.every(worker => worker.status === 'fulfilled') && entries.filter(Boolean).length === jobs.length, 'Batch dispatch failed; inspect retained scenario evidence.');
    const completion = entries.some(entry => entry.dispatch === 'ERROR') ? 'INCOMPLETE' : 'COMPLETE';
    write('batch.json', {version: 1, id: batchId, concurrency, completion, startedAt, endedAt: Date.now(), entries: entries.map((entry, index) => ({
      id: entry.id, runId: entry.run.id, scenarioId: entry.run.inputs.scenarios[0].id, inputFingerprint: entry.run.inputFingerprint,
      resources: jobs[index].resources, inputPath: `input-${entry.id}.json`, runPath: entry.run.id, dispatch: entry.dispatch,
      ...(entry.result ? {status: entry.result.status, stability: entry.result.stability, resultPath: `${entry.run.id}/result.json`} : {failureClass: entry.failureClass})
    }))});
    return Object.freeze({version: 1, id: batchId, concurrency, completion, batchRoot, entries: Object.freeze(entries)});
  } finally {
    requireThat(consumerPath(roots, '.harness/state/parallel/active.lock') === lockPath && !lstatSync(lockPath).isSymbolicLink() && readFileSync(lockPath, 'utf8') === batchId, 'Batch lock ownership changed; manual inspection required.');
    unlinkSync(lockPath);
  }
}
