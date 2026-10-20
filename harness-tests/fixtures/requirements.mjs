import {mkdirSync, writeFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {readRequirements, readRequirementsSource, saveChatReview} from '../../scripts/lib/requirements/index.mjs';

export const putRequirementFile = (roots, path, value) => {
  const file = join(roots.projectRoot, path); mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); return path;
};
export const chatInput = (state, findings, extra = {}) => ({version: 2, consumer: state.consumer, snapshot: state.snapshot, head: state.head, findings, comment: null, mentions: [], ...extra});
export function bindChatReview(roots, analysisId = 'checkout', extra = {}) {
  const state = readRequirements(roots, analysisId), source = readRequirementsSource(roots, state), entry = state.inventory.find(item => item.kind !== 'context' && item.kind !== 'discussion') ?? state.inventory[0];
  const part = source.parts.find(part => part.id === entry.partId);
  const findings = [{id: 'F-01', type: 'Gap', severity: 'Medium', finding: 'Missing target', sources: [{requirementId: entry.id, quote: part.text.slice(entry.start, entry.end)}], question: 'What is the accepted target?'}];
  return saveChatReview(roots, analysisId, chatInput(state, findings, {comment: 'Manual final question: which target is accepted?', ...extra}));
}
