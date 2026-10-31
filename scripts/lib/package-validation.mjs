import { readdirSync, readFileSync, lstatSync, existsSync, realpathSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { codeTokens } from './convention-source.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const OMIT_DIRS = new Set(['.git', 'node_modules', '.m1-private', '.validation', 'test-results', 'playwright-report', 'blob-report', 'allure-results', 'allure-report', 'reports', 'ctrf', 'executions', '.playwright-cli']);
const ROOT_FILES = new Set(['README.md', 'AGENTS.md', 'CHANGELOG.md', 'VERSION', '.env.example', '.gitignore', '.npmignore', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'SECURITY.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']);
// Maintainer instructions and this repository's own Claude setup; never shipped into client projects'
// node_modules, where a nested .claude/skills folder would load as duplicate skills.
const SOURCE_ONLY_FILES = new Set(['CLAUDE.md', '.claude/settings.json']);
const SOURCE_ONLY_PREFIXES = ['.claude/skills/'];
const PUBLIC_PREFIXES = ['scripts/', 'harness-tests/', 'docs/', 'examples/', '.agents/skills/'];
const EXTRA_FILES = new Set(['.claude-plugin/plugin.json', '.github/workflows/validation.yml', '.github/workflows/release.yml', 'resources/Queries/README.md', 'resources/apisCollections/README.md']);

export function inventory(root, {publicOnly = false} = {}) {
  root = realpathSync(root);
  const files = [], excluded = [], unexpected = [];
  function walk(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, item.name);
      const file = relative(root, absolute).replaceAll('\\', '/');
      if (item.isSymbolicLink()) { unexpected.push({ file, rule: 'symbolic-link' }); continue; }
      if (item.isDirectory()) {
        if (OMIT_DIRS.has(item.name) || ['execution-tests', 'test', '.harness'].includes(file)) { excluded.push(file); continue; }
        if (publicOnly && !PUBLIC_PREFIXES.some(prefix => prefix.startsWith(`${file}/`) || `${file}/`.startsWith(prefix)) && ![...EXTRA_FILES].some(path => path.startsWith(`${file}/`))) {excluded.push(file); continue;}
        walk(absolute); continue;
      }
      if (!item.isFile()) continue;
      if ((/^\.env(?:\.|$)/.test(item.name) && item.name !== '.env.example') || /\.(dpapi|pfx|key|tgz|zip)$/.test(item.name) || file === '.claude/settings.local.json' || SOURCE_ONLY_FILES.has(file) || SOURCE_ONLY_PREFIXES.some(prefix => file.startsWith(prefix))) { excluded.push(file); continue; }
      const allowed = ROOT_FILES.has(file) || EXTRA_FILES.has(file) || PUBLIC_PREFIXES.some(prefix => file.startsWith(prefix));
      if (!allowed) { unexpected.push({ file, rule: 'unclassified-file' }); continue; }
      files.push(file);
    }
  }
  walk(root);
  return { files: files.sort(), excluded: excluded.sort(), unexpected };
}

export const credentialName = name => /^(?:password|passwd|pwd|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|pat)$/i.test(name)
  || /(?:Password|Passwd|ApiKey|Token|Secret|[_-](?:password|token|secret|api_key|PASSWORD|TOKEN|SECRET|API_KEY))$/.test(name);

export function secretFindings(file, text) {
  const findings = [];
  const placeholder = value => value === '' || /^(?:<[^<>]+>|\$\{[^}]+\}|\{\{[^}]+\}\}|\[REDACTED\])$/.test(value);
  const assignment = /\b([A-Za-z_][A-Za-z0-9_-]*)['"]?\s*[:=]\s*(['"`])([^'"`\r\n]+)\2/g;
  const connection = /\b(?:Password|Pwd)\s*=\s*([^;\s'"`]+)/gi;
  // A connection-string credential is data; a declared/member assignment to a
  // runtime expression is code. Do not classify a generator call by its variable name.
  const tokens = codeTokens(file, text), expressions = new Set(), wrappedLiterals = new Set();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind !== 'identifier' || !/^(?:password|pwd)$/i.test(token.value) || tokens[index + 1]?.value !== '=') continue;
    // Comparing a field (e.g. a report redaction check) is not assigning it.
    if (tokens[index + 2]?.value === '=') {expressions.add(token.start); continue;}
    let declaration = ['const', 'let', 'var', '.'].includes(tokens[index - 1]?.value);
    if (tokens[index - 1]?.value === ',') {
      for (let cursor = index - 2; cursor >= 0 && ![';', '{', '}'].includes(tokens[cursor].value); cursor--) {
        if (['const', 'let', 'var'].includes(tokens[cursor].value)) { declaration = true; break; }
      }
    }
    if (!declaration) continue;
    let embeddedLiteral = false, depth = 0;
    for (let cursor = index + 2; cursor < tokens.length; cursor++) {
      const current = tokens[cursor];
      if (depth === 0 && [';', ',', '}'].includes(current.value)) break;
      if (current.kind === 'string' && !placeholder(current.value)) {
        const previous = tokens[cursor - 1]?.value;
        embeddedLiteral ||= ['|', '&', '?', '=', '+'].includes(previous)
          || previous === '(' && ['atob', 'String'].includes(tokens[cursor - 2]?.value);
      }
      if (current.value === '(' || current.value === '[') depth++;
      if (current.value === ')' || current.value === ']') {if (!depth) break; depth--;}
    }
    if (embeddedLiteral) {wrappedLiterals.add(text.slice(0, token.start).split('\n').length); continue;}
    let value = index + 2;
    while (tokens[value]?.value === '(') value++;
    if (tokens[value]?.kind === 'string') {
      if (!placeholder(tokens[value].value)) wrappedLiterals.add(text.slice(0, token.start).split('\n').length);
      else expressions.add(token.start);
    } else if (tokens[value] && (/^(?:true|false|null|undefined|NaN|Infinity)$/.test(tokens[value].value)
      || /^(?:[+-]\s*)?(?:\d|\.\d)/.test(text.slice(tokens[value].start)))) {
      wrappedLiterals.add(text.slice(0, token.start).split('\n').length);
    } else expressions.add(token.start);
  }
  let offset = 0;
  text.split(/\r?\n/).forEach((line, index) => {
    const categories = new Set();
    if (/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(line)) categories.add('private-key');
    if (/\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?/.test(line)) categories.add('jwt');
    if (/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b/.test(line)) categories.add('access-key');
    for (const match of line.matchAll(assignment)) if (credentialName(match[1]) && !placeholder(match[3])) categories.add('credential-assignment');
    if (wrappedLiterals.has(index + 1)) categories.add('credential-assignment');
    for (const match of line.matchAll(connection)) if (!expressions.has(offset + match.index) && !placeholder(match[1]) && !/^(?:process\.env|\$\{|@|<|\{)/.test(match[1])) categories.add('connection-credential');
    // Neither a convention suppression nor an unrelated env reference exempts a secret.
    for (const rule of categories) findings.push({ file, line: index + 1, rule });
    offset += line.length + (text.slice(offset + line.length, offset + line.length + 2) === '\r\n' ? 2 : 1);
  });
  return findings;
}

const PUBLIC_HOSTS = new Set(['github.com', 'api.github.com', 'raw.githubusercontent.com', 'playwright.dev', 'nodejs.org', 'www.npmjs.com', 'registry.npmjs.org', 'learn.microsoft.com', 'code.claude.com', 'learn.chatgpt.com', 'developers.openai.com', 'json.schemastore.org', 'www.w3.org', 'www.typescriptlang.org', 'allurereport.org', 'mit-license.org', 'opensource.org', 'aka.ms', 'go.microsoft.com', 'node-postgres.com', 'www.postgresql.org']);
// Reviewed upstream funding links present in the dependency lockfile; no host-wide exception.
const PUBLIC_METADATA_URLS=new Set(['https://www.patreon.com/feross','https://feross.org/support','https://dotenvx.com/','https://opencollective.com/fastify','https://opencollective.com/express','https://opencollective.com/preact','https://paulmillr.com/funding/']);
// Reviewed Google-managed CI cache and its official documentation; no host-wide exception.
const PUBLIC_CI_URLS = new Set(['https://mirror.gcr.io', 'https://mirror.gcr.io/', 'https://docs.cloud.google.com/artifact-registry/docs/pull-cached-dockerhub-images']);
// Official collection format identifier; other Postman coordinates still require review.
const PUBLIC_SCHEMA_URLS = new Set(['https://schema.getpostman.com/json/collection/v2.1.0/collection.json']);
export function privacyFindings(file, text) {
  const findings = [];
  const push = (line, rule) => findings.push({ file, line, rule });
  text.split(/\r?\n/).forEach((line, index) => {
    const n = index + 1;
    if (/(?:[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\s/\\]+|\/(?:Users|home)\/[A-Za-z0-9._-]+\/|\bDESKTOP-[A-Z0-9]+\b)/.test(line)) push(n, 'machine-identity');
    if (/\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/.test(line)) push(n, 'private-network-coordinate');
    if (/\bPR\s*[!#]\d+|\bmerged\s+as\s+PR\b/i.test(line)) push(n, 'historical-delivery-record');
    for (const m of line.matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)) {
      const value = m[0];
      const authority=value.match(/^https?:\/\/([^/]+)/)?.[1];
      if (!authority) continue;
      const userInfoEnd=authority.lastIndexOf('@');
      if (userInfoEnd>=0) push(n,'url-userinfo');
      const hostAndPort=authority.slice(userInfoEnd+1);
      const rawHost=hostAndPort.startsWith('[')?hostAndPort.slice(0,hostAndPort.indexOf(']')+1):hostAndPort.split(':')[0];
      if (!rawHost || rawHost.includes('${')) continue; // only a dynamic hostname has no literal host to classify
      let url; try { url = new URL(value.replace(authority,rawHost)); } catch { continue; }
      const host = url.hostname;
      const synthetic = host === 'localhost' || host === '127.0.0.1' || host === 'example.com' || host.endsWith('.example.com') || host.endsWith('.test') || host.endsWith('.invalid');
      if (host === 'dev.azure.com') {
        const organization=value.replace(/^https?:\/\/[^/]+\//,'').split('/')[0];
        if (!organization.startsWith('${') && !/^(?:your-org|example-org)$/.test(organization)) push(n, 'organization-url');
      } else if (!synthetic && !PUBLIC_HOSTS.has(host) && !PUBLIC_METADATA_URLS.has(url.href) && !PUBLIC_CI_URLS.has(value) && !PUBLIC_SCHEMA_URLS.has(value)) push(n, 'unreviewed-url');
    }
  });
  if (/\.jsonl$/.test(file) && text.trim()) push(1, 'populated-runtime-history');
  if (/\.claude\/skills\/plan-tracker\/data\/plan-/.test(file)) push(1, 'populated-plan-registry');
  if (file === '.env.example') text.split(/\r?\n/).forEach((line, i) => { if (/^[A-Z][A-Z0-9_]*=.+/.test(line)) push(i + 1, 'env-example-value'); });
  return findings;
}

export function localLinkFindings(root, file, text) {
  const findings = [];
  let links = 0;
  // Fenced examples and HTML comments are prose examples, not rendered links.
  const visible = text.replace(/<!--[^]*?-->/g, match => match.replace(/[^\n]/g, ' ')).replace(/(^|\n)\s*(```|~~~)[^\n]*\n[^]*?\n\s*\2[^\n]*/g, match => match.replace(/[^\n]/g, ' '));
  for (const match of visible.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    let target = match[1].replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue;
    target = target.split('#')[0].split('?')[0];
    if (!target) continue;
    links++;
    try { target = decodeURIComponent(target); } catch { findings.push({ file, line: 1, rule: 'invalid-link-encoding' }); continue; }
    const destination = resolve(root, file, '..', target);
    const rel = relative(root, destination);
    const line = visible.slice(0, match.index).split('\n').length;
    if (isAbsolute(rel) || rel === '..' || /^\.\.[\\/]/.test(rel)) findings.push({ file, line, rule: 'link-outside-package' });
    else if (!existsSync(destination)) findings.push({ file, line, rule: 'missing-link-target' });
  }
  return { links, findings };
}

export function readSource(root, file) {
  const absolute = join(root, file);
  if (lstatSync(absolute).isSymbolicLink()) throw new Error('symlink refused');
  return readFileSync(absolute, 'utf8');
}

export const RUNTIME_BUNDLE_RECORD = 'scripts/runtime-bundle-integrity.json';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Read runtime files without following dependency links or including npm's generated bin links. */
export function runtimeBundleFiles(root) {
  const files = new Map();
  function walk(directory, path) {
    for (const item of readdirSync(directory, {withFileTypes: true})) {
      const file = `${path}/${item.name}`, absolute = join(directory, item.name);
      if (path.endsWith('node_modules') && item.name === '.bin' || file === 'node_modules/.package-lock.json') continue;
      assert(!item.isSymbolicLink(), 'Runtime bundle contains a symbolic link.');
      if (item.isDirectory()) walk(absolute, file);
      else {assert(item.isFile(), 'Runtime bundle contains a non-file entry.'); files.set(file, readFileSync(absolute));}
    }
  }
  if (existsSync(join(root, 'node_modules'))) walk(join(root, 'node_modules'), 'node_modules');
  return files;
}

/** A build record is created only after a clean integrity-checked npm ci, never from consumer state. */
export function runtimeBundleIntegrity(files, lock) {
  const entries = Object.entries(lock.packages).filter(([path]) => path).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  assert(entries.length > 0, 'Runtime bundle dependency lock is empty.');
  const groups = new Map(entries.map(([path, item]) => {
    assert(/^node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/.test(path), 'Runtime bundle has an invalid dependency path.');
    assert(item.version && item.resolved?.startsWith('https://registry.npmjs.org/') && item.integrity?.startsWith('sha512-'), 'Runtime bundle lacks cleared registry provenance.');
    return [path, []];
  }));
  const owners = [...groups.keys()].sort((a, b) => b.length - a.length);
  for (const [file, bytes] of files) {
    const owner = owners.find(path => file.startsWith(`${path}/`) && !file.slice(path.length + 1).includes('/node_modules/') && !file.slice(path.length + 1).startsWith('node_modules/'));
    assert(owner && !file.includes('\\') && !file.split('/').some(part => part === '.' || part === '..'), 'Runtime bundle contains an unexpected file.');
    groups.get(owner).push([file.slice(owner.length + 1), digest(bytes)]);
  }
  return {schemaVersion: 1, packages: Object.fromEntries(entries.map(([path, item]) => {
    const bytes = files.get(`${path}/package.json`); assert(bytes, 'Runtime bundle is missing a cleared package.');
    const manifest = JSON.parse(bytes.toString('utf8'));
    assert.equal(`${manifest.name}@${manifest.version}`, `${path.split('node_modules/').at(-1)}@${item.version}`, 'Runtime bundle package metadata differs.');
    const list = groups.get(path).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return [path, {version: item.version, resolved: item.resolved, integrity: item.integrity, filesSha256: digest(JSON.stringify(list))}];
  }))};
}

export function validateRuntimeBundle(files, lock, record) {
  assert.deepEqual(runtimeBundleIntegrity(files, lock), record, 'Runtime bundle bytes or provenance differ from the verified build record.');
  return [...files.keys()].sort();
}

export function publicationFindings(scope, paths, runtime = []) {
  const allowed=new Set([...scope.files, ...runtime]);
  const packed=new Set(paths);
  const findings=[...scope.unexpected];
  if (!paths.length || packed.size!==paths.length) findings.push({file:'package.json',rule:'invalid-packed-scope'});
  for(const file of packed) if (!allowed.has(file)) findings.push({file,rule:'unexpected-packed-file'});
  for(const file of allowed) {
    // npm never ships the root lockfile or nested packaging-control files.
    if (file==='package-lock.json' || file==='.npmignore' || file.endsWith('/.npmignore')) continue;
    if (!packed.has(file)) findings.push({file,rule:'missing-packed-file'});
  }
  return findings;
}
