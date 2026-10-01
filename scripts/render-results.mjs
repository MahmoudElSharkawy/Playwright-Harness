#!/usr/bin/env node
import {join} from 'node:path';
import {projectArgument} from './lib/consumer-paths.mjs';
import {relativeFile} from './lib/generation/storage.mjs';
import {readJson} from './lib/project-config.mjs';
import {createRun, assessRun} from './lib/execution-core/index.mjs';
import {requireThat} from './lib/execution-core/data.mjs';
import {writeReports} from './lib/reporting/index.mjs';

try {
  const {roots, args} = projectArgument(), options = {};
  for (let index = 0; index < args.length; index += 2) {
    requireThat(['--snapshot', '--run-root', '--output'].includes(args[index]) && args[index + 1] && !options[args[index]], 'Use each reporting option once.');
    options[args[index]] = args[index + 1];
  }
  requireThat(options['--snapshot'] && options['--run-root'], 'Reporting needs the original run snapshot and observations.');
  const saved = readJson(relativeFile(roots, options['--snapshot'])), run = createRun({...saved.inputs, id: saved.id, startedAt: saved.startedAt});
  requireThat(run.inputFingerprint === saved.inputFingerprint, 'Run snapshot changed.');
  const runRoot = relativeFile(roots, options['--run-root']), result = assessRun(run, {...roots, runRoot}, readJson(join(runRoot, 'observations.json')));
  const receipt = writeReports(roots, result, options['--output'] ? {directory: options['--output']} : {});
  console.log(JSON.stringify(receipt)); if (receipt.status !== 'WRITTEN') process.exitCode = 1;
} catch {console.error(JSON.stringify({status: 'FAILED', reason: 'Report inputs, evidence or consumer paths are invalid; no claimed verdict rendered.'})); process.exitCode = 2;}
