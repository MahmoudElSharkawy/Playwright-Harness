import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {consumerRoots} from '../scripts/lib/consumer-paths.mjs';
import {captureRequirements, prepareRequirements, readRequirements, readChatReview, saveChatReview, saveRequirements, resumeRequirementsReview} from '../scripts/lib/requirements/index.mjs';
import {renderChatTable, renderComment, validateReviewInput} from '../scripts/lib/requirements/review.mjs';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';
import {putRequirementFile as put, chatInput} from './fixtures/requirements.mjs';

const reportedId = 'req-70d3b394275978d0a3db7e54b2d900711ed8cb8bf61fc67d';
function displayFixture() {
  const attachment = 'ado-attachment-12345678-1234-1234-1234-123456789012';
  const parts = [
    {sourceId: 'story', location: 'System.Title', kind: 'context', text: 'Manage saved addresses'},
    {sourceId: 'story', location: 'System.Description', kind: 'requirement', text: 'Save the address.'},
    {sourceId: 'story', location: 'Microsoft.VSTS.Common.AcceptanceCriteria', kind: 'criterion', text: 'Allow three addresses.'},
    {sourceId: 'discussion', location: 'comment:17', kind: 'discussion', text: 'Which address formats are supported?'},
    {sourceId: attachment, location: 'page 2 paragraph 1', kind: 'requirement', text: 'Allow five addresses.'},
    {sourceId: 'notes-machine-ref', location: 'lines 2-3', kind: 'requirement', text: 'Show the saved name.'}
  ].map((part, index) => ({...part, id: fingerprint({index}), revision: 'a'.repeat(64)}));
  const source = {origin: {storyId: 200}, request: {sources: [{id: 'notes-machine-ref', path: 'notes/requirements & limits.md', kind: 'file'}]}, revisions: [{id: attachment, name: 'rules & limits.pdf'}], parts};
  const inventory = parts.map(part => ({id: 'req-' + part.id.slice(0, 24), partId: part.id, start: 0, end: part.text.length}));
  const state = {consumer: 'consumer', snapshot: 'snapshot', head: 'head', inventory};
  const findings = parts.map((part, index) => ({id: 'F-0' + (index + 1), type: 'Gap', severity: 'Medium', finding: 'Clarify supported behavior', sources: [{requirementId: inventory[index].id, quote: part.text}], question: 'Which outcome is accepted?'}));
  return {source, state, draft: {findings, comment: null, mentions: []}};
}

test('chat and posted table use readable source labels without field paths, source IDs or revision hashes', () => {
  const f = displayFixture(), before = structuredClone(f), table = renderChatTable(f.draft, f.state, f.source), comment = renderComment(f.draft, f.state, f.source, []);
  for (const output of [table, comment.text, comment.html]) {
    for (const label of ['Title:', 'Description:', 'Acceptance Criteria:', 'Discussion comment 17:', 'rules &amp; limits.pdf', 'requirements &amp; limits.md', 'page 2 paragraph 1', 'lines 2-3']) assert(output.includes(label), label);
    for (const internal of ['System.Title', 'System.Description', 'Microsoft.VSTS.Common.AcceptanceCriteria', 'story /', 'notes-machine-ref', 'ado-attachment-', 'comment:17', 'revision', 'a'.repeat(64), ...f.state.inventory.map(item => item.id)]) assert(!output.includes(internal), internal);
  }
  assert.deepEqual(f, before); assert.match(table, /F-01: Clarify/);
});

test('attachment provenance remains readable when an old snapshot lacks a filename', () => {
  const f = displayFixture(); f.source.revisions = [];
  const output = renderChatTable(f.draft, f.state, f.source);
  assert.match(output, /Attachment.*page 2 paragraph 1/); assert(!output.includes('ado-attachment-'));
});

test('new drafts reject internal IDs and ADO field paths outside exact source quotations', () => {
  const f = displayFixture();
  const cases = [
    {findings: [{...f.draft.findings[0], id: reportedId}]},
    {findings: [{...f.draft.findings[0], finding: 'Issue in ' + reportedId}]},
    {findings: [{...f.draft.findings[0], question: 'Clarify req-address-limit.'}]},
    {findings: [{...f.draft.findings[0], question: 'Clarify Microsoft.VSTS.Common.AcceptanceCriteria.'}]},
    {comment: 'See story / System.Description.'}, {comment: 'Source requirement: ' + reportedId}
  ];
  for (const extra of cases) assert.throws(() => validateReviewInput(chatInput(f.state, f.draft.findings, extra), f.state, f.source), /internal|readable/i);
});

test('literal technical source quotations remain exact in findings, manual text and outgoing HTML', () => {
  const f = displayFixture(), quote = 'The payload includes System.Description and literal ' + reportedId + ' values.';
  f.source.parts[0].text = quote; f.state.inventory[0].end = quote.length;
  const finding = {...f.draft.findings[0], sources: [{requirementId: f.state.inventory[0].id, quote}], question: `Does “${quote}” apply to every payload?`};
  const input = validateReviewInput(chatInput(f.state, [finding], {comment: `Please clarify “${quote}”.`}), f.state, f.source);
  const comment = renderComment(input, f.state, f.source, []);
  assert(comment.text.includes(quote)); assert(comment.html.includes(quote)); assert.equal(input.findings[0].sources[0].quote, quote);
});

test('a partial source quotation cannot exempt a longer internal identifier in manual text', () => {
  for (const [quote, text, comment] of [['System', 'The System saves addresses.', 'Source: story / System.Description.'], ['req', 'A required address.', 'See ' + reportedId]]) {
    const f = displayFixture(); f.source.parts[0].text = text; f.state.inventory[0].end = text.length;
    const finding = {...f.draft.findings[0], sources: [{requirementId: f.state.inventory[0].id, quote}]};
    assert.throws(() => validateReviewInput(chatInput(f.state, [finding], {comment}), f.state, f.source), /internal|readable/i);
  }
});

test('formatting underscores cannot hide internal references in new drafts or final comments', () => {
  const f = displayFixture();
  for (const extra of [{comment: `See _${reportedId}_.`}, {comment: 'See _System.Description_.'}, {findings: [{...f.draft.findings[0], id: '_' + reportedId}]}, {findings: [{...f.draft.findings[0], question: 'Clarify _Microsoft.VSTS.Common.AcceptanceCriteria_.'}]}]) {
    assert.throws(() => validateReviewInput(chatInput(f.state, f.draft.findings, extra), f.state, f.source), /internal|readable/i);
    assert.throws(() => renderComment({...f.draft, ...extra}, f.state, f.source, []), /internal|readable/i);
  }
});

test('exact technical source terms remain valid beside ordinary punctuation and formatting', () => {
  const f = displayFixture(), quote = 'System.Description'; f.source.parts[0].text = quote; f.state.inventory[0].end = quote.length;
  const finding = {...f.draft.findings[0], sources: [{requirementId: f.state.inventory[0].id, quote}]};
  for (const comment of ['Please keep System.Description.', 'Please keep _System.Description_.']) {
    const draft = validateReviewInput(chatInput(f.state, [finding], {comment}), f.state, f.source);
    assert(renderComment(draft, f.state, f.source, []).html.includes(comment));
  }
});

test('rejected display edits preserve the current draft and its traceability references', async () => {
  const roots = consumerRoots(mkdtempSync(join(tmpdir(), 'pom-display-'))); put(roots, 'story.md', 'Save the address.');
  const source = await captureRequirements(roots, {version: 1, project: 'shop', application: 'addresses', sources: [{id: 'notes', path: 'story.md', kind: 'file'}]});
  const state = prepareRequirements(roots, 'addresses', source), finding = {id: 'F-01', type: 'Gap', severity: 'Medium', finding: 'Address format unspecified', sources: [{requirementId: state.inventory[0].id, quote: 'Save the address.'}], question: 'Which address formats are supported?'};
  const first = saveChatReview(roots, 'addresses', chatInput(state, [finding])), bytes = readFileSync(join(roots.projectRoot, first.review.path), 'utf8');
  assert.throws(() => saveChatReview(roots, 'addresses', chatInput(first, [finding], {comment: 'See ' + reportedId})), /internal|readable/i);
  assert.equal(readRequirements(roots, 'addresses').head, first.head); assert.equal(readFileSync(join(roots.projectRoot, first.review.path), 'utf8'), bytes);
  assert.equal(readChatReview(roots, first).findings[0].sources[0].requirementId, state.inventory[0].id);

  const oldDraft = {...first.draft, comment: 'Previously saved internal reference ' + reportedId}, revision = fingerprint(oldDraft), path = `.harness/state/requirements/addresses/reviews/${oldDraft.reviewId}/${revision}.json`, oldBytes = JSON.stringify(oldDraft, null, 4) + '\n';
  put(roots, path, oldBytes); const old = saveRequirements(roots, 'addresses', {...readRequirements(roots, 'addresses'), review: {...first.review, revision, path}});
  assert.equal(resumeRequirementsReview(roots, 'addresses').draft.comment, oldDraft.comment);
  assert.throws(() => renderComment(readChatReview(roots, old), old, source, []), /internal|readable/i);
  assert.equal(readFileSync(join(roots.projectRoot, path), 'utf8'), oldBytes);
});
