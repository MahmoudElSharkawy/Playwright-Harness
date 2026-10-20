#!/usr/bin/env node
import {projectArgument, consumerPath} from './lib/consumer-paths.mjs';
import {readBounded} from './lib/execute/storage.mjs';
import {captureRequirements, prepareRequirements, readRequirements, updateInventory, saveChatReview, resumeRequirementsReview, planningHandoff, reviewDifferences, isChatReview} from './lib/requirements/index.mjs';
import {previewRequirementsComment, publishRequirementsComment, reconcileRequirementsComment, requirementsTeamMembers} from './lib/requirements/comments.mjs';

const usage = `pom-harness requirements <prepare|read|inventory|review|edit|resume|members|plan|preview|post|reconcile>
  prepare --id <analysis> --request <consumer-json>
  inventory --id <analysis> --input <consumer-json>
  review|edit --id <analysis> --input <consumer-chat-draft-json>
  read|resume|plan|preview --id <analysis>
  members --id <analysis>
  post --id <analysis> --approval <exact-preview-fingerprint>
  reconcile --id <analysis> [--comment-id <owner-identified-comment>]
All state stays in the consumer. Show the summary before the five-column table in chat.
Version-2 drafts require explicit High, Medium or Low severity; highest severity first.
Edit or resume the same saved draft. Review never accepts business requirements.
Only post can dispatch one confirmed discussion comment. No writes occur on preview.`;
try {
  const {roots, args} = projectArgument(), [command, ...rest] = args, options = {};
  if (command === '--help' || command === 'help') {console.log(usage); process.exit(0);}
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]?.replace(/^--/, '');
    if (!['id', 'request', 'input', 'approval', 'comment-id'].includes(key) || !rest[index]?.startsWith('--') || !rest[index + 1] || rest[index + 1].startsWith('--') || options[key]) throw new Error('Unknown, duplicate or incomplete option.\n' + usage);
    options[key] = rest[index + 1];
  }
  const load = name => {if (!options[name]) throw new Error('--' + name + ' is required.'); return readBounded(consumerPath(roots, options[name]));};
  let result;
  if (command === 'prepare') result = prepareRequirements(roots, options.id, await captureRequirements(roots, load('request')));
  else if (command === 'read') {const state = readRequirements(roots, options.id); result = {state, ...(isChatReview(state?.review) ? resumeRequirementsReview(roots, options.id) : state ? {differences: reviewDifferences(roots, state)} : {})};}
  else if (command === 'inventory') result = updateInventory(roots, options.id, load('input'));
  else if (command === 'review' || command === 'edit') result = saveChatReview(roots, options.id, load('input'));
  else if (command === 'resume') result = resumeRequirementsReview(roots, options.id);
  else if (command === 'members') result = await requirementsTeamMembers(roots, options.id);
  else if (command === 'plan') result = planningHandoff(roots, options.id);
  else if (command === 'preview') result = await previewRequirementsComment(roots, options.id);
  else if (command === 'post') result = await publishRequirementsComment(roots, options.id, {approval: options.approval});
  else if (command === 'reconcile') result = await reconcileRequirementsComment(roots, options.id, options['comment-id'] ? {commentId: Number(options['comment-id'])} : {});
  else throw new Error(usage);
  console.log(JSON.stringify(result, null, 2));
  if (['uncertain', 'not-executed', 'reconciliation-required'].includes(result?.mode)) process.exitCode = 1;
} catch (error) {console.error('requirements: ' + error.message); process.exitCode = 1;}
