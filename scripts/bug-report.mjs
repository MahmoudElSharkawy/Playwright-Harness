#!/usr/bin/env node
import {projectArgument, consumerPath} from './lib/consumer-paths.mjs';
import {readBounded} from './lib/execute/storage.mjs';
import {prepareBugReport, readBugReport, editBugReport, discoverBugReport, previewBugReport, compactBugPreview, approveBugReport, fileBugReport, reconcileBugReport, annotateBugReport, reviewBugAnnotation, bugReportFromExecution, prepareRunBugReports} from './lib/bug-report/index.mjs';
import {reviewRunFailures} from './lib/bug-report/failures.mjs';

try {
  const {roots, args} = projectArgument(), [command, reportId, ...rest] = args, options = {};
  for (let index = 0; index < rest.length; index++) {
    const name = rest[index].slice(2);
    if (rest[index] === '--execute') options.execute = true;
    else if (rest[index].startsWith('--') && ['input', 'preview', 'approved', 'execution', 'fingerprint', 'format'].includes(name) && rest[index + 1] && !rest[index + 1].startsWith('--')) options[name] = rest[++index];
    else throw new Error('Unknown or incomplete bug-report option.');
  }
  const input = () => {if (!options.input) throw new Error('--input needs a selected JSON file.'); return readBounded(consumerPath(roots, options.input));};
  if (options.format !== undefined && (command !== 'preview' || !['compact', 'json'].includes(options.format))) throw new Error('Preview format must be compact or json.');
  let result;
  if (command === 'prepare') result = prepareBugReport(roots, reportId, input());
  else if (command === 'failures') result = await reviewRunFailures(roots, input());
  else if (command === 'from-run') result = await prepareRunBugReports(roots, reportId, input());
  else if (command === 'show') result = readBugReport(roots, reportId);
  else if (command === 'edit') result = editBugReport(roots, reportId, input());
  else if (command === 'discover') result = await discoverBugReport(roots, reportId, input());
  else if (command === 'preview') result = await previewBugReport(roots, reportId);
  else if (command === 'approve') result = approveBugReport(roots, reportId, options.preview);
  else if (command === 'file') {if (!options.execute || !options.approved) throw new Error('Filing requires --approved <preview hash> and explicit --execute.'); result = await fileBugReport(roots, reportId, options.approved);}
  else if (command === 'reconcile') {if (options.execute) throw new Error('Reconciliation is read-only in ADO.'); result = await reconcileBugReport(roots, reportId, options.input ? input() : undefined);}
  else if (command === 'annotate') result = await annotateBugReport(roots, reportId, input());
  else if (command === 'review-annotation') result = reviewBugAnnotation(roots, reportId, input());
  else if (command === 'from-execution') result = bugReportFromExecution(roots, reportId, options.execution, options.fingerprint);
  else throw new Error('Use bug-report failures|from-run|prepare|show|edit|discover|from-execution|annotate|review-annotation|preview|approve|file|reconcile <report> [options].');
  console.log(JSON.stringify(options.format === 'compact' ? compactBugPreview(result) : result, null, 2));
  if (command === 'preview' && result.ready === false || ['file', 'reconcile'].includes(command) && result.bugs.some(row => ['UNCERTAIN', 'ATTACHMENTS_PENDING', 'DISPATCHING'].includes(row.state))) process.exitCode = 1;
} catch (error) {console.error(error.message); process.exitCode = 1;}
