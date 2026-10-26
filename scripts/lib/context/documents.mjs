import {secretFindings} from '../package-validation.mjs';

/** Native document structure is location metadata, never an inferred business topic. */
export const DOCUMENT_RECIPE = 'native-document-sections-v1';
export const nativeRecipe = extension => ['md', 'txt'].includes(extension) ? DOCUMENT_RECIPE : 'native';
export const nativeReader = recipe => ['native', DOCUMENT_RECIPE].includes(recipe);
const label = (text, maximum) => text.length > maximum ? text.slice(0, maximum - 1).replace(/[\uD800-\uDBFF]$/, '') + '…' : text;

export function documentParts(text, markdown, utf8) {
  const lines = []; let byteStart = 0;
  for (const match of text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    if (!match[0]) continue;
    lines.push({start: match.index, byteStart, text: match[0].replace(/[\r\n]+$/, '')}); byteStart += Buffer.byteLength(match[0]);
  }
  const ancestry = [];
  let boundaries = [{start: 0, byteStart: 0, line: 1, headings: []}];
  let fence, hasHeading = false;
  function boundary(index, headings) {
    const line = lines[index], next = {...line, line: index + 1, headings}; delete next.text;
    if (boundaries.length === 1 && !text.slice(0, line.start).trim()) boundaries[0] = {start: 0, byteStart: 0, line: 1, headings};
    else if (line.start === boundaries.at(-1).start) boundaries[boundaries.length - 1] = next;
    else boundaries.push(next);
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].text, content = index === 0 ? line.replace(/^\uFEFF/, '') : line;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(content);
    if (fence) {if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined; continue;}
    if (marker) {fence = {character: marker[1][0], length: marker[1].length}; continue;}
    const heading = markdown && /^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/.exec(content);
    const setext = markdown && /^ {0,3}\S/.test(content) && !/^ {0,3}(?:[-+*][ \t]|\d+[.)][ \t]|>)/.test(content) && /^ {0,3}(=+|-+)[ \t]*$/.exec(lines[index + 1]?.text ?? '');
    if (heading || setext) {
      const level = heading ? heading[1].length : setext[1][0] === '=' ? 1 : 2;
      const title = (heading ? (heading[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '') : content).trim();
      ancestry.length = level; ancestry[level - 1] = secretFindings('context.txt', title).length ? undefined : label(title, 200);
      boundary(index, ancestry.filter(value => value !== undefined)); hasHeading = true;
      if (setext) index++;
    } else if ((!markdown || !hasHeading) && content.trim() && index && !lines[index - 1].text.trim()) boundary(index, []);
  }
  // Keep the previous line reader's redaction scope: a credential line must not
  // discard an otherwise safe business section or move the surviving offsets.
  const structural = [...boundaries], split = new Map(boundaries.map(value => [value.start, value])); let section = 0;
  for (let index = 0; index < lines.length; index++) {
    while (section + 1 < structural.length && structural[section + 1].start <= lines[index].start) section++;
    if (!secretFindings('context.txt', lines[index].text).length) continue;
    for (const position of [index, index + 1]) if (lines[position] && !split.has(lines[position].start)) split.set(lines[position].start, {start: lines[position].start, byteStart: lines[position].byteStart, line: position + 1, headings: structural[section].headings});
  }
  boundaries = [...split.values()].sort((a, b) => a.start - b.start);
  const parts = [];
  for (let index = 0; index < Math.min(boundaries.length, 20000); index++) {
    const start = boundaries[index], next = boundaries[index + 1], end = next?.start ?? text.length, excerpt = text.slice(start.start, end);
    if (!excerpt.trim()) continue;
    const lineEnd = next ? next.line - 1 : lines.length;
    const heading = start.headings.join(' > '), location = `${heading ? label(heading, 420) + '; ' : ''}lines ${start.line}-${lineEnd}`;
    parts.push({location, text: excerpt, document: {start: start.start, end, ...(utf8 ? {byteStart: start.byteStart, byteEnd: next?.byteStart ?? byteStart} : {}), lineStart: start.line, lineEnd, headings: start.headings}});
  }
  return {parts, coverage: boundaries.length > 20000 ? 'partial' : 'complete'};
}
