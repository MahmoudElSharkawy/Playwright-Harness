import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync, unlinkSync} from 'node:fs';
import {join, isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {designFixture, assessmentFor} from './fixtures/design-local.mjs';
import {retainAssessment} from './fixtures/design-review.mjs';
import {adoDesignFixture} from './fixtures/test-case-design.mjs';
import {saveDesign, readDesign, assessDesign, designView} from '../scripts/lib/test-case-design/index.mjs';
import {previewDesign, publishDesign} from '../scripts/lib/test-case-design/delivery.mjs';
import {renderDesign} from '../scripts/lib/test-case-design/review.mjs';

function delivered(view) {
  assert.equal(view.reviewFile.status, 'written');
  assert(isAbsolute(view.reviewFile.path));
  assert.equal(readFileSync(view.reviewFile.path, 'utf8'), view.rendered.markdown);
  assert(view.rendered.markdown.startsWith(renderDesign(view.draft).markdown));
  assert(view.reviewFile.path.endsWith(`${view.head}.md`));
  return view.rendered.markdown;
}

test('initial local review delivers exact complete tables, long Unicode content and actual identity without changing state', async () => {
  const f = await designFixture();
  f.proposal.cases[0].steps.push(...Array.from({length: 80}, (_, i) => ({action: `Observe ${i} | <b>العربية</b> *literal* [value]`, expected: 'Literal | < > & text remains visible.'})));
  const saved = saveDesign(f.roots, 'login', f.proposal), view = designView(f.roots, 'login'), markdown = delivered(view);
  assert.match(markdown, /Local design: login/); assert(markdown.includes(saved.head)); assert(markdown.includes(saved.proposal));
  assert.match(markdown, /Independent review: not recorded/); assert.match(markdown, /## Gaps/);
  assert.equal(view.rendered.details.length, 3); assert(markdown.includes('env:TEST\\_PASSWORD'));
  assert(markdown.includes('**82**')); assert(markdown.includes('العربية'));
  assert.deepEqual(readDesign(f.roots, 'login'), saved);
});

test('review and proposal revisions produce current copies and preserve older revision files', async () => {
  const f = await designFixture(), saved = saveDesign(f.roots, 'login', f.proposal), initial = designView(f.roots, 'login');
  const assessed = assessDesign(f.roots, 'login', retainAssessment(f.roots, saved, assessmentFor(saved)));
  const reviewed = designView(f.roots, 'login'), reviewedText = delivered(reviewed);
  assert.match(reviewedText, /Independent review: recorded/); assert.match(reviewedText, /3 pass, 0 revise/);
  const changed = {...f.proposal, head: assessed.head, cases: structuredClone(f.proposal.cases)};
  changed.cases[0].title = 'Sign in and verify the correct account';
  saveDesign(f.roots, 'login', changed);
  const revised = designView(f.roots, 'login'), markdown = delivered(revised);
  assert.notEqual(revised.reviewFile.path, reviewed.reviewFile.path);
  assert.match(markdown, /Independent review: not recorded/); assert(markdown.includes(changed.cases[0].title));
  assert.equal(readFileSync(initial.reviewFile.path, 'utf8'), initial.rendered.markdown);
  assert.equal(readFileSync(reviewed.reviewFile.path, 'utf8'), reviewedText);
});

test('advisory notes remain separate and same-state copies refresh notes and missing review evidence', async () => {
  const f = await designFixture(), saved = saveDesign(f.roots, 'login', f.proposal);
  const assessed = assessDesign(f.roots, 'login', retainAssessment(f.roots, saved, assessmentFor(saved)));
  const notes = {gaps: 'The agreed fixture owner still needs confirmation.', suggestions: '- Consider keyboard focus; expected focus order remains undecided.'};
  writeFileSync(join(f.roots.projectRoot, 'notes.json'), JSON.stringify(notes));
  const first = designView(f.roots, 'login', undefined, {notes: 'notes.json'}), markdown = delivered(first);
  assert(markdown.indexOf('## Gaps') > markdown.lastIndexOf('**3. STEPS**'));
  assert(markdown.includes(notes.gaps)); assert(markdown.includes('## Optional quality suggestions\n\n' + notes.suggestions));
  assert.equal(first.rendered.summary.total, 3); assert.equal(first.coverage.complete, true);
  notes.suggestions = 'No additional cases have been requested.';
  writeFileSync(join(f.roots.projectRoot, 'notes.json'), JSON.stringify(notes));
  unlinkSync(join(f.roots.projectRoot, assessed.review.evidence.output.path));
  const current = designView(f.roots, 'login', undefined, {notes: 'notes.json'});
  assert.equal(current.reviewFile.path, first.reviewFile.path); assert.equal(current.coverage.complete, false);
  assert(delivered(current).includes(notes.suggestions)); assert.notEqual(current.rendered.markdown, markdown);
  assert.deepEqual(readDesign(f.roots, 'login'), assessed);
});

test('unavailable artifact directory or notes preserves full chat output and returns no success link', async () => {
  const f = await designFixture(), saved = saveDesign(f.roots, 'login', f.proposal);
  const first = designView(f.roots, 'login', undefined, {notes: 'missing.json'});
  assert.equal(first.reviewFile.status, 'unavailable'); assert.equal(first.reviewFile.path, undefined);
  assert(first.rendered.markdown.startsWith(renderDesign(saved.draft).markdown)); assert.match(first.reviewFile.reason, /notes|ENOENT/i);
  const directory = join(f.roots.projectRoot, '.harness/runs/test-case-design'); mkdirSync(directory, {recursive: true});
  writeFileSync(join(directory, 'login'), 'Artifact directory is unavailable.');
  const view = designView(f.roots, 'login');
  assert.equal(view.reviewFile.status, 'unavailable'); assert.equal(view.reviewFile.path, undefined);
  assert(view.rendered.markdown.startsWith(renderDesign(saved.draft).markdown)); assert.match(view.reviewFile.reason, /Markdown copy/);
  assert.deepEqual(readDesign(f.roots, 'login'), saved);
});

test('malformed notes never expose rejected source text in the file limitation', async () => {
  const f = await designFixture(); saveDesign(f.roots, 'login', f.proposal);
  const sensitive = ['pwd', 'AB12'].join('=');
  writeFileSync(join(f.roots.projectRoot, 'notes.json'), sensitive);
  const view = designView(f.roots, 'login', undefined, {notes: 'notes.json'});
  assert.equal(view.reviewFile.status, 'unavailable'); assert.equal(view.reviewFile.path, undefined);
  assert(!JSON.stringify(view).includes(sensitive));
  assert(view.rendered.markdown.startsWith(renderDesign(view.draft).markdown));
});

test('ADO copies identify the story and preserve recorded partial delivery without additional approval or writes', async t => {
  const f = await adoDesignFixture(t), options = {client: f.client, selected: ['NEW-01']};
  const preview = await previewDesign(f.roots, 'login', options);
  await publishDesign(f.roots, 'login', {...options, approval: preview.fingerprint});
  const before = readDesign(f.roots, 'login'), writes = f.control.writes;
  const view = designView(f.roots, 'login'), markdown = delivered(view);
  assert.match(markdown, /Story: 200/); assert(markdown.includes(preview.fingerprint));
  assert.match(markdown, /NEW-01: applied/); assert(!markdown.includes('101: applied'));
  assert.equal(view.rendered.summary.total, 2); assert.equal(f.control.writes, writes);
  assert.deepEqual(readDesign(f.roots, 'login'), before);
});

test('CLI read delivers the same Markdown with supplied notes; note failures remain successful chat output', async () => {
  const f = await designFixture(); saveDesign(f.roots, 'login', f.proposal);
  writeFileSync(join(f.roots.projectRoot, 'notes.json'), JSON.stringify({suggestions: 'Consider visible focus after the team agrees its expected behavior.'}));
  const invoke = notes => spawnSync(process.execPath, [join(f.roots.packageRoot, 'scripts/test-case-design.mjs'), '--project-root', f.roots.projectRoot, 'read', '--id', 'login', '--notes', notes], {encoding: 'utf8'});
  const success = invoke('notes.json'); assert.equal(success.status, 0, success.stderr); delivered(JSON.parse(success.stdout));
  const failure = invoke('missing.json'); assert.equal(failure.status, 0, failure.stderr);
  const view = JSON.parse(failure.stdout); assert.equal(view.reviewFile.status, 'unavailable'); assert.equal(view.reviewFile.path, undefined); assert.equal(view.rendered.details.length, 3);
});
