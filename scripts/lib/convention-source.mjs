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

/** Top-level comma-separated expressions; nested expressions remain opaque to the caller. */
function expressions(tokens) {
  const parts = []; let start = 0, depth = 0;
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].kind !== 'punctuation') continue;
    if (['(', '[', '{'].includes(tokens[index].value)) depth++;
    else if ([')', ']', '}'].includes(tokens[index].value)) depth--;
    if (tokens[index].value === ',' && depth === 0) {parts.push(tokens.slice(start, index)); start = index + 1;}
  }
  if (start < tokens.length) parts.push(tokens.slice(start));
  return parts;
}

/** Return the end of a balanced expression, without evaluating any configuration. */
function expressionEnd(tokens, start) {
  let depth = 0;
  for (let index = start; index < tokens.length; index++) {
    if (tokens[index].kind !== 'punctuation') continue;
    if (['(', '[', '{'].includes(tokens[index].value)) depth++;
    else if ([')', ']', '}'].includes(tokens[index].value) && --depth === 0) return index;
  }
  return -1;
}

function fields(tokens) {
  if (tokens[0]?.value !== '{' || expressionEnd(tokens, 0) !== tokens.length - 1) return undefined;
  const result = new Map();
  for (const part of expressions(tokens.slice(1, -1))) {
    if (!['identifier', 'string'].includes(part[0]?.kind) || part[1]?.value !== ':' || result.has(part[0].value)) return undefined;
    result.set(part[0].value, part.slice(2));
  }
  return result;
}

/** Literal reporter options only. This validator never loads config, contacts ADO or reads credentials. */
export function validateAllureLinks(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['tms', 'issue'].includes(key))) throw new Error('Unsupported Allure link options.');
  const links = {};
  for (const [kind, template] of Object.entries(value)) {
    if (!template || typeof template !== 'object' || Array.isArray(template) || Object.keys(template).some(key => !['urlTemplate', 'nameTemplate'].includes(key))) throw new Error('Unsupported Allure link template.');
    const {urlTemplate, nameTemplate} = template;
    if (typeof urlTemplate !== 'string' || urlTemplate.length > 4096 || (urlTemplate.match(/%s/g) ?? []).length !== 1 || /[\r\n\0]/.test(urlTemplate)) throw new Error('Invalid Allure URL template.');
    const url = new URL(urlTemplate.replace('%s', '123'));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid Allure URL template.');
    if (nameTemplate !== undefined && (typeof nameTemplate !== 'string' || nameTemplate.length > 256 || /[\r\n\0]/.test(nameTemplate))) throw new Error('Invalid Allure name template.');
    links[kind] = {urlTemplate, ...(nameTemplate === undefined ? {} : {nameTemplate})};
  }
  return links;
}

/** Read the literal tms/issue options of one reporter entry. Dynamic config remains supported by normal Playwright runs. */
export function allureLinkTemplates(text) {
  const tokens = sourceTokens(text), exports = [];
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].value === 'export' && tokens[index].kind === 'identifier' && tokens[index + 1]?.value === 'default') exports.push(index + 2);
    if (tokens[index].value === 'module' && tokens[index + 1]?.value === '.' && tokens[index + 2]?.value === 'exports' && tokens[index + 3]?.value === '=') exports.push(index + 4);
  }
  // Read only the actual exported object. Intermediate literals and composed
  // defineConfig arguments can be overridden; resolving them is outside this reader.
  if (!exports.length) return {state: tokens.some(token => token.value === 'reporter') ? 'UNRESOLVED' : 'NONE'};
  if (exports.length !== 1) return {state: 'UNRESOLVED'};
  let start = exports[0], configTokens, exportEnd;
  if (tokens[start]?.value === 'defineConfig' && tokens[start + 1]?.value === '(') {
    const end = expressionEnd(tokens, start + 1);
    if (end < 0) return {state: 'UNRESOLVED'};
    exportEnd = end;
    const args = expressions(tokens.slice(start + 2, end));
    if (args.length !== 1) return {state: 'UNRESOLVED'};
    configTokens = args[0];
  } else if (tokens[start]?.value === '{') {
    const end = expressionEnd(tokens, start);
    if (end < 0) return {state: 'UNRESOLVED'};
    exportEnd = end;
    configTokens = tokens.slice(start, end + 1);
  } else return {state: 'UNRESOLVED'};
  // CommonJS exports remain mutable after assignment. Only a terminal literal is
  // statically conclusive; do not resolve later assignments or other expressions.
  if (tokens[start - 1]?.value === '=' && tokens.slice(exportEnd + 1).some(token => token.value !== ';')) return {state: 'UNRESOLVED'};
  const config = fields(configTokens);
  if (!config) return {state: 'UNRESOLVED'};
  if (!config.has('reporter')) return {state: 'NONE'};
  const reporter = config.get('reporter');
  if (reporter[0]?.value !== '[' || expressionEnd(reporter, 0) !== reporter.length - 1) return {state: 'UNRESOLVED'};
  const entries = expressions(reporter.slice(1, -1)), matches = [];

  for (const entry of entries) {
    if (entry[0]?.value !== '[' || expressionEnd(entry, 0) !== entry.length - 1) return {state: 'UNRESOLVED'};
    const parts = expressions(entry.slice(1, -1));
    if (parts[0]?.length !== 1 || parts[0][0].kind !== 'string') return {state: 'UNRESOLVED'};
    if (parts[0][0].value === 'allure-playwright') matches.push(parts);
  }
  if (!matches.length) return {state: 'NONE'};
  if (matches.length !== 1 || matches[0].length > 2) return {state: 'UNRESOLVED'};
  if (matches[0].length === 1) return {state: 'NONE'};
  const options = fields(matches[0][1]);
  if (!options) return {state: 'UNRESOLVED'};
  if (!options.has('links')) return {state: 'NONE'};
  const kinds = fields(options.get('links'));
  if (!kinds) return {state: 'UNRESOLVED'};
  const links = {};
  for (const kind of ['tms', 'issue']) {
    if (!kinds.has(kind)) continue;
    const template = fields(kinds.get(kind));
    if (!template) return {state: 'UNRESOLVED'};
    links[kind] = {};
    for (const [key, value] of template) {
      if (!['urlTemplate', 'nameTemplate'].includes(key) || value.length !== 1 || value[0].kind !== 'string' || /\\[ux]/.test(text.slice(value[0].start, value[0].end))) return {state: 'UNRESOLVED'};
      links[kind][key] = value[0].value;
    }
  }
  if (!Object.keys(links).length) return {state: 'NONE'};
  if (Object.values(links).some(template => /your[-_ ](?:org(?:anization)?|project)|<[^>]+>/i.test(template.urlTemplate ?? ''))) return {state: 'PLACEHOLDER'};
  try {return {state: 'CONFIGURED', links: validateAllureLinks(links)};} catch {return {state: 'UNRESOLVED'};}
}

/** Imported bindings for focused lint rules, not a symbol resolver. */
function imports(tokens) {
  const result = [];
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].value !== 'import' || tokens[index].kind !== 'identifier' || ['(', '.'].includes(tokens[index + 1]?.value)) continue;
    let end = index + 1;
    while (end < tokens.length && ![';', 'import', 'export'].includes(tokens[end].value)) {
      if (tokens[end].value === 'from' && tokens[end + 1]?.kind === 'string') {result.push({start: tokens[index].start, path: tokens[end + 1].value, bindings: tokens.slice(index + 1, end)}); break;}
      end++;
    }
  }
  return result;
}

/** Literal metadata call sites; aliases are recognized, arbitrary wrappers are left to review. */
export function allureLinkUsage(text) {
  const tokens = sourceTokens(text), namespaces = new Set(['allure']), names = new Map(), usages = [];
  for (const item of imports(tokens).filter(item => /^allure-js-commons(?:\/sync)?$/.test(item.path))) {
    for (let index = 0; index < item.bindings.length; index++) {
      if (item.bindings[index].value === '*' && item.bindings[index + 1]?.value === 'as') namespaces.add(item.bindings[index + 2]?.value);
      if (['tms', 'issue'].includes(item.bindings[index].value)) names.set(item.bindings[index + 1]?.value === 'as' ? item.bindings[index + 2]?.value : item.bindings[index].value, item.bindings[index].value);
    }
  }
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].kind !== 'identifier') continue;
    if (names.has(tokens[index].value) && tokens[index - 1]?.value !== '.' && tokens[index + 1]?.value === '(' || namespaces.has(tokens[index].value) && tokens[index + 1]?.value === '.' && ['tms', 'issue'].includes(tokens[index + 2]?.value) && tokens[index + 3]?.value === '(') usages.push({start: tokens[index].start, kind: names.has(tokens[index].value) ? names.get(tokens[index].value) : tokens[index + 2].value});
  }
  return usages;
}

/** Source-evidenced convention findings. No graph walk, filename blacklist or guessed business ownership. */
export function consumerConventionFindings(text, {business = false} = {}) {
  const tokens = sourceTokens(text), imported = imports(tokens), findings = [];
  const add = (rule, token) => findings.push({rule, start: token.start});
  const privateModule = path => /^(?:@playwright\/test|playwright(?:-core)?)\/(?:lib|src|internal(?:s)?|_[^/]*)(?:\/|$)/.test(path);
  for (const reference of sourceReferences(text).modules) if (privateModule(reference.path)) add('playwright-private-api', reference);
  const factories = new Set(['createRequire']), requires = new Set();
  for (const item of imported) {
    for (let index = 0; index < item.bindings.length; index++) {
      if (item.bindings[index].value === 'createRequire' && /^(?:node:)?module$/.test(item.path)) factories.add(item.bindings[index + 1]?.value === 'as' ? item.bindings[index + 2]?.value : 'createRequire');
    }
    if (item.path !== '@playwright/test' && item.bindings[0]?.value !== 'type' && item.bindings.some(token => ['test', 'expect'].includes(token.value))) add('test-import-source', item);
  }
  const namespaces = new Map([['allure', false]]), named = new Map();
  for (const item of imported.filter(item => /^allure-js-commons(?:\/sync)?$/.test(item.path))) {
    const sync = item.path.endsWith('/sync');
    for (let index = 0; index < item.bindings.length; index++) {
      const token = item.bindings[index];
      if (token.value === '*' && item.bindings[index + 1]?.value === 'as') namespaces.set(item.bindings[index + 2]?.value, sync);
      if (['feature', 'story', 'epic', 'tms', 'issue', 'testCaseId'].includes(token.value)) named.set(item.bindings[index + 1]?.value === 'as' ? item.bindings[index + 2]?.value : token.value, {method: token.value, sync});
    }
  }
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index], previous = tokens[index - 1], next = tokens[index + 1];
    if (factories.has(token.value) && next?.value === '(' && previous?.value === '=' && tokens[index - 2]?.kind === 'identifier') requires.add(tokens[index - 2].value);
    if (requires.has(token.value) && next?.value === '(' && tokens[index + 2]?.kind === 'string' && privateModule(tokens[index + 2].value)) add('playwright-private-api', token);
    if ((token.kind === 'identifier' && previous?.value === '.' || token.kind === 'string' && previous?.value === '[') && ['_addStep', '_instrumentation', '_currentTestInfo'].includes(token.value)) add('playwright-private-api', token);
    if (business && token.value === 'export') {
      const end = tokens.slice(index + 1).findIndex(item => [';', 'from', '=', '('].includes(item.value));
      if (tokens.slice(index + 1, end < 0 ? index + 5 : index + 1 + end).some(item => item.value === 'test')) add('test-import-source', token);
    }
    if ((token.kind === 'identifier' || token.kind === 'string' && next?.value === ':') && /^sourceExpectation(?:Key)?$/.test(token.value) || ['string', 'opaque'].includes(token.kind) && token.value.startsWith('harness:expectation:')) add('source-expectation-plumbing', token);
    const qualified = namespaces.has(token.value) && next?.value === '.' && ['feature', 'story', 'epic', 'tms', 'issue', 'testCaseId'].includes(tokens[index + 2]?.value);
    const plain = named.has(token.value) && previous?.value !== '.' && next?.value === '(';
    if (!qualified && !plain) continue;
    const call = index + (qualified ? 3 : 1);
    if (tokens[call]?.value !== '(') continue;
    const method = qualified ? tokens[index + 2].value : named.get(token.value).method;
    if (!(qualified ? namespaces.get(token.value) : named.get(token.value).sync) && previous?.value !== 'await') add('allure-metadata-await', token);
    if (['tms', 'issue'].includes(method)) {
      const end = expressionEnd(tokens, call), args = end < 0 ? [] : expressions(tokens.slice(call + 1, end));
      if (args.length !== 1 || args[0]?.length !== 1 || args[0][0].kind !== 'string' || /^(?:https?:)?\/\//i.test(args[0][0].value) || !args[0][0].value.trim()) add('allure-link-id', token);
    }
  }
  return findings.filter((finding, index) => findings.findIndex(other => other.rule === finding.rule && other.start === finding.start) === index);
}
