import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest, fingerprint} from '../../scripts/lib/execution-core/data.mjs';
import {facts, RECIPE} from '../../scripts/lib/context/model.mjs';
import {prepareSnapshot} from '../../scripts/lib/context/storage.mjs';
import {buildIndex} from '../../scripts/lib/context/search.mjs';

/** The pre-112 native line recipe, without invoking the current native reader. */
export function legacyDocuments(roots, input, documents) {
  const now = '2026-10-01T00:00:00Z';
  const sources = documents.map(({id, path, text}) => ({id, kind: 'file', path, name: path, origin: 'user-supplied', selectedFor: 'business-context',
    hash: digest(text), extractionRecipe: 'native', recipeVersion: RECIPE,
    recipe: fingerprint({version: RECIPE, extension: path.split('.').at(-1), extractionRecipe: 'native', encoding: 'utf-8', delimiter: null, authority: null}),
    reader: 'native', status: 'verified', coverage: 'complete', retrievedAt: now, verifiedAt: now,
    contributions: text.split(/\r?\n/).flatMap((text, index) => text.trim() ? [{topic: `content-${fingerprint(text)}`, text, location: `lines ${index + 1}-${index + 1}`, authority: 'observation'}] : [])}));
  const snapshot = {...input, version: 2, sources, facts: facts(sources), selections: {}, capturedAt: now, updatedAt: now, status: 'complete'};
  const prepared = prepareSnapshot(roots, snapshot); prepared.manifest.index = buildIndex(roots, prepared, snapshot); prepared.manifest.revision = fingerprint(prepared.manifest);
  writeFileSync(join(roots.projectRoot, `.harness/context/${input.contextId}/current.json`), JSON.stringify(prepared.manifest));
  return prepared.manifest;
}
