#!/usr/bin/env node
// Local generation gates. Source code is authored/reused through the canonical POM skills.
import {join} from 'node:path';
import {projectArgument} from './lib/consumer-paths.mjs';
import {readJson} from './lib/project-config.mjs';
import {createRun} from './lib/execution-core/index.mjs';
import {requireThat, keys} from './lib/execution-core/data.mjs';
import {createGenerationHandoff, beginGeneration, registerCandidate, recordGenerationReview, generationStatus} from './lib/generation/index.mjs';
import {verifyGeneration} from './lib/generation/verify.mjs';
import {relativeFile} from './lib/generation/storage.mjs';

try {
  const {roots, args} = projectArgument(), [command, ...rest] = args;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    requireThat(['--input', '--id'].includes(rest[i]) && rest[i + 1] && !options[rest[i]], 'Use --input and/or --id once.'); options[rest[i]] = rest[i + 1];
  }
  let result;
  if (command === 'prepare') {
    requireThat(options['--input'] && !options['--id'], 'Prepare requires --input.');
    const input = readJson(relativeFile(roots, options['--input'])); keys(input, ['source', 'author', 'executions', 'bindings'], 'generation preparation');
    const source = readJson(relativeFile(roots, input.source));
    const executions = input.executions.map(item => {
      keys(item, ['snapshot', 'runRoot'], 'observed execution');
      const saved = readJson(relativeFile(roots, item.snapshot));
      const run = createRun({...saved.inputs, id: saved.id, startedAt: saved.startedAt});
      requireThat(run.inputFingerprint === saved.inputFingerprint, 'Run snapshot differs from assessed inputs.');
      const runRoot = relativeFile(roots, item.runRoot);
      return {run, roots: {...roots, runRoot}, observations: readJson(join(runRoot, 'observations.json'))};
    });
    const handoff = createGenerationHandoff(source, executions, input.bindings);
    await beginGeneration(roots, handoff, input.author); result = {status: 'PREPARED', sourceId: source.id, expectations: handoff.expectations.length};
  } else {
    requireThat(options['--id'], 'Generation command requires --id.');
    if (['candidate', 'review'].includes(command)) {
      requireThat(options['--input'], 'Candidate/review requires --input.');
      const input = readJson(relativeFile(roots, options['--input']));
      result = command === 'candidate' ? await registerCandidate(roots, options['--id'], input) : await recordGenerationReview(roots, options['--id'], input);
      result = {status: command === 'candidate' ? 'NEEDS_REVIEW' : result.verdict, revision: result.revision};
    } else {
      requireThat(!options['--input'], 'This command does not accept --input.');
      if (command === 'verify') result = await verifyGeneration(roots, options['--id']);
      else {requireThat(command === 'status', 'Unknown generation command.'); result = await generationStatus(roots, options['--id']);}
    }
  }
  console.log(JSON.stringify(result)); if (result.status !== 'PASS' && command === 'verify') process.exitCode = 1;
} catch {console.error(JSON.stringify({status: 'BLOCKED', reason: 'Generation input, review, scope, integrity or repair-budget gate failed; no source content emitted.'})); process.exitCode = 2;}
