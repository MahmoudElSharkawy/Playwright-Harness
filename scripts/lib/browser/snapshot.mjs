/** The key grammar emitted by the pinned native ARIA snapshot renderer. */
export const isSnapshotRef = reference => typeof reference === 'string' && reference.trim() === reference && /^(?:f\d+)?e\d+$/.test(reference);

export function snapshotRefs(text) {
  const refs = new Map();
  for (const line of text.split('\n')) {
    const item = line.match(/^\s*-\s+(.+)$/); if (!item) continue;
    let key = item[1];
    if (key.startsWith("'")) {
      const quoted = key.match(/^'((?:[^']|'')*)'(?:$|:)/); if (!quoted) continue;
      key = quoted[1].replaceAll("''", "'");
    } else {
      const plain = key.match(/^([a-z][a-z0-9-]*(?: "(?:\\.|[^"\\])*")?(?: \[[^\]\r\n]+\])*)(?:$|:)/);
      if (!plain) continue; key = plain[1];
    }
    const node = key.match(/^([a-z][a-z0-9-]*)(?: ("(?:\\.|[^"\\])*"))?((?: \[[^\]\r\n]+\])*)$/);
    if (!node) continue;
    const reference = node[3].match(/(?:^| )\[ref=((?:f\d+)?e\d+)\](?= |$)/)?.[1];
    if (!isSnapshotRef(reference)) continue;
    let name; try {name = node[2] ? JSON.parse(node[2]) : '';} catch {continue;}
    const subject = {kind: ['region', 'main', 'navigation', 'dialog', 'form', 'group'].includes(node[1]) ? 'region' : 'element', role: node[1], name};
    Object.defineProperty(subject, 'active', {value: node[3].includes(' [active]')}); refs.set(reference, subject);
  }
  return refs;
}
