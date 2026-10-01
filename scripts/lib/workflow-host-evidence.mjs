import {readFileSync, realpathSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {hookResponseText} from './host-hooks.mjs';

export const workflowAuthoredFiles = Object.freeze(['src/pages/ObservationPage.ts', 'src/apis/ApisObservations.ts', 'src/dbs/DbsObservations.ts', 'tests/ObservationTests.spec.ts']);
const canonical = value => {
  let text = value.replaceAll('\\', '/');
  const unc = text.startsWith('//');
  text = (unc ? '//' : '') + (unc ? text.replace(/^\/+/, '') : text).replace(/\/{2,}/g, '/');
  // Git Bash reports Windows drive paths as /c/...; Linux /c remains an ordinary directory.
  if (process.platform === 'win32') text = text.replace(/^\/([a-z])(?=\/)/i, '$1:').replace(/^([A-Z]):/, (_, drive) => drive.toLowerCase() + ':');
  return text;
};
const nativePathMatches = (actual, expected, projectRoot, allowConsumerLink = false) => {
  const path = canonical(actual), target = canonical(expected);
  if (path.startsWith('//') && !target.startsWith('//')) return false;
  const resolved = resolve(projectRoot, path);
  if (canonical(resolved) === canonical(resolve(target))) return true;
  // Only inspect links within this owned consumer, never arbitrary foreign paths/shares.
  if (!allowConsumerLink || !canonical(resolved).startsWith(canonical(resolve(projectRoot)) + '/')) return false;
  try {return canonical(realpathSync(resolved)) === canonical(realpathSync(expected));} catch {return false;}
};
function nativeCommandBody(command, projectRoot) {
  if (typeof command !== 'string') return null;
  let text = command.trim();
  const wrapper = text.match(/^(?:"[^"\r\n]*(?:pwsh|powershell)(?:\.exe)?"|\/(?:usr\/)?bin\/(?:ba)?sh)\s+(?:-Command|-lc|-c)\s+([\s\S]+)$/i);
  if (wrapper) {
    try {text = wrapper[1].startsWith('"') ? JSON.parse(wrapper[1]) : wrapper[1].startsWith("'") && wrapper[1].endsWith("'") ? wrapper[1].slice(1, -1) : '';} catch {return null;}
  }
  // Native Claude may name its existing consumer cwd. Accept only that exact directory,
  // followed by the fixed invocation; this is not permission for arbitrary shell chains.
  const directory = text.match(/^cd (?:(['"])([^\r\n]+)\1|(\/[A-Za-z0-9_./-]+)) && ([^\r\n]+)$/);
  if (directory) {
    if (!projectRoot || canonical(directory[2] ?? directory[3]) !== canonical(projectRoot)) return null;
    text = directory[4];
  }
  return text;
}
export function workflowInvocation(command, script, projectRoot) {
  const text = nativeCommandBody(command, projectRoot);
  if (!text) return null;
  const match = text.match(/^node (["'])([^\r\n]+)\1 (explore|candidate|complete)$/);
  return match && canonical(match[2]) === canonical(script) ? match[3] : null;
}
export function workflowReceipt(response) {
  const matches = [...hookResponseText(response).matchAll(/\{"receipt":"M15_WORKFLOW_RECEIPT","stage":"(explore|candidate|complete|review-rejected)","sha256":"([a-f0-9]{64})","scenarios":([1-9]\d*)\}/g)];
  return matches.length === 1 ? {stage: matches[0][1], sha256: matches[0][2], scenarios: Number(matches[0][3])} : null;
}
export function observedWorkflowCommand(host, events, script, stage, expected, projectRoot) {
  const matches = value => {const receipt = workflowReceipt(value); return receipt?.stage === expected.stage && receipt.sha256 === expected.sha256 && receipt.scenarios === expected.scenarios;};
  if (host === 'codex') return events.some(e => e.type === 'item.completed' && e.item?.type === 'command_execution' && e.item.exit_code === 0
    && workflowInvocation(e.item.command, script, projectRoot) === stage && matches(e.item.aggregated_output));
  return events.some(e => e.type === 'user' && e.message?.content?.some(c => c.type === 'tool_result' && !c.is_error && matches(c.content)
    && events.some(a => a.type === 'assistant' && a.message?.content?.some(t => t.type === 'tool_use' && t.id === c.tool_use_id && ['Bash', 'PowerShell'].includes(t.name) && workflowInvocation(t.input?.command, script, projectRoot) === stage))));
}
export function observedWorkflowAuthorship(host, events, projectRoot, path) {
  const isPath = actual => typeof actual === 'string' && nativePathMatches(actual, join(projectRoot, path), projectRoot);
  if (host === 'codex') return events.some(e => e.type === 'item.completed' && e.item?.type === 'file_change' && e.item.status === 'completed' && e.item.changes?.some(c => isPath(c.path)));
  return events.some(e => e.type === 'assistant' && e.message?.content?.some(t => t.type === 'tool_use' && ['Write', 'Edit'].includes(t.name) && isPath(t.input?.file_path)
    && events.some(r => r.type === 'user' && r.message?.content?.some(c => c.type === 'tool_result' && c.tool_use_id === t.id && !c.is_error))));
}

/** Recognize only a whole-file native read of this file, with complete returned content. */
export function observedWorkflowRead(host, events, path, projectRoot, content) {
  const normalized = text => text.replaceAll('\r', '').split('\n').map(line => line.replace(/^\s*\d+[→\t]/, '').trimEnd()).join('\n').trim();
  const complete = value => normalized(content).length > 0 && normalized(hookResponseText(value)).includes(normalized(content));
  const namedFile = command => {
    const body = nativeCommandBody(command, projectRoot);
    const match = body?.match(/^(?:cat|Get-Content(?: -(?:Raw|LiteralPath))*) (?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s;|&<>"']+))$/i);
    return !!match && nativePathMatches(match[1] ?? match[2] ?? match[3], path, projectRoot, true);
  };
  if (host === 'codex') return events.some(e => e.type === 'item.completed' && e.item?.type === 'command_execution' && e.item.status === 'completed'
    && e.item.exit_code === 0 && namedFile(e.item.command) && complete(e.item.aggregated_output));
  if (host !== 'claude') return false;
  return events.some(e => e.type === 'assistant' && e.message?.content?.some(call => {
    if (call.type !== 'tool_use') return false;
    const named = call.name === 'Read' ? typeof call.input?.file_path === 'string' && nativePathMatches(call.input.file_path, path, projectRoot, true)
      : ['Bash', 'PowerShell'].includes(call.name) && namedFile(call.input?.command);
    if (!named) return false;
    return events.some(result => result.type === 'user' && result.message?.content?.some(item => item.type === 'tool_result' && item.tool_use_id === call.id && !item.is_error
      && complete(item.content)));
  }));
}

/** Native tool evidence, never an agent's final claim, establishes who performed the workflow. */
export function assessWorkflowHost({host, roots, events, processResult, commands, authoring = false}) {
  const script = join(roots.packageRoot, 'harness-tests/fixtures/workflow-command.mjs');
  const requirements = {process: processResult.exitCode === 0 && !processResult.timedOut && processResult.ownedProcessesStopped === true && processResult.packageUnchanged === true,
    completed: host === 'codex' ? events.some(e => e.type === 'turn.completed') && !events.some(e => e.type === 'turn.failed') : events.some(e => e.type === 'result' && e.is_error === false),
    commands: commands.length > 0 && commands.every(c => observedWorkflowCommand(host, events, script, c.command, c, roots.projectRoot))};
  if (authoring) {
    const skill = '.agents/skills/automate-suite/SKILL.md';
    requirements.skillRead = observedWorkflowRead(host, events, join(roots.packageRoot, skill), roots.projectRoot, readFileSync(join(roots.packageRoot, skill), 'utf8'));
    requirements.sourceRead = observedWorkflowRead(host, events, join(roots.projectRoot, 'source.json'), roots.projectRoot, readFileSync(join(roots.projectRoot, 'source.json'), 'utf8'));
    requirements.authored = workflowAuthoredFiles.every(path => observedWorkflowAuthorship(host, events, roots.projectRoot, path));
    if (host === 'claude') {
      const init = events.find(e => e.type === 'system' && e.subtype === 'init'), plugins = init?.plugins?.filter(p => p.name === 'playwright-pom-harness') ?? [];
      requirements.nativeSkills = plugins.length === 1 && realpathSync(plugins[0].path) === roots.packageRoot && init.skills?.includes('playwright-pom-harness:automate-suite');
    } else requirements.nativeSkills = realpathSync(join(roots.projectRoot, skill)) === realpathSync(join(roots.packageRoot, skill));
  }
  return {host, status: Object.values(requirements).every(value => value === true) ? 'PASS' : 'FAIL', requirements};
}
