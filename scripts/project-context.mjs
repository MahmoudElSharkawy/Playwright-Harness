#!/usr/bin/env node
import {projectArgument, consumerPath} from './lib/consumer-paths.mjs';
import {readBounded} from './lib/execute/storage.mjs';
import {retrieveContext, updateContext, readContext, saveContextPolicy} from './lib/context/index.mjs';

const usage = `pom-harness context <retrieve|update|stage> --request <consumer-json> [--project-root <consumer>]
pom-harness context read --id <context-id> [--project-root <consumer>]
pom-harness context policy --source <source-id> --policy <consumer-json> [--project-root <consumer>]

retrieve reads selected sources without saving; update publishes a recoverable snapshot.
stage also saves included ADO attachment bytes under ignored .harness/runs/context/ for host readers.
read returns captured context only. policy validates live metadata and saves an explicit selection.`;
function inputJson(roots, path) {
  try {return readBounded(consumerPath(roots, path));} catch {throw new Error('Context request/policy must be readable bounded JSON.');}
}
try {
  if (process.argv.slice(2).some(value => ['help', '--help', '-h'].includes(value))) {console.log(usage);}
  else {
    const {roots, args} = projectArgument(), [command, ...rest] = args, options = {};
    const fields = command === 'read' ? ['id'] : command === 'policy' ? ['source', 'policy'] : ['request'];
    for (let index = 0; index < rest.length; index += 2) {
      const name = rest[index].replace(/^--/, '');
      if (!rest[index].startsWith('--') || !fields.includes(name) || options[name] !== undefined || !rest[index + 1] || rest[index + 1].startsWith('--')) throw new Error(usage);
      options[name] = rest[index + 1];
    }
    if (fields.some(name => options[name] === undefined)) throw new Error(usage);
    let result;
    if (command === 'read') result = {status: 'CAPTURED', snapshot: readContext(roots, options.id)};
    else if (command === 'policy') result = await saveContextPolicy(roots, options.source, inputJson(roots, options.policy));
    else if (['retrieve', 'update', 'stage'].includes(command)) {
      const request = inputJson(roots, options.request);
      result = command === 'update' ? await updateContext(roots, request) : await retrieveContext(roots, request, {stageAttachments: command === 'stage'});
    } else throw new Error(usage);
    const {baseline, ...output} = result; console.log(JSON.stringify(output, null, 2));
    if (['SELECTION_REQUIRED', 'POLICY_REPAIR_REQUIRED'].includes(result.status) || result.snapshot?.status === 'partial') process.exitCode = 2;
  }
} catch (error) {console.error(`project-context: ${error.message}`); process.exitCode = 1;}
