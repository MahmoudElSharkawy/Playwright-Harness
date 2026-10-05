/** Small lexical reader for evidence-backed checks; deliberately not a TypeScript parser. */
export function sourceTokens(text, offset = 0) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const start = index, character = text[index];
    if (/\s/.test(character)) { index++; continue; }
    if (text.startsWith('//', index)) { index = text.indexOf('\n', index); if (index < 0) break; continue; }
    if (text.startsWith('/*', index)) { const end = text.indexOf('*/', index + 2); index = end < 0 ? text.length : end + 2; continue; }
    if (character === "'" || character === '"' || character === '`') {
      const quote = character;
      let value = '', dynamic = false;
      index++;
      while (index < text.length && text[index] !== quote) {
        if (quote === '`' && text.startsWith('${', index)) dynamic = true;
        if (text[index] === '\\' && index + 1 < text.length) {
          const escaped = text[++index];
          value += ({n: '\n', r: '\r', t: '\t'}[escaped] ?? escaped);
          index++;
        } else value += text[index++];
      }
      const closed = text[index] === quote;
      if (closed) index++;
      tokens.push({kind: closed && !dynamic ? 'string' : 'opaque', value, start: start + offset, end: index + offset});
      continue;
    }
    // Regex bodies are opaque, so examples inside them cannot invent imports or reads.
    if (character === '/' && (!tokens.length || /^(?:=|\(|\[|\{|,|:|;|!|\?|return|=>)$/.test(tokens.at(-1).value))) {
      let inClass = false;
      index++;
      while (index < text.length && text[index] !== '\n') {
        if (text[index] === '\\') { index += 2; continue; }
        if (text[index] === '[') inClass = true;
        if (text[index] === ']') inClass = false;
        if (text[index++] === '/' && !inClass) break;
      }
      while (/[a-z]/i.test(text[index] ?? '')) index++;
      tokens.push({kind: 'opaque', value: '', start: start + offset, end: index + offset});
      continue;
    }
    const identifier = /^[A-Za-z_$][\w$]*/.exec(text.slice(index));
    if (identifier) {
      index += identifier[0].length;
      tokens.push({kind: 'identifier', value: identifier[0], start: start + offset, end: index + offset});
    } else {
      const value = text.startsWith('=>', index) ? '=>' : character;
      index += value.length;
      tokens.push({kind: 'punctuation', value, start: start + offset, end: index + offset});
    }
  }
  return tokens;
}

/** Literal references through identifiable Node fs bindings; shadowing still requires review. */
export function sourceReferences(text) {
  const tokens = sourceTokens(text), modules = [], namespaces = new Set(), readers = new Set();
  const filesystem = /^(?:node:)?fs(?:\/promises)?$/;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!['import', 'export', 'require'].includes(token.value) || token.kind !== 'identifier' || tokens[index - 1]?.value === '.') continue;
    let path, requiredNamespace, bindings = [];
    if (tokens[index + 1]?.value === '(' && tokens[index + 2]?.kind === 'string' && [',', ')'].includes(tokens[index + 3]?.value)) {
      path = tokens[index + 2];
      if (token.value === 'require' && tokens[index - 1]?.value === '=' && tokens[index - 2]?.kind === 'identifier') requiredNamespace = tokens[index - 2].value;
    } else if (token.value === 'import' && tokens[index + 1]?.kind === 'string') path = tokens[index + 1];
    else if (token.value !== 'require') {
      let cursor = index + 1;
      while (cursor < tokens.length && ![';', 'import', 'export'].includes(tokens[cursor].value)) {
        if (tokens[cursor].value === 'from' && tokens[cursor + 1]?.kind === 'string') { path = tokens[cursor + 1]; break; }
        bindings.push(tokens[cursor++]);
      }
    }
    if (!path) continue;
    const typeOnly = token.value === 'import' && (tokens[index + 1]?.value === 'type'
      || tokens[index - 1]?.value === 'typeof' && tokens[index - 2]?.value === ':'
      && tokens[index - 3]?.kind === 'identifier' && ['let', 'const', 'var'].includes(tokens[index - 4]?.value));
    modules.push({path: path.value, start: path.start, kind: token.value, typeOnly});
    if (!filesystem.test(path.value)) continue;
    if (requiredNamespace) namespaces.add(requiredNamespace);
    if (bindings[0]?.kind === 'identifier' && bindings[0].value !== 'type') namespaces.add(bindings[0].value);
    for (let binding = 0; binding < bindings.length; binding++) {
      if (bindings[binding].value === '*' && bindings[binding + 1]?.value === 'as') namespaces.add(bindings[binding + 2]?.value);
      if (['readFileSync', 'readFile'].includes(bindings[binding].value)) readers.add(bindings[binding + 1]?.value === 'as' ? bindings[binding + 2]?.value : bindings[binding].value);
    }
  }
  const reads = [];
  for (let index = 0; index < tokens.length; index++) {
    const named = readers.has(tokens[index].value) && tokens[index - 1]?.value !== '.';
    const qualified = namespaces.has(tokens[index].value) && tokens[index - 1]?.value !== '.' && tokens[index + 1]?.value === '.' && ['readFileSync', 'readFile'].includes(tokens[index + 2]?.value);
    const call = index + (qualified ? 3 : 1);
    if ((named || qualified) && tokens[call]?.value === '(' && tokens[call + 1]?.kind === 'string' && [',', ')'].includes(tokens[call + 2]?.value)) reads.push({path: tokens[call + 1].value, start: tokens[call + 1].start});
  }
  return {modules, reads};
}

/** Code spans only; Markdown prose and raw credential text are not expression assignments. */
export function codeTokens(file, text) {
  if (/\.[cm]?[jt]sx?$/.test(file)) return sourceTokens(text);
  if (!/\.md$/.test(file)) return [];
  const tokens = [];
  for (const match of text.matchAll(/(?:^|\n)(```|~~~)(?:ts|typescript|js|javascript|mjs|cjs)\s*\n([\s\S]*?)\n\1/g)) {
    const start = match.index + match[0].indexOf('\n', match[0].startsWith('\n') ? 1 : 0) + 1;
    tokens.push(...sourceTokens(match[2], start));
  }
  return tokens;
}
