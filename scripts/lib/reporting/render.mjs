import {requireView} from './model.mjs';
import {renderRuntimeHtml} from './runtime-view.mjs';
export {escapeHtml} from './text.mjs';

const md = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]#|()!~]/g, char => `&#${char.charCodeAt(0)};`).replace(/[\r\n]+/g, ' ');
const lifecycle = resource => `${resource.lifecycle.action} / ${resource.lifecycle.status}`;
const lineage = resource => `Origin ${resource.originAttemptId}; identity ${JSON.stringify(resource.identity)}`;
const guard = resource => resource.lifecycle.guard ? `${resource.lifecycle.guard.kind}; evidence ${resource.lifecycle.guard.evidenceIds.join(', ')}` : 'not required or not recorded';
const values = object => Object.entries(object).map(([name, count]) => `${name}: ${count}`).join(' · ');

export function renderJson(view) {requireView(view); return JSON.stringify(view, null, 2) + '\n';}

/** Escape all consumer text; no raw HTML, executable links or embedded payloads. */
export function renderMarkdown(view) {
  requireView(view); const lines = ['# Harness execution report', '', `Run: ${md(view.runId)}`, '', `Status: **${view.status}** · Stability: **${view.stability}**`, '', values(view.counts), '', 'Verdicts supplied by the execution core. Sensitive values and raw evidence bodies are omitted.', ''];
  for (const scenario of view.scenarios) {
    lines.push(`## ${md(scenario.id)} — ${scenario.status}`, '', `Stability: ${scenario.stability} · ${values(scenario.counts)}`, '',
      `Required lifecycle: ${scenario.requiredLifecycleComplete === undefined ? 'not executed' : scenario.requiredLifecycleComplete ? 'complete' : 'INCOMPLETE'}`, '');
    if (scenario.reason) lines.push(`Reason: ${md(scenario.reason)}`, '');
    if (scenario.issues.length) lines.push(`Issues: ${scenario.issues.join(', ')}`, '');
    lines.push('### Phases and attempts', '');
    for (const attempt of scenario.attempts) {
      lines.push(`- ${attempt.identity.phase} / ${md(attempt.identity.operationId)} / ${md(attempt.identity.attemptId)} (attempt ${attempt.identity.number}): ${attempt.outcome}; ${attempt.failureClass}; effect ${attempt.effect.certainty}; ${attempt.durationMs} ms`);
      lines.push(`  - Invocation: ${md(attempt.identity.invocationId)}; evidence: ${attempt.evidenceIds.map(md).join(', ') || 'none'}`);
      lines.push(`  - Affected resources: ${attempt.effect.resourceIds.map(md).join(', ') || 'none'}`);
      if (attempt.effect.affectedRows) lines.push(`  - Affected rows: ${md(JSON.stringify(attempt.effect.affectedRows))}`);
      if (attempt.reconciliation) lines.push(`  - Reconciliation: ${attempt.reconciliation.kind}; evidence: ${attempt.reconciliation.evidenceIds.map(md).join(', ')}`);
      for (const assertion of attempt.assertions) lines.push(`  - Assertion ${md(assertion.id)}: ${assertion.status}; reliable: ${assertion.reliable}; evidence: ${assertion.evidenceIds.map(md).join(', ') || 'none'}`);
    }
    if (!scenario.attempts.length) lines.push('No operations executed.');
    lines.push('', '### Resources and lifecycle', '');
    for (const resource of scenario.resources) lines.push(`- ${md(resource.id)}: ${resource.ownership}; intent ${resource.intent}; ${lifecycle(resource)}; restoration data ${resource.restorationData}; evidence: ${resource.lifecycle.evidenceIds.map(md).join(', ') || 'none'}`,
      `  - ${md(lineage(resource))}; lifecycle attempt ${md(resource.lifecycle.attemptId ?? 'none')}; restoration guard: ${md(guard(resource))}`);
    if (!scenario.resources.length) lines.push('No tracked resources.');
    lines.push('', '### Selected outputs', '');
    for (const output of scenario.outputs) lines.push(`- ${md(output.name)} (${output.type}, ${output.sensitivity}): ${md(output.display)}; producer: ${md(JSON.stringify(output.producer))}`);
    if (!scenario.outputs.length) lines.push('No selected outputs.');
    lines.push('');
  }
  lines.push('## Operation provenance', '');
  for (const operation of view.operations) lines.push(`- ${md(operation.id)}: ${operation.family}; target ${md(operation.target)}; capability ${operation.capability}; ${operation.source.kind}; ${md(operation.source.reference)}; version ${md(operation.source.version)}; fingerprint ${operation.fingerprint}`);
  lines.push('', '## Evidence inventory', '', 'Paths are relative to the original run directory. Bytes are not copied into this report.', '');
  for (const evidence of view.evidence) lines.push(`- ${md(evidence.id)}: ${evidence.kind}; ${md(evidence.path)}; ${md(evidence.identity.scenarioId)} / ${md(evidence.identity.attemptId)}; ${evidence.bytes} bytes; SHA256 ${evidence.sha256}`);
  if (!view.evidence.length) lines.push('No registered evidence for this unexecuted scope.');
  return lines.join('\n') + '\n';
}

/** Validated runtimes use the shared case-report presentation. */
export function renderHtml(view) {requireView(view); return renderRuntimeHtml(view);}
