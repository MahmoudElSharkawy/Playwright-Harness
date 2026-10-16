#!/usr/bin/env node
// Local generation gates. Source code is authored/reused through the canonical POM skills.
import {join} from 'node:path';
import {projectArgument} from './lib/consumer-paths.mjs';
import {readJson} from './lib/project-config.mjs';
import {createRun} from './lib/execution-core/index.mjs';
import {requireThat, keys} from './lib/execution-core/data.mjs';
import {createGenerationHandoff, beginGeneration, registerCandidate, reviseGeneration, recordGenerationReview, generationStatus, recordGenerationReporting} from './lib/generation/index.mjs';
import {verifyGeneration} from './lib/generation/verify.mjs';
import {relativeFile} from './lib/generation/storage.mjs';
import {writeAutomationReport} from './lib/generation/report.mjs';
import {generationBlocker} from './lib/generation/reasons.mjs';

let roots, source, sourceId, command, reportContext;

try {
  const parsed = projectArgument(); roots = parsed.roots;
  const [selectedCommand, ...rest] = parsed.args; command = selectedCommand;
  const options = {};
  for (let i = 0; i < rest.length;) {
    if (rest[i] === '--allure') {requireThat(command === 'verify' && !options['--allure'], 'Allure capture is available once on verify.'); options['--allure'] = true; i++; continue;}
    requireThat((command === 'report' ? ['--input', '--id', '--source', '--scope'] : ['--input', '--id']).includes(rest[i]) && rest[i + 1] && !options[rest[i]], 'Use the command-specific input, source and/or id options once.'); options[rest[i]] = rest[i + 1];
    i += 2;
  }
  let result;
  sourceId = options['--id'];
  if (command === 'report') {
    requireThat(sourceId || options['--source'], 'Report requires --id or --source.');
    if (options['--source']) source = readJson(relativeFile(roots, options['--source']));
    if (options['--scope']) {
      requireThat(sourceId, 'Associating requested scope requires the generation --id.');
      await recordGenerationReporting(roots, sourceId, {source: readJson(relativeFile(roots, options['--scope'])), ...(options['--input'] ? {notes: readJson(relativeFile(roots, options['--input']))} : {})});
    }
    result = await writeAutomationReport(roots, {sourceId, source, ...(options['--input'] ? {notes: readJson(relativeFile(roots, options['--input']))} : {})});
  } else if (['prepare', 'revise'].includes(command)) {
    requireThat(options['--input'] && (command === 'revise' ? options['--id'] : !options['--id']), 'Prepare requires --input; revise also requires the existing --id.');
    const input = readJson(relativeFile(roots, options['--input'])); keys(input, ['source', 'executions', 'bindings', 'reporting', command === 'prepare' ? 'author' : 'candidate'], 'generation preparation');
    source = readJson(relativeFile(roots, input.source)); sourceId ??= source.id;
    if (input.reporting !== undefined) {
      keys(input.reporting, ['source', 'notes'], 'generation reporting paths');
      reportContext = {source: readJson(relativeFile(roots, input.reporting.source)), ...(input.reporting.notes === undefined ? {} : {notes: readJson(relativeFile(roots, input.reporting.notes))})};
    }
    const executions = input.executions.map(item => {
      keys(item, ['snapshot', 'runRoot'], 'observed execution');
      const saved = readJson(relativeFile(roots, item.snapshot));
      const run = createRun({...saved.inputs, id: saved.id, startedAt: saved.startedAt});
      requireThat(run.inputFingerprint === saved.inputFingerprint, 'Run snapshot differs from assessed inputs.');
      const runRoot = relativeFile(roots, item.runRoot);
      return {run, roots: {...roots, runRoot}, observations: readJson(join(runRoot, 'observations.json'))};
    });
    const handoff = createGenerationHandoff(source, executions, input.bindings);
    if (command === 'prepare') {
      await beginGeneration(roots, handoff, input.author, reportContext); result = {status: 'PREPARED', sourceId: source.id, expectations: handoff.expectations.length};
    } else {
      const candidate = await reviseGeneration(roots, options['--id'], handoff, input.candidate, reportContext);
      result = {status: 'NEEDS_REVIEW', sourceId: source.id, revision: candidate.revision, sourceFingerprint: candidate.sourceFingerprint};
    }
  } else {
    requireThat(options['--id'], 'Generation command requires --id.');
    if (['candidate', 'review'].includes(command)) {
      requireThat(options['--input'], 'Candidate/review requires --input.');
      const input = readJson(relativeFile(roots, options['--input']));
      result = command === 'candidate' ? await registerCandidate(roots, options['--id'], input) : await recordGenerationReview(roots, options['--id'], input);
      result = {status: command === 'candidate' ? 'NEEDS_REVIEW' : result.verdict, revision: result.revision};
    } else {
      requireThat(!options['--input'], 'This command does not accept --input.');
      if (command === 'verify') result = await verifyGeneration(roots, options['--id'], {allure: options['--allure'] ?? false});
      else {requireThat(command === 'status', 'Unknown generation command.'); result = await generationStatus(roots, options['--id']);}
    }
  }
  const reporting = command === 'report' ? undefined : await writeAutomationReport(roots, {sourceId, source, ...(reportContext ? {reporting: reportContext} : {})});
  console.log(JSON.stringify({...result, ...(reporting ? {reporting} : {})}));
  if (result.status !== 'PASS' && command === 'verify' || command === 'report' && result.status === 'FAILED') process.exitCode = 1;
} catch (error) {
  const code = ['MAPPING_STEPS', 'MAPPING_KEYS', 'MAPPING_REFERENCES'].includes(error.code) ? error.code : undefined;
  const blocker = generationBlocker(error, (command ?? 'PREPARE').toUpperCase());
  const reporting = roots && (sourceId || source) ? await writeAutomationReport(roots, {sourceId, source, blocker, ...(reportContext ? {reporting: reportContext} : {})}) : undefined;
  console.error(JSON.stringify({status: 'BLOCKED', ...(code ? {code} : {}), reason: blocker.reason, ...(reporting ? {reporting} : {})})); process.exitCode = 2;
}
