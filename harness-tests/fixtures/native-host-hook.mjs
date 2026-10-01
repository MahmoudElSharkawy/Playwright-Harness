// M11 fixture: invoke the actual adapter and retain minimal native hook receipts.
import {readFileSync, appendFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {reviewedInvocation, executionReceipt} from '../../scripts/lib/host-proof-assessment.mjs';
import {guardEvents} from '../../scripts/lib/host-hooks.mjs';
const input = JSON.parse(readFileSync(0, 'utf8')), host = process.argv[2];
const child = spawnSync(process.execPath, [join(import.meta.dirname, '../../scripts/hooks/host.mjs'), host], {input: JSON.stringify(input), encoding: 'utf8', windowsHide: true, timeout: 20000});
const command = input.tool_input?.command ?? '';
const invocation = reviewedInvocation(command, join(import.meta.dirname, 'host-command.mjs'));
const stage = invocation ?? (['Edit', 'Write', 'apply_patch'].includes(input.tool_name) ? 'edit' : 'other');
const directory = join(process.cwd(), '.harness'); mkdirSync(directory, {recursive: true});
appendFileSync(join(directory, 'native-hooks.jsonl'), JSON.stringify({host, event: input.hook_event_name, tool: input.tool_name ?? null, toolUse: input.tool_use_id ?? null,
  session: typeof input.session_id === 'string' && input.session_id.length ? createHash('sha256').update(input.session_id).digest('hex') : null,
  stage, reviewedCommand: invocation !== null, exitCode: child.status, mappedModes: guardEvents(host, input).map(event => event.mode),
  ...(stage === 'execute' && input.hook_event_name === 'PostToolUse' ? {executionReceipt: executionReceipt(input.tool_response)} : {})}) + '\n');
// This proof has an explicit main-branch override and is not consumer adoption.
if (input.hook_event_name !== 'SessionStart') {process.stdout.write(child.stdout ?? ''); process.stderr.write(child.stderr ?? '');}
else console.log('M11 native hook active. Follow the fixed proof instructions in this consumer.');
process.exitCode = child.status ?? 1;
