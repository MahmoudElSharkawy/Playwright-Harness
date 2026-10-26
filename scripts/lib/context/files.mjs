import {readFileSync, statSync, realpathSync} from 'node:fs';
import {resolve, extname, basename} from 'node:path';
import {TextDecoder} from 'node:util';
import {consumerPath} from '../consumer-paths.mjs';
import {data, digest, fingerprint, requireThat} from '../execution-core/data.mjs';
import {keys} from '../project-config.mjs';
import {credentialName, secretFindings} from '../package-validation.mjs';
import {within} from '../skill-roots.mjs';
import {RECIPE, businessSource} from './model.mjs';
import {documentParts, nativeRecipe, nativeReader} from './documents.mjs';

const sensitive = name => credentialName(name) || /^(?:authorization|cookie|set-cookie|connectionString)$/i.test(name);
const privatePath = path => /(?:^|[\\/])(?:\.env(?:\..*)?|\.aws|\.ssh|\.auth)(?:[\\/]|$)/i.test(path) || /\.(?:key|pfx|p12|dpapi)$/i.test(path);
const textual = new Set(['txt', 'md', 'ts', 'js', 'mjs', 'cjs', 'yaml', 'yml', 'xml', 'html', 'sql', 'log']);
export function contextParts(parts, authority = 'observation') {
  requireThat(Array.isArray(parts) && parts.length <= 20000, 'Context extraction needs at most 20000 located parts.');
  let redacted = 0;
  const contributions = [], seen = new Set();
  for (const part of parts) {
    keys(part, ['location', 'text', 'topic', 'document'], 'context extraction part');
    requireThat(typeof part.location === 'string' && part.location.trim() && part.location.length <= 500 && typeof part.text === 'string' && part.text.trim() && Buffer.byteLength(part.text) <= 8 * 1024 * 1024, 'Context parts need bounded text and precise locations.');
    requireThat(part.topic === undefined || typeof part.topic === 'string' && part.topic.trim() && part.topic.length <= 200, 'Invalid context fact topic.');
    if (part.document) {
      const span = part.document; keys(span, ['start', 'end', 'byteStart', 'byteEnd', 'lineStart', 'lineEnd', 'headings'], 'document span');
      requireThat(['start', 'end', 'lineStart', 'lineEnd'].every(key => Number.isSafeInteger(span[key])) && span.start >= 0 && span.end - span.start === part.text.length && span.lineStart > 0 && span.lineEnd >= span.lineStart, 'Invalid document character/line span.');
      requireThat(span.byteStart === undefined && span.byteEnd === undefined || Number.isSafeInteger(span.byteStart) && Number.isSafeInteger(span.byteEnd) && span.byteStart >= 0 && span.byteEnd - span.byteStart === Buffer.byteLength(part.text), 'Invalid document UTF-8 byte span.');
      requireThat(Array.isArray(span.headings) && span.headings.length <= 6 && span.headings.every(value => typeof value === 'string' && value.length <= 200), 'Invalid document heading ancestry.');
    }
    // Scan original excerpts before JSON escaping can hide quoted assignments.
    if ([part.text, part.location, part.topic ?? ''].some(text => secretFindings('context.txt', text).length)) {redacted++; continue;}
    try {data(part, 16 * 1024 * 1024);} catch {redacted++; continue;}
    const value = {topic: part.topic ?? `content-${fingerprint(part.text)}`, text: part.text, location: part.location, authority, ...(part.document ? {document: part.document} : {})};
    const key = fingerprint(value); if (!seen.has(key)) {contributions.push(value); seen.add(key);}
  }
  return {contributions, redacted};
}
function jsonParts(bytes) {
  const input = JSON.parse(bytes), parts = []; let omitted = 0, incomplete = false;
  function visit(value, location, depth) {
    if (depth > 25 || parts.length >= 20000) {incomplete = true; return;}
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (sensitive(key)) {omitted++; continue;}
      visit(child, Array.isArray(value) ? `${location}[${key}]` : `${location}[${JSON.stringify(key)}]`, depth + 1);
    }
    else {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      if (text?.trim()) parts.push({location, text});
    }
  }
  visit(input, '$', 0); return {parts, coverage: incomplete ? 'partial' : 'complete', redacted: omitted};
}
/** RFC-style quoted fields, including embedded newlines; delimiter/encoding ambiguity is explicit. */
function csvParts(text, delimiter) {
  requireThat([',', ';', '\t', '|'].includes(delimiter), 'Choose a supported CSV delimiter.');
  if (delimiter === ',' && !text.includes(',') && /[;\t|]/.test(text)) throw new Error('CSV delimiter is ambiguous.');
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {if (character === '"' && text[index + 1] === '"') {cell += '"'; index++;} else if (character === '"') {quoted = false; closed = true;} else cell += character;}
    else if (character === '"' && !cell && !closed) quoted = true;
    else if (character === delimiter) {row.push(cell); cell = ''; closed = false;}
    else if (character === '\n' || character === '\r') {if (character === '\r' && text[index + 1] === '\n') index++; row.push(cell); rows.push(row); row = []; cell = ''; closed = false;}
    else {requireThat(!closed && character !== '"', 'CSV quoting is incomplete.'); cell += character;}
    requireThat(rows.length <= 20000, 'CSV exceeds the bounded reader; use a scoped host reader.');
  }
  requireThat(!quoted, 'CSV quoting is incomplete.'); if (cell || row.length || closed) {row.push(cell); rows.push(row);}
  const header = rows.shift() ?? [], parts = []; requireThat(header.length <= 200, 'CSV column scope is too large.');
  for (let index = 0; index < rows.length; index++) {
    if (rows[index].every(value => !value)) continue;
    requireThat(rows[index].length === header.length, 'CSV has inconsistent row widths.');
    rows[index].forEach((text, column) => {if (text.trim() && !sensitive(header[column].trim())) parts.push({location: `row ${index + 2}, column ${column + 1} (${header[column]})`, text});});
  }
  requireThat(parts.length <= 20000, 'CSV exceeds the bounded reader; use a scoped host reader.');
  return {parts, coverage: 'complete'};
}
function nativeExtraction(bytes, extension, source, nativeSections) {
  const decoder = new TextDecoder(source.encoding ?? 'utf-8', {fatal: true, ignoreBOM: nativeSections && ['md', 'txt'].includes(extension)}), text = decoder.decode(bytes);
  if (extension === 'json') return jsonParts(text);
  if (['csv', 'tsv'].includes(extension)) return csvParts(text, source.delimiter ?? (extension === 'tsv' ? '\t' : ','));
  if (nativeSections && ['md', 'txt'].includes(extension)) return documentParts(text, extension === 'md', decoder.encoding === 'utf-8');
  const lines = text.split(/\r?\n/), parts = []; let incomplete = false;
  for (let index = 0; index < lines.length; index++) if (lines[index].trim()) {
    if (parts.length >= 20000) incomplete = true;
    else parts.push({location: `lines ${index + 1}-${index + 1}`, text: lines[index]});
  }
  return {parts, coverage: incomplete ? 'partial' : 'complete'};
}
export function contextReaderRecipe(source, readers = {}, previous, nativeSections = true) {
  const extension = extname(source.path ?? source.name ?? '').slice(1).toLowerCase();
  const native = textual.has(extension) || ['json', 'csv', 'tsv'].includes(extension);
  const savedRecipe = businessSource(previous ?? {}) ? previous.extractionRecipe : undefined;
  const extractionRecipe = source.extraction ? fingerprint(source.extraction) : readers[extension] ? fingerprint(String(readers[extension].recipe ?? readers[extension])) : savedRecipe && !nativeReader(savedRecipe) ? savedRecipe : native ? nativeSections ? nativeRecipe(extension) : 'native' : previous?.extractionRecipe ?? 'host-required';
  const recipe = fingerprint({version: RECIPE, extension, extractionRecipe, encoding: source.encoding ?? 'utf-8', delimiter: source.delimiter ?? null, authority: source.authority ?? null});
  return {recipe, extractionRecipe};
}
export async function extractContextBytes(source, bytes, {readers = {}, now = new Date().toISOString(), previous, nativeSections = true} = {}) {
  requireThat(Buffer.isBuffer(bytes) && bytes.length <= 8 * 1024 * 1024, 'Context file exceeds the 8 MiB reader bound.');
  const hash = digest(bytes), extension = extname(source.path ?? source.name ?? '').slice(1).toLowerCase();
  if (source.extraction) requireThat(source.extraction.hash === hash, 'Context extraction hash does not match current file bytes.');
  const {recipe, extractionRecipe} = contextReaderRecipe(source, readers, previous, nativeSections);
  const record = {id: source.id, kind: source.kind, origin: source.origin ?? 'user-supplied', ...(source.path ? {path: source.path} : {}), ...(source.name ? {name: source.name} : {}), ...(source.parentId ? {parentId: source.parentId} : {}), ...(source.collection ? {collection: source.collection} : {}), hash, recipe, recipeVersion: RECIPE, extractionRecipe, retrievedAt: now};
  if (previous?.status === 'verified' && previous.coverage === 'complete' && previous.hash === hash && previous.recipe === recipe) return {...previous, ...record, verifiedAt: now};
  let extraction = source.extraction;
  if (!extraction && readers[extension]) {
    try {extraction = await readers[extension]({bytes, hash, source: structuredClone(source)});} catch {return {...record, status: 'unverified', coverage: 'reader-failed', contributions: []};}
  }
  // A saved host extraction carries business topics and locations even for text/JSON.
  // Changed bytes need a fresh receipt; native parsing cannot replace that choice.
  if (!extraction && businessSource(previous ?? {}) && previous.extractionRecipe && !nativeReader(previous.extractionRecipe)) return {...record, status: 'unsupported', coverage: 'reader-required', contributions: []};
  if (!extraction && (textual.has(extension) || ['json', 'csv', 'tsv'].includes(extension))) {
    try {extraction = {hash, reader: 'native', ...nativeExtraction(bytes, extension, source, nativeSections)};} catch {return {...record, status: 'unverified', coverage: 'unreadable-or-ambiguous', contributions: []};}
  }
  if (!extraction) return {...record, status: 'unsupported', coverage: 'reader-required', contributions: []};
  keys(extraction, ['hash', 'reader', 'coverage', 'parts', 'redacted'], 'context extraction');
  requireThat(extraction.hash === hash, 'Context extraction hash does not match current file bytes.');
  requireThat(typeof extraction.reader === 'string' && extraction.reader.trim() && extraction.reader.length <= 100 && ['complete', 'partial', 'uncertain'].includes(extraction.coverage), 'Invalid context reader/coverage receipt.');
  const authority = source.authority ?? (source.kind === 'repository' ? 'current' : 'observation');
  requireThat(['current', 'reviewed', 'observation'].includes(authority), 'Invalid context authority.');
  requireThat(authority !== 'reviewed' || source.kind === 'repository' && /^\.harness\/knowledge\//.test(source.path?.replaceAll('\\', '/')), 'Only reviewed consumer knowledge can have reviewed authority.');
  requireThat(source.kind === 'repository' || authority === 'observation', 'Supplied files and attachments remain unreviewed observations.');
  const result = contextParts(extraction.parts, authority), redacted = result.redacted + (extraction.redacted ?? 0);
  return {...record, status: extraction.coverage === 'complete' ? 'verified' : 'partial', coverage: extraction.coverage, reader: extraction.reader, ...(redacted ? {redacted} : {}), ...(extraction.coverage === 'complete' ? {verifiedAt: now} : {}), contributions: result.contributions};
}
export async function readFileContext(roots, source, options = {}) {
  requireThat(['repository', 'file'].includes(source.kind) && typeof source.path === 'string' && source.path.length > 0 && !/[\x00-\x1f]/.test(source.path), 'Context source needs an explicitly selected path.');
  requireThat(!privatePath(source.path), 'Credential stores cannot be context sources.');
  const path = source.kind === 'repository' ? consumerPath(roots, source.path) : resolve(roots.projectRoot, source.path);
  requireThat(source.authority !== 'reviewed' || source.kind === 'repository' && within(resolve(roots.projectRoot, '.harness/knowledge'), path), 'Only resolved reviewed consumer knowledge can have reviewed authority.');
  let bytes;
  try {
    const actual = realpathSync(path); requireThat(!privatePath(actual), 'Credential stores cannot be context sources.');
    const stat = statSync(actual); requireThat(stat.isFile() && stat.size <= 8 * 1024 * 1024, 'Context source must be a bounded readable file.'); bytes = readFileSync(actual);
  } catch {return {id: source.id, kind: source.kind, origin: source.origin ?? 'user-supplied', path: source.path, status: 'unverified', coverage: 'inaccessible-or-oversize', retrievedAt: options.now ?? new Date().toISOString(), contributions: []};}
  return extractContextBytes({...source, name: basename(path)}, bytes, options);
}
