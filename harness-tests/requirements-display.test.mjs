import test from 'node:test';
import assert from 'node:assert/strict';
import {renderChatTable, renderComment, renderReviewSummary, validateReviewInput} from '../scripts/lib/requirements/review.mjs';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';
import {chatInput} from './fixtures/requirements.mjs';

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

test('generated finding IDs stay internal while readable labels and stored references remain intact', () => {
  const f = displayFixture(); f.draft.findings[0].id = reportedId;
  const before = structuredClone(f);
  for (const output of [renderChatTable(f.draft, f.state, f.source), renderReviewSummary(f.draft)]) assert(!output.includes(reportedId));
  const draft = validateReviewInput(chatInput(f.state, f.draft.findings), f.state, f.source), comment = renderComment(draft, f.state, f.source, []);
  for (const output of [comment.text, comment.html]) {assert(!output.includes(reportedId)); assert(output.includes('F-02: Clarify'));}
  assert.match(comment.text, /\*\*First priority:\*\* \*\*Clarify supported behavior\*\*/);
  assert.equal(draft.findings[0].id, reportedId); assert.deepEqual(f, before);
});

test('free-form findings, questions, manual comments and source quotes retain technical wording without scanning', () => {
  const f = displayFixture(), quote = 'System.Description'; f.source.parts[0].text = quote; f.state.inventory[0].end = quote.length;
  const finding = {...f.draft.findings[0], finding: 'Discuss ' + reportedId, question: 'Clarify Microsoft.VSTS.Common.AcceptanceCriteria.', sources: [{requirementId: f.state.inventory[0].id, quote}]};
  const text = `See _${reportedId}_ and System.Description <current>.`;
  const draft = validateReviewInput(chatInput(f.state, [finding], {comment: text}), f.state, f.source), comment = renderComment(draft, f.state, f.source, []);
  assert.deepEqual(draft.findings, [finding]); assert.equal(draft.comment, text); assert(comment.text.includes(text));
  assert(comment.html.includes(`See _${reportedId}_ and System.Description &lt;current&gt;.`));
  assert(renderChatTable(draft, f.state, f.source).includes('Title: “System.Description”'));
});

test('emphasis uses bold titles, named severity dots and only the selected question phrase in chat and ADO', () => {
  const f = displayFixture(); f.draft.findings = f.draft.findings.slice(0, 3);
  for (const [index, severity] of ['High', 'Medium', 'Low'].entries()) Object.assign(f.draft.findings[index], {severity, question: 'What is the maximum retry count?', questionFocus: 'maximum retry count'});
  const before = structuredClone(f), table = renderChatTable(f.draft, f.state, f.source), comment = renderComment(f.draft, f.state, f.source, []);
  assert.match(table, /\| \*\*F-01: Clarify supported behavior\*\* \| Gap \| \*\*🔴 High\*\*/);
  for (const severity of ['🟠 Medium', '🔵 Low']) assert(table.includes(`**${severity}**`));
  assert(table.includes('What is the **maximum retry count**?')); assert(!table.includes('**What is the'));
  assert(comment.html.includes('<td><strong>F-01: Clarify supported behavior</strong></td><td>Gap</td><td><strong>🔴 High</strong></td>'));
  assert(comment.html.includes('What is the <strong>maximum retry count</strong>?'));
  assert(comment.html.includes('<p><strong>Summary: 3 findings — 3 gaps, 0 contradictions</strong><br>🔴 <strong>High: 1</strong>'));
  assert(comment.html.includes('<td>Title: “Manage saved addresses”</td>')); assert(!/style=|<font|background|<span/.test(comment.html));
  assert.deepEqual(f, before);
});

test('emphasis escapes literal markup before wrapping focus text and keeps manual bodies verbatim', () => {
  const f = displayFixture(), finding = f.draft.findings[0];
  Object.assign(finding, {finding: '<strong>literal</strong> **words**', question: 'Does <Admin> & **literal** apply?', questionFocus: '<Admin> & **literal**'});
  const draft = validateReviewInput(chatInput(f.state, [finding]), f.state, f.source), comment = renderComment(draft, f.state, f.source, []);
  assert(comment.text.includes('Does **&lt;Admin&gt; &amp; \\*\\*literal\\*\\*** apply?'));
  assert(comment.html.includes('Does <strong>&lt;Admin&gt; &amp; **literal**</strong> apply?'));
  assert(!comment.html.includes('<Admin>')); assert(!comment.html.includes('<strong>literal</strong>'));
  const manual = renderComment({...draft, comment: 'Keep **my** <manual> wording.'}, f.state, f.source, []);
  assert(manual.text.endsWith('Keep **my** <manual> wording.')); assert(manual.html.endsWith('<p>Keep **my** &lt;manual&gt; wording.</p>'));
});

test('Markdown emphasis preserves punctuation, adjacent focus matches and title whitespace', () => {
  const f = displayFixture(), finding = {...f.draft.findings[0], finding: 'Retry policy '};
  for (const [question, questionFocus, markdown, html] of [
    ['Use ABAB?', 'AB', 'Use **ABAB**?', 'Use <strong>ABAB</strong>?'],
    ['Test ** x?', '*', 'Test **\\*\\*** x?', 'Test <strong>**</strong> x?'],
    ['Use C++ rules?', '++', 'Use C++ rules?', 'Use C++ rules?'],
    ['Use ++C rules?', '++', 'Use ++C rules?', 'Use ++C rules?'],
    ['😀*?', '*', '😀\\*?', '😀*?'],
    ['😀x', '😀', '😀x', '😀x'],
    ['*😀', '*', '\\*😀', '*😀'],
    ['€++', '++', '€**++**', '€<strong>++</strong>'],
    ['Does **retry count** apply?', 'retry count', 'Does \\*\\***retry count**\\*\\* apply?', 'Does **<strong>retry count</strong>** apply?']
  ]) {
    const draft = {...f.draft, findings: [{...finding, question, questionFocus}]}, comment = renderComment(draft, f.state, f.source, []);
    assert(comment.text.includes(` | ${markdown} |`), question);
    assert(comment.html.includes(`<td>${html}</td>`), question);
    assert(comment.text.includes('| **F-01: Retry policy**  |'));
    assert.equal(draft.findings[0].finding, 'Retry policy '); assert.equal(draft.findings[0].question, question);
  }
});

test('chat summary uses explicit Markdown hard breaks for three visible lines', () => {
  const f = displayFixture(), summary = renderReviewSummary(f.draft);
  assert.equal(summary.split('\\\n').length, 3);
});
