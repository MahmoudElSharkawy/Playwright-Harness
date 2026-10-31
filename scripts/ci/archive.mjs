// Inspect a supplied release archive before npm installs it. No extraction or lifecycle scripts.
import assert from 'node:assert/strict';
import {readFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {gunzipSync} from 'node:zlib';
import {sha256, integrity} from '../lib/archive.mjs';
import {inventory, publicationFindings, RUNTIME_BUNDLE_RECORD, runtimeBundleFiles, runtimeBundleIntegrity, validateRuntimeBundle} from '../lib/package-validation.mjs';
import {within, realFuture} from '../lib/skill-roots.mjs';
import {command, npmPath} from './process.mjs';

function paxFields(body) {
  const fields = {};
  for (let offset = 0; offset < body.length;) {
    const space = body.indexOf(32, offset), length = Number(body.subarray(offset, space).toString());
    assert(space > offset && Number.isSafeInteger(length) && length > space - offset + 1 && offset + length <= body.length, 'Invalid archive path record.');
    const record = body.subarray(space + 1, offset + length - 1).toString('utf8'), equals = record.indexOf('=');
    assert(equals > 0 && body[offset + length - 1] === 10, 'Invalid archive path record.');
    fields[record.slice(0, equals)] = record.slice(equals + 1); offset += length;
  }
  return fields;
}

export function archiveFiles(file) {
  const tar = gunzipSync(readFileSync(file), {maxOutputLength: 256 * 1024 * 1024}), files = new Map();
  const text = bytes => bytes.toString('utf8').replace(/\0[\s\S]*$/, '');
  let pax;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512); if (header.every(byte => byte === 0)) break;
    const sizeText = text(header.subarray(124, 136)).trim(), size = Number.parseInt(sizeText, 8);
    assert(/^[0-7]+$/.test(sizeText) && Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length, 'Invalid archive size.');
    const body = tar.subarray(offset + 512, offset + 512 + size), type = text(header.subarray(156, 157)) || '0';
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {pax = paxFields(body); continue;}
    assert(type === '0' || type === '5', 'The archive contains a non-file entry.');
    const prefix = text(header.subarray(345, 500)), path = pax?.path ?? (prefix ? `${prefix}/${text(header.subarray(0, 100))}` : text(header.subarray(0, 100))); pax = undefined;
    assert(path.startsWith('package/') && !path.includes('\\') && !path.includes('\0') && !path.split('/').some(part => part === '..' || part === '.'), 'An archive entry escapes the package.');
    if (type === '5') continue;
    const relative = path.slice('package/'.length); assert(relative && !files.has(relative), 'Duplicate or empty archive file.');
    files.set(relative, body);
  }
  assert(files.size > 0, 'The archive has no files.'); return files;
}

export function inspectArchive(file, root, expectedDigest) {
  const digest = sha256(file);
  if (expectedDigest !== undefined) {
    assert(/^[a-f0-9]{64}$/.test(expectedDigest), 'Supply a SHA-256 digest.');
    assert.equal(digest, expectedDigest, 'The archive checksum differs.');
  }
  const files = archiveFiles(file), source = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const json = name => {assert(files.has(name), `The distributed ${name} is required.`); return JSON.parse(files.get(name).toString('utf8'));};
  const manifest = json('package.json'), lock = json('npm-shrinkwrap.json'), plugin = json('.claude-plugin/plugin.json');
  assert.equal(manifest.name, source.name, 'The archive package identity differs.');
  assert.equal(manifest.version, source.version, 'The archive version differs.'); assert.equal(manifest.private, true);
  assert.equal(basename(file), `${source.name}-${source.version}.tgz`, 'The archive needs its versioned filename.');
  assert.equal(files.get('VERSION')?.toString('utf8').trim(), source.version, 'The distributed VERSION differs.');
  assert.equal(plugin.version, source.version, 'The distributed plugin version differs.');
  assert.deepEqual(lock, JSON.parse(readFileSync(join(root, 'npm-shrinkwrap.json'), 'utf8')), 'The distributed dependency lock differs.');
  assert.equal(manifest.bundleDependencies, true, 'The archive must bundle its cleared runtime dependencies.');
  const runtime = new Map([...files].filter(([path]) => path.startsWith('node_modules/')));
  const paths = validateRuntimeBundle(runtime, lock, json(RUNTIME_BUNDLE_RECORD));
  const scope = inventory(root, {publicOnly: true}); scope.files = [...new Set([...scope.files, RUNTIME_BUNDLE_RECORD])];
  // Local maintainer files are outside the publication allow-list and are never copied into a build.
  assert.deepEqual(publicationFindings({...scope, unexpected: []}, [...files.keys()], paths), [], 'The archive publication scope differs.');
  return {name: basename(file), sha256: digest, integrity: integrity(file), files: files.size};
}

/** Build from public source and a fresh integrity-checked lock install, never local node_modules. */
export function packRuntimeArchive(root, destination, {run = (args, cwd) => command(args, {cwd, timeout: 600000})} = {}) {
  root = resolve(root); destination = resolve(destination);
  assert(!within(realFuture(root), realFuture(destination)), 'Keep packed archives outside the source package.');
  const npm = npmPath(), version = run([npm, '--version'], root);
  assert(version.status === 'PASS' && version.stdout.trim().split('.')[0] === '11', 'Pack release archives with npm 11.');
  const stage = mkdtempSync(join(tmpdir(), 'harness-runtime-build-'));
  try {
    for (const file of inventory(root, {publicOnly: true}).files) {
      if (file === RUNTIME_BUNDLE_RECORD) continue;
      mkdirSync(dirname(join(stage, file)), {recursive: true}); copyFileSync(join(root, file), join(stage, file));
    }
    const lock = JSON.parse(readFileSync(join(stage, 'npm-shrinkwrap.json'), 'utf8'));
    const installed = run([npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], stage);
    assert.equal(installed.status, 'PASS', 'Preparing the locked runtime bundle failed; inspect the build log.');
    assert.deepEqual(JSON.parse(readFileSync(join(stage, 'npm-shrinkwrap.json'), 'utf8')), lock, 'Runtime preparation changed the cleared lock.');
    const record = runtimeBundleIntegrity(runtimeBundleFiles(stage), lock);
    writeFileSync(join(stage, RUNTIME_BUNDLE_RECORD), JSON.stringify(record, null, 2) + '\n', {flag: 'wx'});
    mkdirSync(destination, {recursive: true});
    const packed = run([npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', destination], stage);
    assert.equal(packed.status, 'PASS', 'Packing the runtime bundle failed; inspect the build log.');
    const items = JSON.parse(packed.stdout); assert.equal(items.length, 1);
    const file = join(destination, items[0].filename), files = archiveFiles(file);
    assert.deepEqual(JSON.parse(files.get(RUNTIME_BUNDLE_RECORD)?.toString('utf8')), record, 'The packed build record differs.');
    validateRuntimeBundle(new Map([...files].filter(([path]) => path.startsWith('node_modules/'))), lock, record);
    return {file, ...inspectArchive(file, root)};
  } finally {rmSync(stage, {recursive: true, force: true});}
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  assert(process.argv.length === 3, 'Use archive.mjs <external archive directory>.');
  console.log(JSON.stringify(packRuntimeArchive(resolve(import.meta.dirname, '../..'), process.argv[2])));
}
