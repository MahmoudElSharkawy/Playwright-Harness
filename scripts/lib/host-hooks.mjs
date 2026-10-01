// Host payload translation only. Advisory convention guards do not grant runtime capabilities.
import {resolve} from 'node:path';

export function hookResponseText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter(v => !v?.type || v.type === 'text').map(hookResponseText).join('\n');
  if (value && typeof value === 'object') return ['stdout', 'stderr', 'output', 'aggregated_output', 'text', 'content'].filter(key => Object.hasOwn(value, key)).map(key => hookResponseText(value[key])).join('\n');
  return '';
}

export function guardEvents(host, input) {
  if (!['codex', 'claude'].includes(host) || !input || typeof input !== 'object' || typeof input.cwd !== 'string') return [];
  const event = input.hook_event_name, tool = input.tool_name;
  if (event === 'SessionStart') return [{mode: 'session-start', input}];
  if (['Bash', 'PowerShell'].includes(tool)) {
    if (event === 'PreToolUse') return [{mode: 'pre-bash', input}];
    if (event === 'PostToolUse' || host === 'claude' && event === 'PostToolUseFailure') {
      const response = input.tool_response ?? input.error;
      // Codex can supply MCP-style text blocks. Never stringify arbitrary tool metadata.
      return [{mode: 'post-bash', input: {...input, tool_response: hookResponseText(response)}}];
    }
  }
  if (event !== 'PostToolUse') return [];
  if (host === 'claude' && ['Edit', 'Write'].includes(tool)) return [{mode: 'post-edit', input}];
  if (host === 'codex' && tool === 'apply_patch' && typeof input.tool_input?.command === 'string') {
    // Codex emits PostToolUse for failures too. A proposed patch is not an applied edit.
    const response = input.tool_response;
    if (response?.isError || response?.error || response?.exit_code && response.exit_code !== 0
      || !/^Success\. Updated the following files:/m.test(hookResponseText(response))) return [];
    const requested = new Set([...input.tool_input.command.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)\r?$/gm)].map(m => resolve(input.cwd, m[1])));
    const files = [...hookResponseText(response).matchAll(/^[AMD] (.+)\r?$/gm)].map(m => resolve(input.cwd, m[1])).filter(file => requested.has(file));
    const root = resolve(input.cwd);
    return [...new Set(files)].filter(file => file.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))).map(file_path => ({mode: 'post-edit', input: {...input, tool_input: {file_path}}}));
  }
  return [];
}
