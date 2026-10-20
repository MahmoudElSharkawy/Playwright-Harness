import {contextData} from '../context/model.mjs';
import {keys, requireThat, fingerprint} from '../execution-core/data.mjs';

export const escapeHtml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const boundedText = (value, label) => requireThat(typeof value === 'string' && value.trim() && Buffer.byteLength(value) <= 65536 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), `${label} must be bounded, nonempty plain text.`);

/** AI judgments stay plain data; source excerpts must resolve to the existing inventory. */
export function validateFindings(raw, inventory, source, {legacy = false} = {}) {
  const findings = contextData(raw), ids = new Set();
  requireThat(Array.isArray(findings) && findings.length <= 500, 'Findings must be a bounded array; zero is valid.');
  for (const finding of findings) {
    keys(finding, ['id', 'type', 'severity', 'finding', 'sources', 'question'], 'finding');
    requireThat(typeof finding.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(finding.id) && !['__proto__', 'constructor', 'prototype'].includes(finding.id) && !ids.has(finding.id), 'Duplicate or invalid finding ID.'); ids.add(finding.id);
    requireThat(['Gap', 'Contradiction'].includes(finding.type), 'Finding Type must be Gap or Contradiction.');
    requireThat((legacy && finding.severity === undefined) || ['High', 'Medium', 'Low'].includes(finding.severity), 'Finding Severity must be explicitly High, Medium or Low.');
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
  requireThat(input.version === 2, 'Chat edits require version 2 with an explicit High, Medium or Low severity for each finding.');
  requireThat(input.consumer === state.consumer && input.snapshot === state.snapshot && input.head === state.head, 'Chat edit has a stale or foreign consumer/source/state binding; reread before editing.');
  const findings = validateFindings(input.findings, state.inventory, source), comment = input.comment ?? null, mentions = input.mentions === undefined ? [] : input.mentions;
  if (comment !== null) boundedText(comment, 'Final comment');
  requireThat(Array.isArray(mentions) && mentions.length <= 30 && mentions.every(value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 320 && !/[\r\n\x00-\x1f<>]/.test(value)) && new Set(mentions.map(value => value.toLowerCase())).size === mentions.length, 'Requested mentions need distinct exact names, account names or ADO identity IDs.');
  requireBusinessText({findings, comment});
  return {findings: orderedFindings(findings), comment, mentions};
}

function requireBusinessText(draft) {
  const internal = /(?<![a-z0-9])(?:req-[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?|(?:System|Microsoft\.VSTS)(?:\.[a-z0-9_]*[a-z0-9])+)/i;
  const message = 'Replace internal requirement IDs and ADO field paths with readable finding labels and business text before saving or posting. Saved drafts and exact source quotations remain unchanged.';
  requireThat(draft.findings.every(finding => !internal.test(finding.id)), message);
  const quotes = [...new Set(draft.findings.flatMap(finding => finding.sources.map(reference => reference.quote)))];
  for (const text of [...draft.findings.flatMap(finding => [finding.finding, finding.question]), draft.comment ?? '']) {
    // Literal requirement passages remain source authority, including technical terms.
    for (const match of text.matchAll(new RegExp(internal.source, 'gi'))) requireThat(quotes.some(quote => {
      const start = text.lastIndexOf(quote, match.index);
      return start >= 0 && start + quote.length >= match.index + match[0].length;
    }), message);
  }
}

function sourceLabel(part, source) {
  if (source.origin && part.sourceId === 'story') return ({'System.Title': 'Title', 'System.Description': 'Description', 'Microsoft.VSTS.Common.AcceptanceCriteria': 'Acceptance Criteria'})[part.location] ?? 'Story requirements';
  if (source.origin && part.sourceId === 'discussion') {
    const comment = /^comment:(\d+)$/.exec(part.location);
    return comment ? `Discussion comment ${comment[1]}` : 'Discussion';
  }
  const filename = value => typeof value === 'string' && value.trim() ? value.split(/[\\/]/).at(-1) : null;
  const input = source.request?.sources?.find(item => item.id === part.sourceId);
  if (input) return `File: ${filename(input.path) ?? 'supplied requirements'} (${part.location})`;
  if (part.sourceId.startsWith('ado-attachment-')) {
    const name = filename(source.revisions?.find(item => item.id === part.sourceId)?.name);
    return `Attachment${name ? ': ' + name : ''} (${part.location})`;
  }
  return `Source material (${part.location})`;
}

const severityRank = {High: 0, Medium: 1, Low: 2};
const orderedFindings = findings => findings.toSorted((left, right) => (severityRank[left.severity] ?? 3) - (severityRank[right.severity] ?? 3));
function reviewSummaryLines(draft) {
  const findings = orderedFindings(draft.findings), total = findings.length;
  const gaps = findings.filter(finding => finding.type === 'Gap').length, contradictions = total - gaps;
  const counts = ['High', 'Medium', 'Low'].map(severity => `${severity} ${findings.filter(finding => finding.severity === severity).length}`);
  const unrated = findings.filter(finding => !finding.severity).length;
  if (unrated) counts.push(`Unrated ${unrated}`);
  const overview = `${total} ${total === 1 ? 'finding' : 'findings'}: ${gaps} ${gaps === 1 ? 'gap' : 'gaps'}, ${contradictions} ${contradictions === 1 ? 'contradiction' : 'contradictions'}. Severity: ${counts.join(', ')}.`;
  const priority = !total ? 'No evidenced gaps or contradictions in the reviewed material. Unresolved inventory decisions/source omissions still apply.'
    : unrated ? 'Assign severity to unrated findings before choosing the first priority or posting a new draft.'
    : `First priority: ${findings[0].id}: ${findings[0].finding}`;
  return [overview, priority.replace(/\r\n?|\n/g, '; ')];
}
export const renderReviewSummary = draft => reviewSummaryLines(draft).map(markdownCell).join('\n');
function rows(draft, state, source) {
  return orderedFindings(draft.findings).map(finding => [
    finding.id + ': ' + finding.finding, finding.type, finding.severity ?? 'Unrated',
    finding.sources.map(reference => {
      const entry = state.inventory.find(item => item.id === reference.requirementId), part = source.parts.find(part => part.id === entry.partId);
      return `${sourceLabel(part, source)}: “${reference.quote}”`;
    }).join('\n'), finding.question
  ]);
}
const columns = ['Findings', 'Type', 'Severity', 'Source material text', 'Question/Comment for Business'];
const markdownCell = value => escapeHtml(value).replaceAll('|', '&#124;').replace(/[\\`*_\[\]{}]/g, '\\$&').replace(/\r\n?|\n/g, '; ');
export function renderChatTable(draft, state, source) {
  return [columns, columns.map(() => '---'), ...rows(draft, state, source)].map(row => '| ' + row.map(markdownCell).join(' | ') + ' |').join('\n');
}
export function renderComment(draft, state, source, mentions) {
  requireThat(draft.comment !== null || draft.findings.length > 0, 'Zero findings has no outgoing comment. Save an explicit final comment only if the user requests one.');
  requireBusinessText(draft);
  const htmlText = value => escapeHtml(value).replace(/\r\n?|\n/g, '<br>');
  const body = draft.comment === null
    ? '<table><thead><tr>' + columns.map(value => `<th>${value}</th>`).join('') + '</tr></thead><tbody>' + rows(draft, state, source).map(row => '<tr>' + row.map(value => `<td>${htmlText(value)}</td>`).join('') + '</tr>').join('') + '</tbody></table>'
    : '<p>' + htmlText(draft.comment) + '</p>';
  const recipients = mentions.length ? '<p>' + mentions.map(person => `<a href="#" data-vss-mention="version:2.0,${person.id}">@${escapeHtml(person.displayName)}</a>`).join(' ') + '</p>' : '';
  const summary = renderReviewSummary(draft);
  return {text: summary + '\n\n' + (draft.comment ?? renderChatTable(draft, state, source)), html: recipients + '<p>' + htmlText(reviewSummaryLines(draft).join('\n')) + '</p>' + body};
}
