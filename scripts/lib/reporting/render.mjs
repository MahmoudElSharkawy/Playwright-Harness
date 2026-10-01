import {requireView} from './model.mjs';

export const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const html = escapeHtml;
const md = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]#|()!~]/g, char => `&#${char.charCodeAt(0)};`).replace(/[\r\n]+/g, ' ');
const lifecycle = resource => `${resource.lifecycle.action} / ${resource.lifecycle.status}`;
const lineage = resource => `Origin ${resource.originAttemptId}; identity ${JSON.stringify(resource.identity)}`;
const guard = resource => resource.lifecycle.guard ? `${resource.lifecycle.guard.kind}; evidence ${resource.lifecycle.guard.evidenceIds.join(', ')}` : 'not required or not recorded';
const values = object => Object.entries(object).map(([name, count]) => `${name}: ${count}`).join(' · ');
const table = (headings, rows) => `<div class="scroll"><table><thead><tr>${headings.map(h => `<th scope="col">${html(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${html(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const list = items => items.length ? `<ul>${items.map(item => `<li>${html(item)}</li>`).join('')}</ul>` : '<p class="muted">None recorded.</p>';

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

/** Self-contained static HTML. Consumer text is always text, never markup or a URL. */
export function renderHtml(view) {
  requireView(view);
  const sections = view.scenarios.map((scenario, index) => `<section id="scenario-${index}" aria-labelledby="title-${index}"><h2 id="title-${index}">${html(scenario.id)} <span class="badge ${scenario.status}">${scenario.status}</span></h2>
<p>Stability: <strong>${scenario.stability}</strong> · ${html(values(scenario.counts))}</p>
<p class="${scenario.requiredLifecycleComplete === false ? 'warning' : ''}">Required lifecycle: <strong>${scenario.requiredLifecycleComplete === undefined ? 'not executed' : scenario.requiredLifecycleComplete ? 'complete' : 'INCOMPLETE'}</strong>${scenario.reason ? ` · Reason: ${html(scenario.reason)}` : ''}</p>
${scenario.issues.length ? `<p class="warning">Issues: ${html(scenario.issues.join(', '))}</p>` : ''}
<h3>Phases and attempts</h3>${scenario.attempts.length ? scenario.attempts.map(attempt => `<article><h4>${attempt.identity.phase} · ${html(attempt.identity.operationId)}</h4>
<p>${html(attempt.identity.attemptId)} · Attempt ${attempt.identity.number} · Invocation ${html(attempt.identity.invocationId)} · ${attempt.durationMs} ms</p>
<p><strong>${attempt.outcome}</strong> · Classification: ${attempt.failureClass} · Effect: <strong>${attempt.effect.certainty}</strong></p>
<p>Affected resources: ${html(attempt.effect.resourceIds.join(', ') || 'none')}</p>
${attempt.effect.affectedRows ? `<p>Affected rows: ${html(JSON.stringify(attempt.effect.affectedRows))}</p>` : ''}
${attempt.reconciliation ? `<p>Reconciliation: ${attempt.reconciliation.kind} · ${html(attempt.reconciliation.evidenceIds.join(', '))}</p>` : ''}
${table(['Assertion', 'Status', 'Reliable', 'Evidence'], attempt.assertions.map(a => [a.id, a.status, String(a.reliable), a.evidenceIds.join(', ')]))}
<p class="muted">Attempt evidence: ${html(attempt.evidenceIds.join(', ') || 'none')}</p></article>`).join('') : '<p>No operations executed.</p>'}
<h3>Resources and lifecycle</h3>${scenario.resources.length ? table(['Resource', 'Ownership', 'Intent', 'Lifecycle', 'Restoration data', 'Evidence'], scenario.resources.map(r => [r.id, r.ownership, r.intent, lifecycle(r), r.restorationData, r.lifecycle.evidenceIds.join(', ')])) : '<p>No tracked resources.</p>'}
${scenario.resources.length ? list(scenario.resources.map(r => `${r.id}: ${lineage(r)}; lifecycle attempt ${r.lifecycle.attemptId ?? 'none'}; restoration guard: ${guard(r)}`)) : ''}
<h3>Selected outputs</h3>${list(scenario.outputs.map(o => `${o.name} (${o.type}, ${o.sensitivity}): ${o.display} · Producer: ${JSON.stringify(o.producer)}`))}</section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Harness report · ${html(view.runId)}</title><style>
:root{font-family:system-ui,sans-serif;color:#163047;background:#f3f6fa;line-height:1.55}*{box-sizing:border-box}body{margin:0}main{max-width:1200px;margin:auto;padding:32px 24px}header,section{background:white;border:1px solid #dce4ee;border-radius:12px;padding:24px;margin-bottom:20px}h1,h2,h3,h4{line-height:1.25}h1{font-size:2rem;margin:0 0 16px}h2{font-size:1.35rem}h3{margin-top:28px}h4{margin:0 0 10px}p,li,td{overflow-wrap:anywhere}.muted{color:#526679;font-size:.9rem}.badge{display:inline-block;padding:4px 10px;border-radius:5px;font-size:.85rem;border:1px solid currentColor}.PASS{color:#126340;background:#e3f5eb}.FAIL{color:#9e1738;background:#fce8ed}.NEEDS_REVIEW,.BLOCKED,.warning{color:#805000;background:#fff2ce}.SKIPPED{color:#465263;background:#edf0f4}.counts{display:flex;gap:12px;flex-wrap:wrap}.counts span{padding:8px 12px}article{border-left:3px solid #7694b0;padding:12px 16px;margin:16px 0;background:#f7f9fc}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #dce4ee}th{background:#edf2f8}nav a{color:#17528a;display:inline-block;margin:8px 16px 0 0}footer{font-size:.8rem;color:#526679}@media(max-width:600px){main{padding:16px 10px}header,section{padding:16px}h1{font-size:1.5rem}}@media print{body{background:white}main{max-width:none;padding:0}section{break-inside:avoid}.scroll{overflow:visible}}
body{overflow-wrap:anywhere}
</style></head><body><main><header><p class="muted">PLAYWRIGHT POM HARNESS · VALIDATED EXECUTION</p><h1>Execution report</h1><p>Run: <strong>${html(view.runId)}</strong></p><p><span class="badge ${view.status}">${view.status}</span> · Stability: <strong>${view.stability}</strong></p><div class="counts">${Object.entries(view.counts).map(([status, count]) => `<span class="badge ${status}">${status}: ${count}</span>`).join('')}</div><p class="muted">Verdicts supplied by the execution core. Sensitive values and raw evidence bodies are omitted.</p><nav aria-label="Scenarios">${view.scenarios.map((s, i) => `<a href="#scenario-${i}">${html(s.id)}</a>`).join('')}</nav></header>${sections}
<section><h2>Operation provenance</h2>${table(['Operation', 'Family / target / capability', 'Source / version', 'Fingerprint'], view.operations.map(o => [o.id, `${o.family} / ${o.target} / ${o.capability}`, `${o.source.kind} / ${o.source.reference} / ${o.source.version}`, o.fingerprint]))}</section>
<section><h2>Evidence inventory</h2><p>Paths are relative to the original run directory. Evidence bytes are not copied into this report.</p>${table(['Evidence', 'Kind / owner', 'Relative path', 'Bytes', 'SHA256'], view.evidence.map(e => [e.id, `${e.kind} / ${e.identity.scenarioId} / ${e.identity.attemptId}`, e.path, e.bytes, e.sha256]))}</section>
<footer>Input fingerprint: ${view.inputFingerprint}<br>Report fingerprint: ${view.fingerprint}</footer></main></body></html>\n`;
}
