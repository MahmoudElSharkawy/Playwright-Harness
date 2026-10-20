import {readFileSync, realpathSync, lstatSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {digest, fingerprint, requireThat} from '../execution-core/data.mjs';
import {contextData} from '../context/model.mjs';
import {within} from '../skill-roots.mjs';

export const GAPCUE = Object.freeze({version: '0.3.0', commit: '54fa0180fe17ea5034825a14dbd1201fc129aabf', repository: 'https://github.com/Red-Cloud2000/skills', files: {
  'SKILL.md': '8db86dfb4705631f9680e8316b913766e7cbafedbbcdb641d906f59e8cb46057',
  'scripts/review.mjs': 'e577eb5eec01dd8757ed50e4e01438c5263d173865d5a9ea119d495ee5941170',
  'assets/template.html': 'beca2c476cc2902bcecc82fc738bb26a346b5333efc95d254b241dd12d803d12'
}});
export function resolveGapCue(path) {
  requireThat(typeof path === 'string' && path.length > 0, 'GapCue is missing. Install the pinned version separately and supply --gapcue <skill-directory>; prior state is preserved.');
  let root;
  try {
    root = realpathSync(path);
    for (const [name, hash] of Object.entries(GAPCUE.files)) {
      const file = join(root, name), stat = lstatSync(file);
      requireThat(stat.isFile() && !stat.isSymbolicLink() && within(root, realpathSync(file)) && stat.size <= 2 * 1024 * 1024 && digest(readFileSync(file)) === hash, 'GapCue content differs.');
    }
  } catch {throw new Error('Missing or incompatible GapCue. Use unmodified 0.3.0 at ' + GAPCUE.commit + '; sources and previous reviews are preserved.');}
  return {root, version: GAPCUE.version, commit: GAPCUE.commit, content: fingerprint(GAPCUE.files)};
}
export const escapeHtml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Preserve native rich text exactly, but reject active markup before import/post. */
export function richText(value) {
  requireThat(typeof value === 'string' && Buffer.byteLength(value) <= 65536, 'Review text must be bounded.');
  for (const tag of value.match(/<[^>]*>/g) ?? []) {
    const match = /^<\/?(p|div|span|br|b|strong|i|em|u|s|strike|ul|ol|li|table|thead|tbody|tr|td|th|pre|code|sub|sup)((?:\s+[a-z-]+="[^"<>]*"|\s+[a-z-]+='[^'<>]*')*)\s*\/?>$/i.exec(tag);
    requireThat(match, 'Unsupported active or malformed review HTML.');
    for (const attribute of match[2].matchAll(/([a-z-]+)=(?:"([^"]*)"|'([^']*)')/gi)) {
      requireThat(['style', 'class', 'dir', 'data-q', 'colspan', 'rowspan', 'title', 'start'].includes(attribute[1].toLowerCase()), 'Unsupported review HTML attribute.');
      if (attribute[1].toLowerCase() === 'style') requireThat(!/url|expression|import|\\|&|[<>]/i.test(attribute[2] ?? attribute[3]), 'Active review styles are unsupported.');
    }
  }
  return value;
}
function questionText(value) {
  requireThat(typeof value === 'string' && Buffer.byteLength(value) <= 65536, 'Question text must be bounded.');
  const nativeTags = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'span', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th']);
  // Native questions without rich tags use Markdown, which escapes literal operators/angle brackets.
  if ([...value.matchAll(/<\/?([a-z]+)\b[^>]*>/gi)].some(match => nativeTags.has(match[1].toLowerCase()))) richText(value);
  return value;
}
export function validateFindings(raw, inventory) {
  const findings = contextData(raw), ids = new Set(), requirements = new Set(inventory.map(item => item.id));
  requireThat(Array.isArray(findings) && findings.length <= 500, 'GapCue findings must be a bounded array; zero is valid.');
  for (const finding of findings) {
    requireThat(finding && typeof finding.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(finding.id) && !['__proto__', 'constructor', 'prototype'].includes(finding.id) && !ids.has(finding.id), 'Duplicate or invalid finding ID.'); ids.add(finding.id);
    requireThat(['gap', 'contra'].includes(finding.kind) && ['title', 'why', 'q'].every(key => typeof finding[key] === 'string' && finding[key].trim()), 'Incomplete GapCue finding.');
    questionText(finding.q);
    requireThat(Array.isArray(finding.anchors) && finding.anchors.every(anchor => typeof anchor.text === 'string' && anchor.text.trim()), 'Finding anchors are incomplete.');
    requireThat(finding.kind !== 'contra' || finding.anchors.length >= 2, 'A contradiction requires two source anchors.');
    requireThat(Array.isArray(finding.requirementIds) && finding.requirementIds.length > 0 && finding.requirementIds.every(id => requirements.has(id)), 'Findings must reference the existing inventory.');
  }
  return findings;
}
export function validateDecisions(raw, review) {
  const state = contextData(raw);
  requireThat(state.gapcue === 1 && state.story === review.storyId && state.schema === 2, 'Native export does not match the review identity/schema.');
  requireThat(state.status && typeof state.status === 'object' && !Array.isArray(state.status) && state.qEdit && typeof state.qEdit === 'object' && !Array.isArray(state.qEdit) && Array.isArray(state.custom) && state.custom.length <= 500 && ['all', 'step'].includes(state.mode) && Number.isSafeInteger(state.cur) && state.cur >= 0 && typeof state.dirty === 'boolean' && Number.isSafeInteger(state.updatedAt) && state.updatedAt >= 0 && typeof state.comment === 'string' && state.comment.trim(), 'Incomplete native review handoff. Export through Download decisions after reviewing.');
  const ids = new Set(review.findingIds);
  for (const finding of state.custom) {
    requireThat(typeof finding.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(finding.id) && !['__proto__', 'constructor', 'prototype'].includes(finding.id) && !ids.has(finding.id) && ['gap', 'contra'].includes(finding.kind) && typeof finding.q === 'string' && finding.q.trim() && Array.isArray(finding.anchors), 'Incomplete or duplicate custom finding.'); ids.add(finding.id); questionText(finding.q);
  }
  requireThat(Object.entries(state.status).every(([id, value]) => ids.has(id) && ['approved', 'oos'].includes(value)) && Object.entries(state.qEdit).every(([id, value]) => review.findingIds.includes(id) && typeof value === 'string' && value.trim()), 'Review references unknown findings or decisions.');
  Object.values(state.qEdit).forEach(questionText); richText(state.comment);
  return state;
}
export function buildGapCue(dependency, input, root) {
  const result = spawnSync(process.execPath, [join(dependency.root, 'scripts/review.mjs'), input, '--root', root, '--build-only'], {encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true, env: {...process.env, GAPCUE_NO_UPDATE_CHECK: '1'}});
  requireThat(result.status === 0 && !/anchor not found|anchor overlaps/i.test(result.stdout + result.stderr), 'GapCue build incomplete or source anchors invalid; prepared sources and prior reviews remain available.');
}
