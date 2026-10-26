import {secretFindings} from '../package-validation.mjs';

/** Native document structure is location metadata, never an inferred business topic. */
export const DOCUMENT_RECIPE = 'native-document-sections-v2';
export const nativeRecipe = extension => ['md', 'txt'].includes(extension) ? DOCUMENT_RECIPE : 'native';
export const nativeReader = recipe => ['native', 'native-document-sections-v1', DOCUMENT_RECIPE].includes(recipe);
const label = (text, maximum) => text.length > maximum ? text.slice(0, maximum - 1).replace(/[\uD800-\uDBFF]$/, '') + '…' : text;

export function documentParts(text, markdown, utf8) {
  const lines = []; let byteStart = 0;
  for (const match of text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    if (!match[0]) continue;
    lines.push({start: match.index, byteStart, text: match[0].replace(/[\r\n]+$/, '')}); byteStart += Buffer.byteLength(match[0]);
  }
  const ancestry = [];
  let boundaries = [{start: 0, byteStart: 0, line: 1, headings: []}];
  const lists = [], fenceMarker = /^ {0,3}(`{3,}|~{3,})(.*)$/;
  let fence, hasHeading = false, paragraphStart, paragraph = [], excludedParagraph = false;
  function boundary(index, headings) {
    const line = lines[index], next = {...line, line: index + 1, headings}; delete next.text;
    if (boundaries.length === 1 && !text.slice(0, line.start).trim()) boundaries[0] = {start: 0, byteStart: 0, line: 1, headings};
    else if (line.start === boundaries.at(-1).start) boundaries[boundaries.length - 1] = next;
    else boundaries.push(next);
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].text, content = index === 0 ? line.replace(/^\uFEFF/, '') : line;
    if (!markdown) {
      if (content.trim() && index && !lines[index - 1].text.trim()) boundary(index, []);
      continue;
    }
    // Markdown indentation uses four-column tab stops; only this parsing view expands tabs.
    let addedColumns = 0;
    const columns = content.replace(/\t/g, (_tab, offset) => {const width = 4 - (offset + addedColumns) % 4; addedColumns += width - 1; return ' '.repeat(width);});
    const indentation = /^ */.exec(columns)[0].length;
    if (fence) {
      // An unclosed fence ends when its list container ends, not at document end.
      if (!content.trim() || indentation >= fence.indentation) {
        const closing = fenceMarker.exec(columns.slice(fence.indentation));
        if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length && !closing[2].trim()) fence = undefined;
        continue;
      }
      fence = undefined;
    }
    if (content.trim()) while (lists.length && indentation < lists.at(-1)) lists.pop();
    let container = lists.at(-1) ?? 0, listItem = false, marker;
    // Strip list markers only for fence recognition; original text/offsets stay intact.
    while ((marker = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:( +)|$)/.exec(columns.slice(container)))) {
      const spaces = marker[1]?.length ?? 0;
      const padding = spaces > 4 || !columns.slice(container + marker[0].length).trim() ? 1 : spaces;
      container += marker[0].length - spaces + padding;
      lists.push(container); listItem = true;
    }
    marker = fenceMarker.exec(columns.slice(container));
    if (marker && !(marker[1][0] === '`' && marker[2].includes('`'))) {
      fence = {character: marker[1][0], length: marker[1].length, indentation: container};
      paragraph = []; excludedParagraph = false; continue;
    }
    const heading = markdown && /^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/.exec(content);
    const setext = paragraph.length && /^ {0,3}(=+|-+)[ \t]*$/.exec(content);
    if (heading || setext) {
      const level = heading ? heading[1].length : setext[1][0] === '=' ? 1 : 2;
      const title = (heading ? (heading[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '') : paragraph.join(' ')).trim();
      ancestry.length = level; ancestry[level - 1] = secretFindings('context.txt', title).length ? undefined : label(title, 200);
      boundary(heading ? index : paragraphStart, ancestry.filter(value => value !== undefined)); hasHeading = true;
      paragraph = []; excludedParagraph = false;
    } else {
      if (!hasHeading && content.trim() && index && !lines[index - 1].text.trim()) boundary(index, []);
      const thematic = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/.test(content);
      if (!content.trim() || thematic) {paragraph = []; excludedParagraph = false;}
      else if (listItem || /^ {0,3}>/.test(content)) {paragraph = []; excludedParagraph = true;}
      else if (!excludedParagraph && !lists.length && (paragraph.length || /^ {0,3}\S/.test(content)) && !/^ {0,3}</.test(content)) {
        if (!paragraph.length) paragraphStart = index;
        paragraph.push(content.trim());
      } else paragraph = [];
    }
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
