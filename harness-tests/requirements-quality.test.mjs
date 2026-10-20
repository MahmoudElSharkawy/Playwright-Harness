import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {consumerRoots} from '../scripts/lib/consumer-paths.mjs';
import {captureRequirements, prepareRequirements, updateInventory, planningHandoff, readRequirements} from '../scripts/lib/requirements/index.mjs';
import {validateFindings} from '../scripts/lib/requirements/review.mjs';
import {fingerprint} from '../scripts/lib/execution-core/data.mjs';
import {putRequirementFile as put} from './fixtures/requirements.mjs';

const stories = JSON.parse(readFileSync(new URL('./fixtures/requirements-quality.json', import.meta.url)));
for (const story of stories) test(`quality corpus preserves inventory/acceptance boundaries: ${story.id}`, async () => {
  const roots = consumerRoots(mkdtempSync(join(tmpdir(), 'pom-requirements-quality-')));
  put(roots, 'requirements.md', story.text);
  const request = {version: 1, project: 'synthetic-shop', application: story.id, sources: [{id: 'notes', kind: 'file', path: 'requirements.md'}]};
  const source = await captureRequirements(roots, request), state = prepareRequirements(roots, story.id, source);
  assert.equal(state.inventory.length, story.text.split('\n').length);
  assert.equal(new Set(state.inventory.map(entry => entry.id)).size, source.parts.length);
  assert.deepEqual(new Set(state.inventory.map(entry => entry.partId)), new Set(source.parts.map(part => part.id)));
  const findings = story.findings.map(finding => ({...finding, sources: finding.sources.map(({line, quote}) => ({requirementId: state.inventory[line - 1].id, quote}))}));
  validateFindings(findings, state.inventory, source);
  for (const finding of findings) for (const reference of finding.sources) assert(story.text.includes(reference.quote));
  for (const line of story.acceptedByOwner) {
    const entry = state.inventory[line - 1], decision = {version: 1, authority: 'owner', actor: 'Synthetic owner fixture', consumer: state.consumer, snapshot: state.snapshot, requirementId: entry.id, content: entry.content, disposition: 'accepted', statement: source.parts[line - 1].text};
    const path = `owner-${line}.json`; put(roots, path, decision);
    updateInventory(roots, story.id, {version: 1, snapshot: state.snapshot, changes: [{id: entry.id, disposition: 'accepted', evidence: [{kind: 'decision', path, fingerprint: fingerprint(decision)}]}]});
  }
  const plan = planningHandoff(roots, story.id), before = readRequirements(roots, story.id);
  for (const line of story.assessment.unresolvedLines) assert.notEqual(plan.requirements[line - 1].disposition, 'accepted');
  put(roots, 'plan.json', {version: 1, logistics: 'accepted', inventory: plan.inventory, snapshot: plan.snapshot, requirements: plan.requirements.map(({id, revision, content}) => ({id, revision, content}))});
  assert.deepEqual(readRequirements(roots, story.id), before); assert.equal(plan.analysisInvocations, 0);
});
