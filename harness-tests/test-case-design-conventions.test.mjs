import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {consumerRoots} from '../scripts/lib/consumer-paths.mjs';
import {prepareDesign} from '../scripts/lib/test-case-design/index.mjs';
import {requireFreshDesign} from '../scripts/lib/test-case-design/sources.mjs';
import {putRequirementFile as put} from './fixtures/requirements.mjs';

const path = '.harness/knowledge/test-case-design-conventions.json';
const profile = () => ({version: 1, project: 'sample', application: 'checkout', status: 'current', agreement: {actor: 'Synthetic owner', reference: 'Retained project agreement'}, defaults: {persona: 'Customer', terminology: {basket: 'cart'}, titleConvention: 'Describe the observable business objective', setupOwnership: 'Disposable case-owned address', dataOwnership: 'Unique per-case and per-run data; secret references only', languages: ['English', 'Arabic']}});
async function fixture(value) {
  const roots = consumerRoots(mkdtempSync(join(tmpdir(), 'pom-design-conventions-')));
  put(roots, 'story.md', 'Saving the address updates the checkout summary.');
  if (value !== undefined) put(roots, path, value);
  const state = await prepareDesign(roots, 'checkout', {version: 1, analysisId: 'checkout', request: {version: 1, project: 'sample', application: 'checkout', sources: [{id: 'story', kind: 'file', path: 'story.md'}]}});
  return {roots, state};
}

test('absent and agreed optional conventions keep local design useful without accepting scope', async () => {
  const absent = await fixture(), agreed = await fixture(profile());
  assert.equal(absent.state.evidence.conventions.status, 'absent');
  assert.equal(agreed.state.evidence.conventions.usable, true);
  assert.deepEqual(agreed.state.evidence.conventions.profile.defaults.languages, ['English', 'Arabic']);
  for (const {state} of [absent, agreed]) {
    assert.equal(state.requirements.inventory.length, 1);
    assert.equal(state.requirements.inventory[0].disposition, 'unknown');
    assert.equal(state.draft, null, 'Defaults and languages never create cases.');
  }
});

test('malformed, stale, conflicting and foreign conventions are diagnostic and not defaults', async () => {
  for (const value of ['{broken', {...profile(), status: 'stale'}, {...profile(), status: 'conflicting'}, {...profile(), project: 'another'}, {...profile(), defaults: {fixtures: ['invented']}}]) {
    const {state} = await fixture(value);
    assert.equal(state.evidence.conventions.usable, false);
    assert(state.evidence.conventions.reason);
    assert.equal(state.requirements.inventory.length, 1);
  }
});

test('convention changes invalidate bound design while keeping earlier evidence immutable', async () => {
  const {roots, state} = await fixture(profile()), before = JSON.stringify(state.evidence.conventions);
  await requireFreshDesign(roots, state);
  put(roots, path, {...profile(), defaults: {...profile().defaults, persona: 'Shopper'}});
  await assert.rejects(requireFreshDesign(roots, state), /conventions.*changed/i);
  assert.equal(JSON.stringify(state.evidence.conventions), before);
});
