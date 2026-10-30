#!/usr/bin/env node
import {projectArgument, consumerPath} from './lib/consumer-paths.mjs';
import {readBounded} from './lib/execute/storage.mjs';
import {prepareDesign, saveDesign, assessDesign, rejectDesign, designView, designHandoff} from './lib/test-case-design/index.mjs';
import {previewDesign, publishDesign, reconcileDesign} from './lib/test-case-design/delivery.mjs';

const usage = `pom-harness test-case-design <prepare|read|review|edit|assess|reject|preview|publish|reconcile|handoff>
  prepare --id <design> --input <consumer-source-selection-json>
  review|edit --id <design> --input <complete-proposal-json> [--notes <review-notes-json>]
  assess --id <design> --input <independent-assessment-json> [--notes <review-notes-json>]
  read --id <design> [--notes <review-notes-json>]
  reject --id <design>
  reconcile --id <design> [--execute --approval <original-preview-fingerprint>]
  preview|handoff --id <design> [--selected <ID,ID>]
  publish --id <design> --approval <exact-preview-fingerprint>
All state belongs to the consumer. Show rendered.markdown and link the written reviewFile.
Review notes are optional {gaps?, suggestions?} Markdown strings, never case or approval input.
Publication requires current source, actual independent review and exact approval.
Jira supports Xray, Zephyr Scale, or approved local cases without a plugin.
Select localCaseSource in prepare input to reuse an existing local scenario source.
Reconcile uncertain operations before resuming. This command never executes tests.`;
try {
  const {roots, args} = projectArgument(), [command, ...rest] = args, options = {};
  if (['help', '--help'].includes(command)) {console.log(usage); process.exit(0);}
  const allowed = {prepare: ['id', 'input'], review: ['id', 'input', 'notes'], edit: ['id', 'input', 'notes'], assess: ['id', 'input', 'notes'], read: ['id', 'notes'], reject: ['id'], reconcile: ['id', 'execute', 'approval'], preview: ['id', 'selected'], publish: ['id', 'approval'], handoff: ['id', 'selected']}[command];
  if (!allowed) throw new Error(usage);
  for (let index = 0; index < rest.length;) {
    const key = rest[index]?.replace(/^--/, '');
    if (key === 'execute' && command === 'reconcile' && !options.execute) {options.execute = true; index++; continue;}
    if (!rest[index]?.startsWith('--') || !allowed.includes(key) || !rest[index + 1] || rest[index + 1].startsWith('--') || options[key]) throw new Error('Unknown, duplicate or incomplete option.\n' + usage);
    options[key] = rest[index + 1]; index += 2;
  }
  if (!options.id) throw new Error('--id is required.');
  const input = () => {if (!options.input) throw new Error('--input is required.'); return readBounded(consumerPath(roots, options.input));};
  const selection = options.selected === undefined ? {} : {selected: options.selected.split(',')};
  let result;
  if (command === 'prepare') result = await prepareDesign(roots, options.id, input());
  else if (command === 'review' || command === 'edit') {saveDesign(roots, options.id, input()); result = designView(roots, options.id, undefined, {notes: options.notes});}
  else if (command === 'assess') {assessDesign(roots, options.id, input()); result = designView(roots, options.id, undefined, {notes: options.notes});}
  else if (command === 'reject') result = rejectDesign(roots, options.id);
  else if (command === 'read') result = designView(roots, options.id, undefined, {notes: options.notes});
  else if (command === 'preview') result = await previewDesign(roots, options.id, selection);
  else if (command === 'publish') result = await publishDesign(roots, options.id, {approval: options.approval});
  else if (command === 'reconcile') result = await reconcileDesign(roots, options.id, {execute: options.execute, approval: options.approval});
  else result = await designHandoff(roots, options.id, selection);
  console.log(JSON.stringify(result, null, 2));
  if (['incomplete', 'reconciliation-required'].includes(result?.mode)) process.exitCode = 1;
} catch (error) {console.error('test-case-design: ' + error.message); if (error.fieldProblems) console.error(JSON.stringify({fieldProblems: error.fieldProblems, fieldReview: error.fieldReview}, null, 2)); process.exitCode = 1;}
