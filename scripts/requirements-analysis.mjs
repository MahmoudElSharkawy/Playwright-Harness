#!/usr/bin/env node
import {projectArgument, consumerPath} from './lib/consumer-paths.mjs';
import {readBounded} from './lib/execute/storage.mjs';
import {captureRequirements, prepareRequirements, readRequirements, updateInventory, startRequirementsReview, resumeRequirementsReview, importDecisions, planningHandoff, readReviewHandoff, reviewDifferences} from './lib/requirements/index.mjs';
import {resolveGapCue} from './lib/requirements/gapcue.mjs';
import {previewRequirementsComment, publishRequirementsComment, reconcileRequirementsComment} from './lib/requirements/comments.mjs';

const usage = `pom-harness requirements <prepare|read|inventory|review|resume|import|plan|preview|post|reconcile|dependency>
  prepare --id <analysis> --request <consumer-json>
  inventory --id <analysis> --input <consumer-json>
  review --id <analysis> --gapcue <separate-skill-directory> --findings <consumer-json-array>
  resume --id <analysis> --gapcue <separate-skill-directory>
  import --id <analysis> --input <native-decisions-json>
  read|plan|preview --id <analysis>
  post --id <analysis> --approval <exact-preview-fingerprint>
  reconcile --id <analysis> [--comment-id <owner-identified-comment>]
  dependency --gapcue <separate-skill-directory>
All state stays in the consumer. Review prints the native serve command; importing
requires Download decisions. Approved findings never accept business requirements.
Only post can dispatch one confirmed discussion comment. No writes occur on preview.`;
try {
  const {roots, args} = projectArgument(), [command, ...rest] = args, options = {};
  if (command === '--help' || command === 'help') {console.log(usage); process.exit(0);}
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]?.replace(/^--/, '');
    if (!['id', 'request', 'input', 'gapcue', 'findings', 'approval', 'comment-id'].includes(key) || !rest[index]?.startsWith('--') || !rest[index + 1] || rest[index + 1].startsWith('--') || options[key]) throw new Error('Unknown, duplicate or incomplete option.\n' + usage);
    options[key] = rest[index + 1];
  }
  const load = name => {if (!options[name]) throw new Error('--' + name + ' is required.'); return readBounded(consumerPath(roots, options[name]));};
  let result;
  if (command === 'prepare') result = prepareRequirements(roots, options.id, await captureRequirements(roots, load('request')));
  else if (command === 'read') {const state = readRequirements(roots, options.id); result = {state, ...(state ? {differences: reviewDifferences(roots, state)} : {}), ...(state?.review?.handoff ? {handoff: readReviewHandoff(roots, state)} : {})};}
  else if (command === 'inventory') result = updateInventory(roots, options.id, load('input'));
  else if (command === 'review') result = startRequirementsReview(roots, options.id, {gapcue: options.gapcue, findings: load('findings')});
  else if (command === 'resume') result = resumeRequirementsReview(roots, options.id, {gapcue: options.gapcue});
  else if (command === 'import') result = importDecisions(roots, options.id, options.input);
  else if (command === 'plan') result = planningHandoff(roots, options.id);
  else if (command === 'preview') result = await previewRequirementsComment(roots, options.id);
  else if (command === 'post') result = await publishRequirementsComment(roots, options.id, {approval: options.approval});
  else if (command === 'reconcile') result = await reconcileRequirementsComment(roots, options.id, options['comment-id'] ? {commentId: Number(options['comment-id'])} : {});
  else if (command === 'dependency') result = resolveGapCue(options.gapcue);
  else throw new Error(usage);
  console.log(JSON.stringify(result, null, 2));
  if (['uncertain', 'not-executed', 'reconciliation-required'].includes(result?.mode)) process.exitCode = 1;
} catch (error) {console.error('requirements: ' + error.message); process.exitCode = 1;}
