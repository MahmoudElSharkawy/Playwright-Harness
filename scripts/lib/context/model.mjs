import {data, digest, fingerprint, requireThat} from '../execution-core/data.mjs';
import {secretFindings} from '../package-validation.mjs';

export const RECIPE = 'context-v2.2-business';
export const inactive = new Set(['removed', 'excluded', 'out-of-scope']);
export const businessSource = source => source.selectedFor === 'business-context' && ['file', 'work-item', 'attachment'].includes(source.kind);
export const HASH = /^[a-f0-9]{64}$/;
export function contextData(value, maximum = 1024 * 1024) {
  const result = data(value, maximum, {maxNodes: 500000});
  function inspect(item) {
    if (typeof item === 'string') requireThat(secretFindings('context.txt', item).length === 0, 'Context contains a credential-like literal; sanitize before reading or saving.');
    else if (item && typeof item === 'object') Object.values(item).forEach(inspect);
  }
  inspect(result); return result;
}
export function facts(sources) {
  const found = new Map();
  for (const source of sources) if (!inactive.has(source.status)) for (const part of source.contributions) {
    const id = fingerprint({topic: part.topic, text: part.text});
    if (!found.has(id)) found.set(id, {id, topic: part.topic, text: part.text, references: []});
    found.get(id).references.push({sourceId: source.id, location: part.location, authority: part.authority, status: source.status, ...(source.verifiedAt ? {verifiedAt: source.verifiedAt} : {})});
  }
  const values = [...found.values()].sort((a, b) => a.id.localeCompare(b.id)), topics = new Map();
  for (const fact of values) topics.set(fact.topic, (topics.get(fact.topic) ?? 0) + 1);
  for (const fact of values) {
    fact.references.sort((a, b) => `${a.sourceId}:${a.location}`.localeCompare(`${b.sourceId}:${b.location}`));
    const verified = fact.references.filter(reference => reference.status === 'verified');
    fact.status = topics.get(fact.topic) > 1 ? 'conflicting' : !verified.length ? 'stale' : verified.some(r => r.authority === 'reviewed') ? 'reviewed' : verified.some(r => r.authority === 'current') ? 'current' : 'observation';
  }
  return values;
}
export function scopeIdentity(snapshot) {
  return {contextId: snapshot.contextId, identity: snapshot.identity, scope: snapshot.scope,
    ...(snapshot.adoProject ? {adoProject: {organizationUrl: snapshot.adoProject.organizationUrl, id: snapshot.adoProject.id}} : {})};
}
export const scopeKey = snapshot => fingerprint(scopeIdentity(snapshot));
export const bucket = id => parseInt(digest(id).slice(0, 2), 16) % 64;

/** Offsets are UTF-16 characters and UTF-8 bytes in the original section, never normalized text. */
export function chunks(text, factId) {
  const values = []; let start = 0, byteStart = 0;
  while (start < text.length) {
    let end = start, bytes = 0, boundary = 0;
    while (end < text.length) {
      const point = String.fromCodePoint(text.codePointAt(end)), size = Buffer.byteLength(point);
      if (bytes + size > 2048) break;
      bytes += size; end += point.length;
      if (/\s/u.test(point) && bytes >= 1536) boundary = end;
    }
    if (end < text.length && boundary) end = boundary;
    const excerpt = text.slice(start, end), byteEnd = byteStart + Buffer.byteLength(excerpt);
    const chunk = {factId, start, end, byteStart, byteEnd, text: excerpt};
    values.push({...chunk, id: fingerprint(chunk)});
    if (end === text.length) break;
    // Limited overlap stays inside this section and starts on a Unicode boundary.
    let overlap = end, overlapBytes = 0;
    while (overlap > start) {
      let next = overlap - 1; if (/[\uDC00-\uDFFF]/.test(text[next])) next--;
      const size = Buffer.byteLength(text.slice(next, overlap)); if (overlapBytes + size > 128) break;
      overlapBytes += size; overlap = next;
    }
    start = overlap; byteStart = byteEnd - overlapBytes;
  }
  return values;
}
export function restoreText(parts) {
  let text = '';
  for (const part of parts) {
    requireThat(part.start <= text.length && part.end > text.length && part.end - part.start === part.text.length && text.slice(part.start) === part.text.slice(0, text.length - part.start), 'Invalid captured chunk sequence.');
    text += part.text.slice(text.length - part.start);
  }
  return text;
}
