import {requireThat} from './execution-core/data.mjs';
import {hookResponseText} from './host-hooks.mjs';

/** Only the fixed reviewed Node invocation, including known native CLI display wrappers.
 * This recognizes evidence; it never constructs, rewrites or executes shell commands.
 */
export function reviewedInvocation(command, script) {
  if (typeof command !== 'string' || typeof script !== 'string') return null;
  let text = command.trim();
  const wrapper = text.match(/^(?:"[^"\r\n]*(?:pwsh|powershell)(?:\.exe)?"|\/(?:usr\/)?bin\/(?:ba)?sh)\s+(?:-Command|-lc|-c)\s+([\s\S]+)$/i);
  if (wrapper) {
    const quoted = wrapper[1];
    if (quoted.startsWith('"')) {try {text = JSON.parse(quoted);} catch {return null;}}
    else if (quoted.startsWith("'") && quoted.endsWith("'")) text = quoted.slice(1, -1);
    else return null;
  }
  const match = text.match(/^node (["'])([^\r\n]+)\1 (ping|execute|denied git push origin main)$/);
  const canonical = path => path.replaceAll('\\', '/').replace(/\/{2,}/g, '/');
  if (!match || canonical(match[2]) !== canonical(script)) return null;
  return match[3] === 'denied git push origin main' ? 'deny' : match[3];
}
export function executionReceipt(response) {
  const matches = [...hookResponseText(response).matchAll(/\{"receipt":"M11_EXECUTION_RECEIPT","sha256":"([a-f0-9]{64})","cases":([1-9]\d*)\}/g)];
  return matches.length === 1 ? {digest: matches[0][1], cases: Number(matches[0][2])} : null;
}

/** Fixed M11 native evidence gate, independent of an agent's final answer. */
export function assessNativeHost({host, processResult, events, hooks, digest, script, expectedCases, deniedMarker, allowedMarker, editedFile, infrastructureCleanup, packageUnchanged}) {
  requireThat(['codex', 'claude'].includes(host) && /^[a-f0-9]{64}$/.test(digest), 'Native host and receipt digest required.');
  requireThat(typeof script === 'string' && Number.isSafeInteger(expectedCases) && expectedCases > 0, 'Reviewed invocation and case count required.');
  const isCommand = command => reviewedInvocation(command, script) === 'execute';
  const matchesReceipt = response => {const found = executionReceipt(response); return found?.digest === digest && found.cases === expectedCases;};
  const success = host === 'codex' ? events.some(e => e.type === 'turn.completed') && !events.some(e => e.type === 'turn.failed')
    : events.some(e => e.type === 'result' && e.is_error === false);
  const receipt = host === 'codex'
    ? events.some(e => e.type === 'item.completed' && e.item?.type === 'command_execution' && e.item.exit_code === 0 && isCommand(e.item.command)
      && matchesReceipt(e.item.aggregated_output))
    : events.some(e => e.type === 'user' && e.message?.content?.some(c => c.type === 'tool_result' && !c.is_error
      && matchesReceipt(c.content)
      && events.some(a => a.type === 'assistant' && a.message?.content?.some(t => t.type === 'tool_use' && t.id === c.tool_use_id && ['Bash', 'PowerShell'].includes(t.name) && isCommand(t.input?.command)))));
  const nativeHooks = hooks.filter(h => h.host === host);
  const oneSession = nativeHooks.length > 0 && nativeHooks.every(h => typeof h.session === 'string' && h.session.length > 0) && new Set(nativeHooks.map(h => h.session)).size === 1;
  const hookCoverage = nativeHooks[0]?.event === 'SessionStart' && nativeHooks[0].exitCode === 0 && nativeHooks[0].mappedModes?.includes('session-start')
    && ['PreToolUse', 'PostToolUse'].every(event => nativeHooks.some(h => h.event === event));
  const paired = stage => nativeHooks.some((h, index) => h.event === 'PreToolUse' && h.stage === stage && h.exitCode === 0 && typeof h.toolUse === 'string' && h.toolUse.length > 0
    && (stage === 'edit' || h.reviewedCommand === true) && nativeHooks.some((post, later) => later > index && post.event === 'PostToolUse' && post.stage === stage
      && post.toolUse === h.toolUse && post.exitCode === 0 && (stage === 'edit' || post.reviewedCommand === true)
      && post.mappedModes?.includes(stage === 'edit' ? 'post-edit' : 'post-bash')
      && (stage !== 'execute' || post.executionReceipt?.digest === digest && post.executionReceipt.cases === expectedCases)));
  const denied = nativeHooks.some(h => h.event === 'PreToolUse' && h.stage === 'deny' && h.reviewedCommand === true && h.exitCode === 2 && typeof h.toolUse === 'string' && h.toolUse.length > 0) && !deniedMarker;
  const allowed = paired('ping') && allowedMarker, edited = paired('edit') && editedFile, executed = paired('execute');
  const passed = processResult.exitCode === 0 && !processResult.timedOut && processResult.packageUnchanged && packageUnchanged && infrastructureCleanup
    && success && receipt && oneSession && hookCoverage && denied && allowed && edited && executed;
  return {host, status: passed ? 'PASS' : 'FAIL', version: processResult.version, success, receipt, oneSession, hookCoverage, denied, allowed, edited, executed, infrastructureCleanup, packageUnchanged};
}
