import {mkdirSync, writeFileSync, existsSync, unlinkSync, openSync, closeSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {consumerPath} from '../consumer-paths.mjs';
import {commitFile, readBounded} from '../execute/storage.mjs';
import {contextData} from '../context/model.mjs';
import {keys, requireThat} from '../execution-core/data.mjs';
import {markdownText} from '../reporting/text.mjs';
import {designDeliveries, readableReference, renderPublication} from './review.mjs';

/** Derived review output only: no proposal, assessment, approval or delivery writes. */
export function withReviewCopy(roots, view, {notes, lockHeld = false, publication} = {}) {
  const origin = view.evidence.requirements.origin, review = view.review;
  const identity = [
    origin ? `Story: ${origin.storyId} (${markdownText(view.requirements.project)}); design: ${view.id}` : `Local design: ${view.id}`,
    review ? `Independent review: recorded by ${markdownText(review.reviewer)}; ${review.cases.filter(row => row.verdict === 'pass').length} pass, ${review.cases.filter(row => row.verdict === 'revise').length} revise.` : 'Independent review: not recorded.',
    `Retained review evidence: ${view.coverage.reviewEvidence.valid ? 'valid' : markdownText(view.coverage.reviewEvidence.reason)}`,
    `Assessed coverage: ${view.coverage.complete ? 'complete' : 'incomplete'} (${markdownText(view.coverage.basis)}).`,
    ...designDeliveries(view).flatMap(delivery => delivery.outcomes.map(row => `${row.caseId}: ${row.status}`)),
    'This file shows the current saved version and is refreshed after review, edits, assessment and reads.',
    'Derived review copy only. Generating this file does not approve cases, publish them or establish execution readiness.',
  ];
  const gaps = view.coverage.gaps.map(row => `- ${markdownText(readableReference(view, row.requirementId))} (${row.status}): ${markdownText(row.reason)}`);
  for (const row of review?.cases ?? []) if (row.verdict === 'revise') gaps.push(`- ${row.id}: ${markdownText(row.reason)}`);
  const sections = [view.rendered.markdown, '## Review identity\n\n' + identity.join('\n\n')];
  if (view.duplicates.length) sections.push('## Duplicate review\n\n' + view.duplicates.map(group => {
    const decision = review?.duplicates?.find(row => row.id === group.id);
    return `- ${group.cases.map(row => row.id).join(', ')}: ${decision ? `${decision.verdict}; ${markdownText(decision.reason)}` : 'independent decision required'}`;
  }).join('\n'));
  if (gaps.length) sections.push('## Case decisions and limitations\n\n' + gaps.join('\n'));
  const native = publication && renderPublication(publication, view);
  if (native) sections.push(native.markdown);
  const rendered = {...view.rendered, markdown: sections.join('\n\n') + '\n'};
  const chatSections = [view.rendered.summaryText, view.rendered.overview, view.rendered.optionalTitles, ...identity.slice(0, 4)];
  if (gaps.length) chatSections.push('**Case decisions and limitations**\n\n' + gaps.join('\n'));
  if (view.duplicates.length) chatSections.push('**Duplicate decisions**\n\n' + view.duplicates.map(group => {
    const decision = review?.duplicates?.find(row => row.id === group.id);
    return `- ${group.cases.map(row => row.id).join(', ')}: ${decision ? `${decision.verdict}; ${markdownText(decision.reason)}` : 'independent decision required'}`;
  }).join('\n'));
  for (const row of review?.optionalDrafts ?? []) if (row.verdict !== 'supported') chatSections.push(`- Optional draft ${markdownText(row.id)} (${row.verdict}): ${markdownText(row.reason)}`);
  let limitation = 'Review notes could not be read or validated.', descriptor;
  try {
    if (notes !== undefined) {
      const supplied = contextData(readBounded(consumerPath(roots, notes), 65536), 65536);
      keys(supplied, ['gaps', 'suggestions'], 'review notes');
      for (const [key, title] of [['gaps', 'Gaps'], ['suggestions', 'Optional quality suggestions']]) if (supplied[key] !== undefined) {
        requireThat(typeof supplied[key] === 'string' && supplied[key].trim(), 'Review notes must be nonempty Markdown text.');
        rendered.markdown += `${key === 'gaps' && gaps.length ? '\n' : `\n## ${title}\n\n`}${supplied[key]}\n`;
        chatSections.push(`**${title}:** ${supplied[key]}`);
      }
    }
    limitation = 'The design changed or another operation is active; read the current design again.';
    const lock = consumerPath(roots, `.harness/state/test-case-design/${view.id}/lock`);
    if (!lockHeld) descriptor = openSync(lock, 'wx', 0o600);
    limitation = 'The design changed or another operation is active; read the current design again.';
    requireThat(readBounded(consumerPath(roots, `.harness/state/test-case-design/${view.id}/current.json`)).head === view.head, 'Stale design view.');
    limitation = 'The consumer Markdown file could not be written.';
    const path = consumerPath(roots, `.harness/runs/test-case-design/${view.id}/review.md`);
    mkdirSync(dirname(path), {recursive: true, mode: 0o700});
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {writeFileSync(temporary, rendered.markdown, {flag: 'wx', mode: 0o600, flush: true}); commitFile(temporary, path);}
    finally {if (existsSync(temporary)) unlinkSync(temporary);}
    rendered.chatSummary = [...chatSections, `**Full details:** [Current Markdown review](<${path}>) — shows the current saved version.`].filter(Boolean).join('\n\n');
    return {...view, rendered, reviewFile: {status: 'written', path}, ...(native ? {nativePreview: native.nativePreview} : {})};
  } catch {
    rendered.chatSummary = [...chatSections, `Markdown copy was not delivered. ${limitation} Complete case details remain available through an explicit detailed read (default JSON).`].filter(Boolean).join('\n\n');
    return {...view, rendered, reviewFile: {status: 'unavailable', reason: `Markdown copy was not delivered. ${limitation}`}, ...(native ? {nativePreview: native.nativePreview} : {})};
  } finally {
    if (descriptor !== undefined) {closeSync(descriptor); unlinkSync(consumerPath(roots, `.harness/state/test-case-design/${view.id}/lock`));}
  }
}
