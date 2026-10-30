import {requireValue} from './config.mjs';

/** Text/links only. Unsupported ADF content stays an explicit omission. */
export function readJiraAdf(value, {location = 'body'} = {}) {
  const links = [], omissions = [], ancestors = new Set(); let text = '', nodes = 0;
  const label = type => typeof type === 'string' && /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(type) ? type : 'unknown';
  const omit = (reason, path, type) => omissions.push({reason, location: path, ...(type ? {type: label(type)} : {})});
  function append(value) {text += value; requireValue(Buffer.byteLength(text) <= 2 * 1024 * 1024, 'ADF text exceeds its bound.');}
  const line = () => {if (text && !text.endsWith('\n')) append('\n');};
  function visit(node, path, depth = 0, index) {
    requireValue(++nodes <= 20000 && depth <= 30 && !ancestors.has(node), 'ADF traversal exceeds its bound or contains a cycle.');
    if (!node || typeof node !== 'object' || Array.isArray(node) || typeof node.type !== 'string') {omit('malformed-adf-node', path); return;}
    ancestors.add(node);
    const children = () => {
      if (node.content !== undefined && !Array.isArray(node.content)) {omit('malformed-adf-node', path, node.type); return;}
      for (const [i, child] of (node.content ?? []).entries()) visit(child, `${path}/content/${i}`, depth + 1, i);
    };
    switch (node.type) {
      case 'text': {
        if (typeof node.text !== 'string') {omit('malformed-adf-node', path, node.type); break;}
        const marks = node.marks ?? []; if (!Array.isArray(marks)) {omit('malformed-adf-node', path, node.type); break;}
        const strike = marks.some(mark => mark?.type === 'strike'); if (strike) append('~~');
        const start = text.length; append(node.text); const end = text.length;
        for (const mark of marks) {
          if (mark?.type === 'link') links.push({location, adfPath: path, text: node.text, textStart: start, textEnd: end, start, end, destination: typeof mark.attrs?.href === 'string' ? mark.attrs.href : ''});
          else if (!['strong', 'em', 'underline', 'strike', 'code', 'subsup', 'textColor', 'backgroundColor'].includes(mark?.type)) omit('unsupported-adf-mark', path, mark?.type);
        }
        if (strike) append('~~'); break;
      }
      case 'doc': children(); break;
      case 'paragraph': case 'heading': case 'blockquote': case 'codeBlock': children(); line(); break;
      case 'hardBreak': append('\n'); break;
      case 'rule': line(); append('---\n'); break;
      case 'bulletList': case 'orderedList': {
        line();
        if (!Array.isArray(node.content)) {omit('malformed-adf-node', path, node.type); break;}
        const order = node.attrs?.order ?? 1;
        if (node.type === 'orderedList' && (!Number.isSafeInteger(order) || order < 1)) {omit('malformed-adf-node', path, node.type); break;}
        for (const [i, child] of node.content.entries()) {line(); append(node.type === 'orderedList' ? `${order + i}. ` : '- '); visit(child, `${path}/content/${i}`, depth + 1, i); line();}
        break;
      }
      case 'listItem': children(); break;
      case 'table': line(); children(); line(); break;
      case 'tableRow': children(); line(); break;
      case 'tableHeader': case 'tableCell': if (index > 0) append('\t'); children(); text = text.replace(/\n+$/, ''); break;
      case 'mention': case 'emoji': case 'status': {
        const visible = node.attrs?.text ?? (node.type === 'emoji' ? node.attrs?.shortName : undefined);
        if (typeof visible === 'string' && visible.trim()) append(visible); else omit('unsupported-adf-node', path, node.type); break;
      }
      case 'inlineCard': {
        const url = node.attrs?.url;
        if (typeof url !== 'string') {omit('malformed-adf-node', path, node.type); break;}
        const start = text.length; append(url); links.push({location, adfPath: path, text: url, textStart: start, textEnd: text.length, start, end: text.length, destination: url}); break;
      }
      default: omit('unsupported-adf-node', path, node.type);
    }
    ancestors.delete(node);
  }
  if (typeof value === 'string') append(value);
  else if (value !== null && value !== undefined) {
    if (value?.type !== 'doc' || value.version !== 1 || !Array.isArray(value.content)) omit('unsupported-adf-document', location);
    else visit(value, location);
  }
  const leading = text.length - text.trimStart().length; text = text.trim();
  for (const link of links) {link.textStart = Math.max(0, link.textStart - leading); link.start = link.textStart; link.textEnd = Math.min(text.length, link.textEnd - leading); link.end = link.textEnd;}
  requireValue(links.length <= 1000 && omissions.length <= 20000, 'ADF links or omissions exceed their bound.');
  return {text, links, omissions};
}

/** Plain reviewed text becomes literal ADF paragraphs, never executable markup. */
export function jiraTextDocument(text, {links = []} = {}) {
  requireValue(typeof text === 'string' && Buffer.byteLength(text) <= 128 * 1024 && !text.includes('\0'), 'Jira document needs bounded plain text.');
  requireValue(Array.isArray(links) && links.length <= 100 && links.every(value => {try {const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && value.length <= 2000;} catch {return false;}}), 'Jira document reference links are invalid.');
  const selected = new Set(links), pattern = links.length ? new RegExp('(' + [...selected].sort((a, b) => b.length - a.length).map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'g') : null;
  return {version: 1, type: 'doc', content: text.split(/\r?\n/).map(line => ({type: 'paragraph', content: (pattern ? line.split(pattern) : [line]).filter(Boolean).map(value => ({type: 'text', text: value, ...(selected.has(value) ? {marks: [{type: 'link', attrs: {href: value}}]} : {})}))}))};
}
