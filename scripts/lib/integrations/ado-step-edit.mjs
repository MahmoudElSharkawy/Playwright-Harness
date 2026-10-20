// A deliberately narrow, lossless ordinary-step editor. The tolerant fetch parser
// is not a write contract: unknown XML must never silently disappear in a PATCH.
import {requireValue, adoId} from './config.mjs';
import {keys} from '../project-config.mjs';
import {emptyAdoMetadata} from './ado-metadata.mjs';
import {htmlToText} from './ado-steps.mjs';

const fail = condition => requireValue(condition, 'Unsupported or malformed ADO step XML; use ordinary steps without shared references, parameters or embedded content.');
const bounded = value => typeof value === 'string' && Buffer.byteLength(value) <= 65536;
const xmlCharacters = value => !/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
function decode(value) {
  fail(!/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(value) && xmlCharacters(value));
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g, (_, name) => {
    if (!name.startsWith('#')) return {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"}[name];
    const code = name.startsWith('#x') ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    fail(Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff));
    const result = String.fromCodePoint(code); fail(xmlCharacters(result)); return result;
  });
}
/** Bounded XML fragments, with offsets for byte-preserving replacements. No DTD,
 * entities, comments, CDATA or processing instructions are accepted. */
function xmlNodes(xml) {
  fail(typeof xml === 'string' && Buffer.byteLength(xml) <= 2 * 1024 * 1024 && xmlCharacters(xml));
  const roots = [], stack = []; let position = 0, count = 0;
  const token = /<\/?([A-Za-z][\w.:-]*)(?:\s+[A-Za-z][\w.:-]*\s*=\s*(?:"[^"]*"|'[^']*'))*\s*\/?>/y;
  while (position < xml.length) {
    const next = xml.indexOf('<', position), end = next < 0 ? xml.length : next;
    const text = xml.slice(position, end); fail(!text.includes(']]>')); decode(text);
    if (text.trim()) {fail(stack.length > 0); stack.at(-1).text = true;}
    if (next < 0) break;
    token.lastIndex = next; const match = token.exec(xml); fail(match && ++count <= 25000);
    const raw = match[0], close = raw.startsWith('</'), self = raw.endsWith('/>'), name = match[1];
    if (close) {
      fail(!self && /^<\/[A-Za-z][\w.:-]*\s*>$/.test(raw));
      const node = stack.pop(); fail(node && node.name === name); node.closeStart = next; node.end = token.lastIndex;
    } else {
      const attrs = {};
      for (const attr of raw.matchAll(/([A-Za-z][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        fail(!Object.hasOwn(attrs, attr[1]) && !/[<>]/.test(attr[2] ?? attr[3])); attrs[attr[1]] = decode(attr[2] ?? attr[3]);
      }
      const node = {name, attrs, start: next, openEnd: token.lastIndex, closeStart: self ? token.lastIndex : undefined, end: self ? token.lastIndex : undefined, children: [], text: false};
      (stack.length ? stack.at(-1).children : roots).push(node);
      if (!self) {stack.push(node); fail(stack.length <= 30);}
    }
    position = token.lastIndex;
  }
  fail(stack.length === 0); return roots;
}
function formatted(html) {
  fail(bounded(html) && !/@[A-Za-z_]/.test(htmlToText(html)));
  // HTML fragments may use bare ampersands, NBSP and void BR. Validate a bounded
  // XHTML equivalent, but preserve the exact reviewed fragment in the payload.
  const validation = html.replace(/&nbsp;/g, '&#160;').replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/g, '&amp;').replace(/<br\s*>/gi, '<br/>');
  const allowed = new Set(['p', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'br', 'ol', 'ul', 'li', 'table', 'tbody', 'thead', 'tr', 'td', 'th', 'pre', 'code', 'sub', 'sup', 'a']);
  const visit = node => {
    fail(allowed.has(node.name.toLowerCase()));
    for (const [key, value] of Object.entries(node.attrs)) {
      fail(['style', 'class', 'dir', 'title', 'href'].includes(key.toLowerCase()));
      if (key.toLowerCase() === 'href') fail(/^(?:https?:\/\/|#)/i.test(value) && !/[\x00-\x20]/.test(value));
      if (key.toLowerCase() === 'style') fail(!/url\s*\(|expression|@import|[<>]/i.test(value));
    }
    node.children.forEach(visit);
  };
  // A wrapper permits plain text and multiple formatting roots.
  xmlNodes(`<div>${validation}</div>`).forEach(visit);
}
function content(value, action = false) {
  keys(value, ['text', 'html'], 'step content');
  requireValue(Object.keys(value).length === 1, 'Step content needs exactly one text or html value.');
  const text = value.text ?? value.html;
  requireValue(bounded(text) && xmlCharacters(text), 'Step content must be a valid string of at most 64 KiB.');
  requireValue(!/@[A-Za-z_]/.test(value.html === undefined ? text : htmlToText(text)), 'Parameterized step content is unsupported.');
  if (value.html !== undefined) formatted(value.html);
  requireValue(!action || (value.html === undefined ? value.text.trim() : htmlToText(value.html).trim()), 'Step action must not be empty.');
  return `<parameterizedString isformatted="${value.html !== undefined}">${escape(text)}</parameterizedString>`;
}

export function editableSteps(xml, fields = {}) {
  requireValue(emptyAdoMetadata(fields['Microsoft.VSTS.TCM.Parameters'], 'parameters') && emptyAdoMetadata(fields['Microsoft.VSTS.TCM.LocalDataSource'], 'NewDataSet'), 'Parameterized case content edits are unsupported; title-only edits preserve metadata.');
  requireValue(fields['Microsoft.VSTS.TCM.DataSource'] === undefined || fields['Microsoft.VSTS.TCM.DataSource'] === null || fields['Microsoft.VSTS.TCM.DataSource'] === '', 'Shared parameter data sources are unsupported for content editing.');
  const roots = xmlNodes(xml); fail(roots.length === 1);
  const root = roots[0]; fail(root.name === 'steps' && !root.text && Object.keys(root.attrs).every(key => ['id', 'last'].includes(key)) && root.attrs.id === '0' && /^\d+$/.test(root.attrs.last));
  const last = Number(root.attrs.last); fail(Number.isSafeInteger(last) && last <= 2147483647);
  const rows = root.children.map(node => {
    fail(node.name === 'step' && !node.text && Object.keys(node.attrs).every(key => ['id', 'type'].includes(key)) && ['ActionStep', 'ValidateStep'].includes(node.attrs.type));
    const id = adoId(node.attrs.id); fail(id <= last);
    const [action, expected, description, ...extra] = node.children;
    fail(action?.name === 'parameterizedString' && expected?.name === 'parameterizedString' && !extra.length && (!description || description.name === 'description' && !description.text && !description.children.length && !Object.keys(description.attrs).length));
    for (const part of [action, expected]) {
      fail(Object.keys(part.attrs).every(key => key === 'isformatted') && (part.attrs.isformatted === undefined || ['true', 'false'].includes(part.attrs.isformatted)));
      const inner = xml.slice(part.openEnd, part.closeStart);
      const html = part.children.length ? inner : decode(inner);
      if (part.children.length || part.attrs.isformatted === 'true') formatted(html);
      fail(!/@[A-Za-z_]/.test(part.children.length || part.attrs.isformatted === 'true' ? htmlToText(html) : html));
    }
    return {id, node, action, expected, raw: xml.slice(node.start, node.end)};
  });
  fail(rows.length <= 1000 && new Set(rows.map(row => row.id)).size === rows.length);
  return {root, rows, last};
}

export function editStepsXml(xml, fields, desired, removed = []) {
  requireValue(Array.isArray(desired) && desired.length > 0 && desired.length <= 1000 && Array.isArray(removed) && removed.length <= 1000, 'Supply 1–1000 ordered steps and bounded explicit removals.');
  const source = editableSteps(xml, fields), byId = new Map(source.rows.map(row => [row.id, row]));
  const ids = desired.map(row => {keys(row, ['id', 'action', 'expected'], 'case step'); return adoId(row.id);}), removals = removed.map(adoId);
  requireValue(new Set(ids).size === ids.length && new Set(removals).size === removals.length, 'Step IDs and removals must be unique.');
  requireValue(removals.every(id => byId.has(id) && !ids.includes(id)) && source.rows.every(row => ids.includes(row.id) || removals.includes(row.id)), 'Omitted steps require explicit removals; unknown or contradictory removals are invalid.');
  const raw = desired.map((change, index) => {
    const id = ids[index], old = byId.get(id);
    if (!old) {
      requireValue(id > source.last && change.action !== undefined && change.expected !== undefined, 'Inserted steps need new IDs above last, an action and an expected result.');
      const action = content(change.action, true), expected = content(change.expected);
      return `<step id="${id}" type="${(change.expected.text !== undefined ? change.expected.text.trim() : htmlToText(change.expected.html).trim()) ? 'ValidateStep' : 'ActionStep'}">${action}${expected}<description/></step>`;
    }
    const replacements = [];
    for (const name of ['action', 'expected']) if (change[name] !== undefined) {
      const text = content(change[name], name === 'action'), part = old[name], inner = xml.slice(part.openEnd, part.closeStart);
      const prior = part.children.length ? inner : decode(inner), rich = part.children.length > 0 || part.attrs.isformatted === 'true';
      const same = change[name].html !== undefined ? rich && change[name].html === prior : !part.children.length && (!rich || !/<[A-Za-z/!]/.test(prior)) && change[name].text === prior;
      if (!same) replacements.push({start: part.start, end: part.end, text});
    }
    if (replacements.some(part => part.start === old.expected.start) && (change.expected.text !== undefined ? change.expected.text.trim() : htmlToText(change.expected.html).trim()) && old.node.attrs.type === 'ActionStep') {
      const opening = xml.slice(old.node.start, old.node.openEnd).replace(/\btype\s*=\s*(?:"ActionStep"|'ActionStep')/, 'type="ValidateStep"');
      replacements.push({start: old.node.start, end: old.node.openEnd, text: opening});
    }
    let result = old.raw;
    for (const part of replacements.sort((a, b) => b.start - a.start)) result = result.slice(0, part.start - old.node.start) + part.text + result.slice(part.end - old.node.start);
    return result;
  });
  // Preserve an unchanged request byte-for-byte, including whitespace/attributes.
  if (ids.length === source.rows.length && source.rows.every((row, i) => row.id === ids[i] && row.raw === raw[i])) return xml;
  const last = Math.max(source.last, ...ids), opening = xml.slice(source.root.start, source.root.openEnd).replace(/\blast\s*=\s*(?:"\d+"|'\d+')/, `last="${last}"`).replace(/\/>$/, '>');
  const result = `${opening}${raw.join('')}</steps>`;
  editableSteps(result, fields); return result;
}
