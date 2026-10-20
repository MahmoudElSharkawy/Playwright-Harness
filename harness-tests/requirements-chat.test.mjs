import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {consumerRoots} from '../scripts/lib/consumer-paths.mjs';
import {captureRequirements, prepareRequirements, readRequirements, saveChatReview, readChatReview, resumeRequirementsReview, saveRequirements, reviewDifferences} from '../scripts/lib/requirements/index.mjs';

async function fixture() {
  const roots = consumerRoots(mkdtempSync(join(tmpdir(), 'pom-chat-')));
  writeFileSync(join(roots.projectRoot, 'story.md'), 'The link expires.\nAllow three attempts.\nAllow five attempts.\n');
  const request = {version: 1, project: 'shop', application: 'checkout', sources: [{id: 'story', kind: 'file', path: 'story.md'}]};
  const state = prepareRequirements(roots, 'checkout', await captureRequirements(roots, request));
  const findings = [{id: 'F-01', type: 'Gap', finding: 'Expiry duration unspecified', sources: [{requirementId: state.inventory[0].id, quote: 'The link expires.'}], question: 'How long should the link remain valid?'}];
  return {roots, state, request, findings};
}
const input = (state, findings, extra = {}) => ({version: 1, consumer: state.consumer, snapshot: state.snapshot, head: state.head, findings, comment: null, mentions: [], ...extra});

test('chat review renders exactly four columns with located exact source quotes and no UI/dependency', async () => {
  const f = await fixture(), result = saveChatReview(f.roots, 'checkout', input(f.state, f.findings));
  assert.match(result.table, /^\| Findings \| Type \| Source material text \| Question\/Comment for Business \|/);
  assert.match(result.table, /F-01: Expiry duration unspecified/); assert.match(result.table, /The link expires\./);
  assert.match(result.table, /story.*lines 1-1/); assert.match(result.table, /How long/);
  assert.equal(result.review.format, 'chat-v1'); assert.equal(result.analysisInvocations, 1);
  assert(!result.page && !result.serve && !result.review.dependency);
  assert(result.inventory.every(entry => entry.disposition === 'unknown'));
});

test('conversational additions, removal, question and comment edits survive fresh-process resume', async () => {
  const f = await fixture(), first = saveChatReview(f.roots, 'checkout', input(f.state, f.findings));
  const contradiction = {id: 'F-02', type: 'Contradiction', finding: 'Conflicting retry limits', sources: [
    {requirementId: first.inventory[1].id, quote: 'Allow three attempts.'}, {requirementId: first.inventory[2].id, quote: 'Allow five attempts.'}], question: 'Which retry limit applies?'};
  const next = saveChatReview(f.roots, 'checkout', input(first, [contradiction], {comment: 'Please clarify retries. Preserve spaces & <Admin>.', mentions: ['ba@example.test']}));
  const draft = readChatReview(f.roots, next);
  assert.equal(draft.parent, first.review.revision); assert.equal(draft.findings.length, 1); assert.equal(draft.findings[0].id, 'F-02');
  assert.deepEqual(draft.mentions, ['ba@example.test']); assert.equal(next.analysisInvocations, 1);
  assert.equal(readChatReview(f.roots, next, first.review).findings[0].question, f.findings[0].question);
  const cli = fileURLToPath(new URL('../scripts/requirements-analysis.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [cli, 'resume', '--id', 'checkout', '--project-root', f.roots.projectRoot], {encoding: 'utf8', windowsHide: true});
  assert.equal(run.status, 0, run.stderr); const resumed = JSON.parse(run.stdout);
  assert.deepEqual(resumed.draft, draft); assert.equal(resumed.analysisInvocations, 1); assert.match(resumed.table, /F-02/); assert(!resumed.table.includes('F-01'));
});

test('stale, foreign and malformed edits preserve the last valid draft', async () => {
  const f = await fixture(), saved = saveChatReview(f.roots, 'checkout', input(f.state, f.findings));
  const invalid = [input(f.state, []), input(saved, [], {consumer: 'foreign'}), input(saved, [], {snapshot: 'stale'}),
    input(saved, [{...f.findings[0], sources: [{requirementId: saved.inventory[0].id, quote: 'Invented source'}]}]),
    input(saved, [{...f.findings[0], type: 'Contradiction'}]), input(saved, [f.findings[0], f.findings[0]]), input(saved, [], {mentions: ['']}), input(saved, [], {extra: true})];
  for (const value of invalid) {assert.throws(() => saveChatReview(f.roots, 'checkout', value)); assert.equal(readRequirements(f.roots, 'checkout').head, saved.head);}
});

test('table cells escape markup, pipes and newlines without losing source/operator meaning', async () => {
  const f = await fixture(); f.findings[0].finding = 'Expiry | <Admin>\n**check**'; f.findings[0].question = 'Does x < 2 & y > 1 apply? <a data-vss-mention="forged">@Name</a>';
  const saved = saveChatReview(f.roots, 'checkout', input(f.state, f.findings));
  assert.match(saved.table, /&#124;/); assert.match(saved.table, /&lt;Admin&gt;/); assert(!saved.table.includes('<a'));
  assert.equal(saved.table.split('\n').length, 3); assert.equal(readChatReview(f.roots, saved).findings[0].question, f.findings[0].question);
});

test('zero findings is valid, does not invent a comment or authorize publication', async () => {
  const f = await fixture(), saved = saveChatReview(f.roots, 'checkout', input(f.state, []));
  assert.equal(readChatReview(f.roots, saved).findings.length, 0); assert.equal(saved.table.split('\n').length, 2);
  assert.equal(readChatReview(f.roots, saved).comment, null); assert.equal(saved.review.status, 'draft');
});

test('refresh retains manual draft history, exposes changed meaning and never carries approval', async () => {
  const f = await fixture(), first = saveChatReview(f.roots, 'checkout', input(f.state, f.findings, {comment: 'My manual final question.'}));
  writeFileSync(join(f.roots.projectRoot, 'story.md'), 'The link expires after an unspecified inactivity period.\nAllow three attempts.\nAllow five attempts.\n');
  const refreshed = prepareRequirements(f.roots, 'checkout', await captureRequirements(f.roots, f.request));
  assert.equal(refreshed.review, null); assert.equal(readChatReview(f.roots, refreshed, refreshed.priorReviews[0]).comment, 'My manual final question.');
  const findings = [{...f.findings[0], finding: 'Inactivity duration unspecified', sources: [{requirementId: refreshed.inventory[0].id, quote: 'unspecified inactivity period'}]}];
  const next = saveChatReview(f.roots, 'checkout', input(refreshed, findings)), diff = reviewDifferences(f.roots, next);
  assert(diff.changedFindingIds.includes('F-01')); assert.equal(diff.previousComment, 'My manual final question.'); assert.deepEqual(diff.carriedDecisions, []);
  assert.equal(next.review.status, 'draft'); assert.equal(next.analysisInvocations, 2);
});

test('tampering with retained draft bytes blocks resume without rewriting state', async () => {
  const f = await fixture(), saved = saveChatReview(f.roots, 'checkout', input(f.state, f.findings));
  const path = join(f.roots.projectRoot, saved.review.path), draft = JSON.parse(readFileSync(path)); draft.findings[0].question = 'Changed meaning'; writeFileSync(path, JSON.stringify(draft));
  assert.throws(() => resumeRequirementsReview(f.roots, 'checkout'), /changed|binding/); assert.equal(readRequirements(f.roots, 'checkout').head, saved.head);
});

test('legacy review artifacts remain intact and cannot authorize the new chat workflow', async () => {
  const f = await fixture(), legacy = {...f.state, review: {reviewId: 'legacy', snapshot: f.state.snapshot, root: 'old-review', dependency: {version: 'old'}, status: 'complete', handoff: {path: 'old-export.json', sha256: 'old'}}};
  const original = '{"comment":"Previous manually edited text"}\n'; writeFileSync(join(f.roots.projectRoot, 'old-export.json'), original);
  const saved = saveRequirements(f.roots, 'checkout', legacy);
  assert.throws(() => resumeRequirementsReview(f.roots, 'checkout'), /legacy|Legacy/);
  const current = saveChatReview(f.roots, 'checkout', input(saved, f.findings));
  assert.equal(current.priorReviews.at(-1).reviewId, 'legacy'); assert.equal(current.review.status, 'draft');
  assert.equal(readFileSync(join(f.roots.projectRoot, 'old-export.json'), 'utf8'), original);
});

test('a near-limit input cannot save a draft that exceeds its resume envelope', async () => {
  const f = await fixture(), saved = saveChatReview(f.roots, 'checkout', input(f.state, f.findings));
  const findings = Array.from({length: 16}, (_, index) => ({...f.findings[0], id: 'F-' + index, question: index < 15 ? 'q'.repeat(65536) : 'q'}));
  const raw = input(saved, findings), before = Buffer.byteLength(JSON.stringify(raw)), target = 1024 * 1024 - 16;
  raw.findings[15].question = 'q'.repeat(target - before + 1);
  assert.equal(Buffer.byteLength(JSON.stringify(raw)), target);
  assert(raw.findings[15].question.length <= 65536);
  assert.throws(() => saveChatReview(f.roots, 'checkout', raw), /byte limit/);
  assert.equal(readRequirements(f.roots, 'checkout').head, saved.head);
  assert.equal(resumeRequirementsReview(f.roots, 'checkout').draft.findings[0].question, f.findings[0].question);
});
