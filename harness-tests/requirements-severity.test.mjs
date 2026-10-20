import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {consumerRoots} from '../scripts/lib/consumer-paths.mjs';
import {captureRequirements, prepareRequirements, readRequirements, saveChatReview, readChatReview, resumeRequirementsReview, saveRequirements} from '../scripts/lib/requirements/index.mjs';
import {renderComment} from '../scripts/lib/requirements/review.mjs';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';
import {putRequirementFile as put} from './fixtures/requirements.mjs';

const input = (state, findings, extra = {}) => ({version: 2, consumer: state.consumer, snapshot: state.snapshot, head: state.head, findings, comment: null, mentions: [], ...extra});
async function fixture() {
  const roots = consumerRoots(mkdtempSync(join(tmpdir(), 'pom-severity-')));
  put(roots, 'story.md', 'The link expires.\nAllow three attempts.\nAllow five attempts.\nNames preserve spaces.');
  const request = {version: 1, project: 'shop', application: 'checkout', sources: [{id: 'story', kind: 'file', path: 'story.md'}]};
  const state = prepareRequirements(roots, 'checkout', await captureRequirements(roots, request));
  const gap = (id, severity, finding = 'Expiry duration unspecified') => ({id, type: 'Gap', severity, finding, sources: [{requirementId: state.inventory[0].id, quote: 'The link expires.'}], question: 'How long should the link remain valid?'});
  const findings = [gap('F-low', 'Low'), {id: 'F-high-first', type: 'Contradiction', severity: 'High', finding: 'Core retry limit conflicts', sources: [
    {requirementId: state.inventory[1].id, quote: 'Allow three attempts.'}, {requirementId: state.inventory[2].id, quote: 'Allow five attempts.'}], question: 'Which retry limit applies?'}, gap('F-high-second', 'High'), gap('F-medium', 'Medium')];
  return {roots, state, findings, gap};
}

test('two-line styled summary counts types/severities and table sorts High to Low with stable ties and IDs', async () => {
  const f = await fixture(), saved = saveChatReview(f.roots, 'checkout', input(f.state, f.findings));
  assert.equal(saved.review.format, 'chat-v2'); assert.equal(saved.draft.version, 2);
  assert.deepEqual(saved.summary.split('\\\n'), ['**Summary: 4 findings — 3 gaps, 1 contradiction**', '🔴 **High: 2** · 🟠 **Medium: 1** · 🔵 **Low: 1**']);
  assert.equal(saved.table.split('\n')[0], '| Findings | Type | Severity | Source material text | Question/Comment for Business |');
  const ids = [...saved.table.matchAll(/\| \*\*(F-[a-z-]+):/g)].map(match => match[1]);
  assert.deepEqual(ids, ['F-high-first', 'F-high-second', 'F-medium', 'F-low']);
  assert.deepEqual(saved.draft.findings.map(finding => finding.id), ids); assert.equal(saved.analysisInvocations, 1);
  assert(saved.inventory.every(entry => entry.disposition === 'unknown'));
});

test('add/remove/edit and severity changes recalculate summary/order and survive fresh-process resume', async () => {
  const f = await fixture(), first = saveChatReview(f.roots, 'checkout', input(f.state, f.findings));
  const findings = readChatReview(f.roots, first).findings.filter(finding => finding.id !== 'F-high-first').map(finding => finding.id === 'F-low' ? {...finding, severity: 'High', finding: 'Explicitly promoted business decision'} : finding);
  const next = saveChatReview(f.roots, 'checkout', input(first, [...findings, f.gap('F-new', 'Medium')], {comment: 'My final wording.', mentions: ['ba@example.test']}));
  assert.match(next.summary, /^\*\*Summary: 4 findings — 4 gaps, 0 contradictions\*\*\\\n🔴 \*\*High: 2\*\* · 🟠 \*\*Medium: 2\*\* · 🔵 \*\*Low: 0\*\*/);
  assert(!next.table.includes('F-high-first:')); assert.match(next.table, /F-new:/);
  assert.deepEqual(next.draft.findings.map(finding => finding.id), ['F-high-second', 'F-low', 'F-medium', 'F-new']);
  assert.equal(next.draft.parent, first.review.revision); assert.equal(next.analysisInvocations, 1);
  for (const command of ['read', 'resume']) {
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/requirements-analysis.mjs', import.meta.url)), command, '--id', 'checkout', '--project-root', f.roots.projectRoot], {encoding: 'utf8', windowsHide: true});
    assert.equal(run.status, 0, run.stderr); const resumed = JSON.parse(run.stdout);
    assert.equal(resumed.summary, next.summary); assert.equal(resumed.table, next.table); assert.equal(resumed.draft.comment, 'My final wording.'); assert.deepEqual(resumed.draft.mentions, ['ba@example.test']);
  }
});

test('new findings require explicit valid severity and do not trust a supplied summary', async () => {
  const f = await fixture(), first = saveChatReview(f.roots, 'checkout', input(f.state, f.findings));
  for (const severity of [undefined, null, '', 'Critical', 'high', 1]) {
    const finding = {...f.findings[0]}; if (severity === undefined) delete finding.severity; else finding.severity = severity;
    assert.throws(() => saveChatReview(f.roots, 'checkout', input(first, [finding])), /Severity|severity/);
    assert.equal(readRequirements(f.roots, 'checkout').head, first.head);
  }
  assert.throws(() => saveChatReview(f.roots, 'checkout', input(first, f.findings, {summary: 'Invented summary'})), /unknown|Unknown|Unsupported/i);
});

test('zero-finding summary preserves unresolved acceptance and never creates an automatic outgoing comment', async () => {
  const f = await fixture(), saved = saveChatReview(f.roots, 'checkout', input(f.state, []));
  assert.match(saved.summary, /^\*\*Summary: 0 findings — 0 gaps, 0 contradictions\*\*\\\n🔴 \*\*High: 0\*\* · 🟠 \*\*Medium: 0\*\* · 🔵 \*\*Low: 0\*\*/);
  assert.match(saved.summary, /reviewed material/); assert(!saved.summary.includes('requirements are complete'));
  assert.equal(saved.table.split('\n').length, 2); assert(saved.inventory.every(entry => entry.disposition === 'unknown'));
  assert.throws(() => renderComment(saved.draft, saved, {}, []), /Zero findings/);
});

test('summary precedes final table/body and source-derived finding titles stay escaped in ADO markup', async () => {
  const f = await fixture(); f.findings[1].finding = 'Core <Admin> & retry | conflict';
  const saved = saveChatReview(f.roots, 'checkout', input(f.state, f.findings)), source = await captureRequirements(f.roots, {version: 1, project: 'shop', application: 'checkout', sources: [{id: 'story', kind: 'file', path: 'story.md'}]});
  const result = renderComment(saved.draft, saved, source, []);
  assert.equal(result.text, saved.summary + '\n\n' + saved.table);
  assert(result.html.indexOf('Summary: 4 findings') < result.html.indexOf('<table>')); assert.match(result.html, /<th>Type<\/th><th>Severity<\/th>/);
  assert.match(result.html, /Core &lt;Admin&gt; &amp; retry \| conflict/); assert(!result.html.includes('<Admin>'));
  const manual = renderComment({...saved.draft, comment: 'Keep my <manual> wording.'}, saved, source, []);
  assert.equal(manual.text, saved.summary + '\n\nKeep my &lt;manual&gt; wording\\.'); assert.match(manual.html, /<p>Keep my &lt;manual&gt; wording\.<\/p>/);
});

test('multiline finding titles stay outside the summary and cannot consume the chat table or double-escape ADO text', async () => {
  const f = await fixture(), finding = 'Missing <Admin> & | marker\n```'; f.findings[1].finding = finding;
  const saved = saveChatReview(f.roots, 'checkout', input(f.state, f.findings));
  assert.equal(saved.summary.split('\n').length, 2); assert(!saved.summary.includes('Missing')); assert(!saved.summary.includes('First priority'));
  assert(saved.table.includes('\\`\\`\\`')); assert(saved.table.includes('&lt;Admin&gt; &amp; &#124; marker; '));
  assert.equal(readChatReview(f.roots, saved).findings[0].finding, finding);
  const source = await captureRequirements(f.roots, {version: 1, project: 'shop', application: 'checkout', sources: [{id: 'story', kind: 'file', path: 'story.md'}]});
  const comment = renderComment(saved.draft, saved, source, []);
  assert.equal(comment.text, saved.summary + '\n\n' + saved.table);
  assert(comment.html.includes('Missing &lt;Admin&gt; &amp; | marker<br>```'));
  assert(!comment.html.includes('&amp;lt;Admin')); assert(!comment.html.includes('\\`\\`\\`'));
});

test('prior unrated chat drafts stay readable and unchanged until explicitly rated without reanalysis', async () => {
  const f = await fixture(), findings = f.findings.map(({severity, ...finding}) => finding), reviewId = 'prior-unrated';
  const draft = {version: 1, analysisId: 'checkout', consumer: f.state.consumer, snapshot: f.state.snapshot, reviewId, parent: null,
    inventory: f.state.inventory.map(({id, partId, start, end}) => ({id, partId, start, end})), findings, comment: 'Prior manual wording.', mentions: ['ba@example.test']};
  const revision = fingerprint(draft), path = `.harness/state/requirements/checkout/reviews/${reviewId}/${revision}.json`;
  const bytes = JSON.stringify(draft, null, 4) + '\n'; put(f.roots, path, bytes);
  const state = saveRequirements(f.roots, 'checkout', {...f.state, analysisInvocations: 1, review: {format: 'chat-v1', reviewId, revision, path, snapshot: f.state.snapshot, status: 'draft'}});
  const resumed = resumeRequirementsReview(f.roots, 'checkout');
  assert.match(resumed.summary, /Unrated: 4/); assert.match(resumed.table, /Unrated/); assert.equal(readFileSync(join(f.roots.projectRoot, path), 'utf8'), bytes);
  const next = saveChatReview(f.roots, 'checkout', input(state, f.findings, {comment: draft.comment, mentions: draft.mentions}));
  assert.equal(next.review.reviewId, reviewId); assert.equal(next.draft.parent, revision); assert.equal(next.analysisInvocations, 1);
  assert.equal(next.draft.comment, draft.comment); assert.deepEqual(next.draft.mentions, draft.mentions);
  assert.equal(readChatReview(f.roots, next, state.review).version, 1); assert.equal(readFileSync(join(f.roots.projectRoot, path), 'utf8'), bytes);
});
