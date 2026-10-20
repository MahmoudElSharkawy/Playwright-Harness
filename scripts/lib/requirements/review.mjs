import {contextData} from '../context/model.mjs';
import {keys, requireThat, fingerprint} from '../execution-core/data.mjs';

export const escapeHtml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const boundedText = (value, label) => requireThat(typeof value === 'string' && value.trim() && Buffer.byteLength(value) <= 65536 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), `${label} must be bounded, nonempty plain text.`);

/** AI judgments stay plain data; source excerpts must resolve to the existing inventory. */
export function validateFindings(raw, inventory, source) {
  const findings = contextData(raw), ids = new Set();
  requireThat(Array.isArray(findings) && findings.length <= 500, 'Findings must be a bounded array; zero is valid.');
  for (const finding of findings) {
    keys(finding, ['id', 'type', 'finding', 'sources', 'question'], 'finding');
    requireThat(typeof finding.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(finding.id) && !['__proto__', 'constructor', 'prototype'].includes(finding.id) && !ids.has(finding.id), 'Duplicate or invalid finding ID.'); ids.add(finding.id);
    requireThat(['Gap', 'Contradiction'].includes(finding.type), 'Finding Type must be Gap or Contradiction.');
    boundedText(finding.finding, 'Finding'); boundedText(finding.question, 'Question/Comment for Business');
    requireThat(Array.isArray(finding.sources) && finding.sources.length > 0 && finding.sources.length <= 20, 'A finding requires located source material.');
    const quotes = new Set();
    for (const reference of finding.sources) {
      keys(reference, ['requirementId', 'quote'], 'finding source'); boundedText(reference.quote, 'Source quote');
      const entry = inventory.find(item => item.id === reference.requirementId), part = entry && source.parts.find(part => part.id === entry.partId);
      requireThat(entry && part && part.text.slice(entry.start, entry.end).includes(reference.quote), 'Finding source quote must match the exact current inventory slice.');
      const key = fingerprint(reference); requireThat(!quotes.has(key), 'Duplicate source passage.'); quotes.add(key);
    }
    requireThat(finding.type !== 'Contradiction' || quotes.size >= 2, 'A contradiction requires two distinct source passages.');
  }
  return findings;
}

export function validateReviewInput(raw, state, source) {
  const input = contextData(raw);
  keys(input, ['version', 'consumer', 'snapshot', 'head', 'findings', 'comment', 'mentions'], 'chat review');
  requireThat(input.version === 1 && input.consumer === state.consumer && input.snapshot === state.snapshot && input.head === state.head, 'Chat edit has a stale or foreign consumer/source/state binding; reread before editing.');
  const findings = validateFindings(input.findings, state.inventory, source), comment = input.comment ?? null, mentions = input.mentions === undefined ? [] : input.mentions;
  if (comment !== null) boundedText(comment, 'Final comment');
  requireThat(Array.isArray(mentions) && mentions.length <= 30 && mentions.every(value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 320 && !/[\r\n\x00-\x1f<>]/.test(value)) && new Set(mentions.map(value => value.toLowerCase())).size === mentions.length, 'Requested mentions need distinct exact names, account names or ADO identity IDs.');
  return {findings, comment, mentions};
}

function rows(draft, state, source) {
  return draft.findings.map(finding => [
    finding.id + ': ' + finding.finding, finding.type,
    finding.sources.map(reference => {
      const entry = state.inventory.find(item => item.id === reference.requirementId), part = source.parts.find(part => part.id === entry.partId);
      return `${part.sourceId} / ${part.location} (revision ${part.revision}): “${reference.quote}”`;
    }).join('\n'), finding.question
  ]);
}
const columns = ['Findings', 'Type', 'Source material text', 'Question/Comment for Business'];
const markdownCell = value => escapeHtml(value).replaceAll('|', '&#124;').replace(/[\\`*_\[\]{}]/g, '\\$&').replace(/\r\n?|\n/g, '; ');
export function renderChatTable(draft, state, source) {
  return [columns, columns.map(() => '---'), ...rows(draft, state, source)].map(row => '| ' + row.map(markdownCell).join(' | ') + ' |').join('\n');
}
export function renderComment(draft, state, source, mentions) {
  requireThat(draft.comment !== null || draft.findings.length > 0, 'Zero findings has no outgoing comment. Save an explicit final comment only if the user requests one.');
  const htmlText = value => escapeHtml(value).replace(/\r\n?|\n/g, '<br>');
  const body = draft.comment === null
    ? '<table><thead><tr>' + columns.map(value => `<th>${value}</th>`).join('') + '</tr></thead><tbody>' + rows(draft, state, source).map(row => '<tr>' + row.map(value => `<td>${htmlText(value)}</td>`).join('') + '</tr>').join('') + '</tbody></table>'
    : '<p>' + htmlText(draft.comment) + '</p>';
  const recipients = mentions.length ? '<p>' + mentions.map(person => `<a href="#" data-vss-mention="version:2.0,${person.id}">@${escapeHtml(person.displayName)}</a>`).join(' ') + '</p>' : '';
  return {text: draft.comment ?? renderChatTable(draft, state, source), html: recipients + body};
}
