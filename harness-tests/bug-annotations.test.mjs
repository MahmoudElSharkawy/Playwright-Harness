import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync, unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {digest} from '../scripts/lib/execution-core/data.mjs';
import {packageRoot} from '../scripts/lib/consumer-paths.mjs';
import {prepareAnnotation, bindAnnotationReview, verifyAnnotation, inspectScreenshot} from '../scripts/lib/bug-report/annotations.mjs';

function png(width = 120, height = 80) {
  const crc = bytes => {let value = 0xffffffff; for (const byte of bytes) {value ^= byte; for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0);} return (value ^ 0xffffffff) >>> 0;};
  const chunk = (name, bytes) => {const type = Buffer.from(name), output = Buffer.alloc(bytes.length + 12); output.writeUInt32BE(bytes.length); type.copy(output, 4); bytes.copy(output, 8); output.writeUInt32BE(crc(Buffer.concat([type, bytes])), bytes.length + 8); return output;};
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height, 235); for (let row = 0; row < height; row++) pixels[row * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
function fixture(t) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'bug-annotation-')); t.after(() => rmSync(projectRoot, {recursive: true, force: true}));
  const roots = {projectRoot, packageRoot}, source = 'evidence/raw.png', bytes = png(); mkdirSync(join(projectRoot, 'evidence')); writeFileSync(join(projectRoot, source), bytes);
  const request = {source, output: '.harness/runs/bug-example/annotated.png', sourceSha256: digest(bytes), summary: 'Save action is unavailable', expected: 'Save succeeds', actual: 'Save is disabled', boxes: [{kind: 'defect', x: 0.1, y: 0.2, width: 0.5, height: 0.4}], verification: {relevance: true, privacy: true}};
  const deps = {inventory: async () => [{pid: process.pid, identity: 'annotation-test'}], render: async ({html, signal}) => {assert.match(html, /Save succeeds/); assert.equal(signal.aborted, false); return {bytes: png(480, 400), sourceDimensions: {width: 120, height: 80}, dimensions: {width: 480, height: 400}, transform: {displayWidth: 480, displayHeight: 320, offsetX: 0, offsetY: 80}};}};
  return {roots, request, bytes, deps};
}

test('annotation preserves raw bytes and requires an exact visual-review binding', async t => {
  const f = fixture(t), result = await prepareAnnotation(f.roots, f.request, f.deps);
  assert.equal(result.state, 'PREPARED'); assert.deepEqual(readFileSync(join(f.roots.projectRoot, f.request.source)), f.bytes);
  assert.throws(() => verifyAnnotation(f.roots, result), /visual review/i);
  const reviewed = bindAnnotationReview(result, {sourceSha256: result.sourceSha256, specificationFingerprint: result.specificationFingerprint, outputSha256: result.sha256, relevance: true, placement: true, privacy: true});
  const verified = verifyAnnotation(f.roots, reviewed); assert.equal(digest(verified.bytes), result.sha256); assert.equal(digest(verified.rawBytes), f.request.sourceSha256);
  assert.throws(() => bindAnnotationReview(result, {...reviewed.visualReview, outputSha256: '0'.repeat(64)}), /binding/i);
});

test('raw-only screenshot inspection rejects header-only PNG and unverified JPEG frames', t => {
  const f = fixture(t), valid = inspectScreenshot(f.roots, f.request.source, f.request.sourceSha256);
  assert.deepEqual(valid.dimensions, {width: 120, height: 80}); assert.equal(valid.mimeType, 'image/png'); assert.deepEqual(valid.bytes, f.bytes);
  const headerOnly = Buffer.alloc(40); Buffer.from('89504e470d0a1a0a', 'hex').copy(headerOnly); headerOnly.writeUInt32BE(120, 16); headerOnly.writeUInt32BE(80, 20);
  writeFileSync(join(f.roots.projectRoot, f.request.source), headerOnly); assert.throws(() => inspectScreenshot(f.roots, f.request.source, digest(headerOnly)), /PNG|image|corrupt/i);
  const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 80, 0, 120, 3, 0xff, 0xd9]);
  writeFileSync(join(f.roots.projectRoot, f.request.source), fakeJpeg); assert.throws(() => inspectScreenshot(f.roots, f.request.source, digest(fakeJpeg)), /JPEG|PNG|image/i);
  assert.throws(() => inspectScreenshot(f.roots, f.request.source, digest(fakeJpeg), Infinity), /bound/i);
});

test('annotation escapes labels, retains Unicode/RTL and records relative geometry', async t => {
  const f = fixture(t); f.request.summary = '<img src=x onerror=alert(1)> وصف المشكلة'; f.request.expected = 'القيمة المتوقعة & safe';
  f.deps.render = async ({html}) => {assert.match(html, /&lt;img src=x/); assert.doesNotMatch(html, /<img src=x/); assert.match(html, /dir="auto"/); assert.match(html, /القيمة المتوقعة &amp; safe/); return {bytes: png(480, 400), sourceDimensions: {width: 120, height: 80}, dimensions: {width: 480, height: 400}, transform: {displayWidth: 480, displayHeight: 320, offsetX: 0, offsetY: 80}};};
  const result = await prepareAnnotation(f.roots, f.request, f.deps); assert.equal(result.state, 'PREPARED'); assert.equal(result.specification.boxes[0].x, 0.1); assert.equal(result.transform.offsetY, 80);
});

test('only harmless rounding is adjusted; invalid or meaningless geometry falls back to eligible raw', async t => {
  const f = fixture(t); f.request.boxes[0].x = -0.000001; const rounded = await prepareAnnotation(f.roots, f.request, f.deps); assert.equal(rounded.state, 'PREPARED'); assert.equal(rounded.specification.boxes[0].x, 0);
  for (const patch of [{x: -0.2}, {x: Number.NaN}, {width: 0}, {width: 0.000001}, {x: 0.9, width: 0.5}]) {
    const next = {...f.request, output: `.harness/runs/bug-example/invalid-${Object.keys(patch).join('-')}.png`, boxes: [{...f.request.boxes[0], ...patch}]};
    const result = await prepareAnnotation(f.roots, next, f.deps); assert.equal(result.state, 'RAW_ONLY'); assert.equal(result.reason, 'invalid-geometry');
  }
});

test('ineligible, changed or corrupt raw evidence never becomes eligible through fallback', async t => {
  const f = fixture(t);
  await assert.rejects(prepareAnnotation(f.roots, {...f.request, verification: {relevance: true, privacy: false}}, f.deps), /eligible|privacy/i);
  await assert.rejects(prepareAnnotation(f.roots, {...f.request, sourceSha256: '0'.repeat(64)}, f.deps), /changed|hash/i);
  const corrupt = Buffer.from(f.bytes); corrupt[corrupt.length - 15] ^= 1; writeFileSync(join(f.roots.projectRoot, f.request.source), corrupt);
  await assert.rejects(prepareAnnotation(f.roots, {...f.request, sourceSha256: digest(corrupt)}, f.deps), /image|PNG|corrupt/i);
});

test('source replacement, linked/foreign paths and existing output are never overwritten', async t => {
  const f = fixture(t); await assert.rejects(prepareAnnotation(f.roots, {...f.request, output: f.request.source}, f.deps), /output|source/i);
  await assert.rejects(prepareAnnotation(f.roots, {...f.request, source: '../outside.png'}, f.deps), /path|consumer/i);
  symlinkSync(join(f.roots.projectRoot, 'evidence'), join(f.roots.projectRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareAnnotation(f.roots, {...f.request, source: 'linked/raw.png'}, f.deps), /linked/i);
  unlinkSync(join(f.roots.projectRoot, 'linked'));
  const result = await prepareAnnotation(f.roots, f.request, f.deps), before = readFileSync(join(f.roots.projectRoot, result.output));
  f.request.summary = 'A revised observation'; const fallback = await prepareAnnotation(f.roots, f.request, f.deps); assert.equal(fallback.state, 'RAW_ONLY'); assert.equal(fallback.reason, 'output-exists'); assert.deepEqual(readFileSync(join(f.roots.projectRoot, result.output)), before);
});

test('missing renderer, render/cleanup failure, corrupt output and timeout use explicit raw-only fallback', async t => {
  for (const [name, render] of [['renderer-unavailable', async () => {throw Object.assign(new Error('absent'), {code: 'RENDERER_UNAVAILABLE'});}], ['render-failed', async () => {throw new Error('fault');}], ['cleanup-failed', async () => ({bytes: png(480, 400), sourceDimensions: {width: 120, height: 80}, dimensions: {width: 480, height: 400}, cleanup: async () => {throw new Error('fault');}})], ['invalid-output', async () => ({bytes: Buffer.from('bad'), sourceDimensions: {width: 120, height: 80}, dimensions: {width: 480, height: 400}})], ['render-timeout', ({signal}) => new Promise(() => {signal.addEventListener('abort', () => {});})]]) {
    const f = fixture(t); const result = await prepareAnnotation(f.roots, {...f.request, timeoutMs: 25}, {...f.deps, render}); assert.equal(result.state, 'RAW_ONLY', name); assert.equal(result.reason, name); assert.equal(existsSync(join(f.roots.projectRoot, f.request.output)), false);
  }
});

test('derived bytes are independently bounded and source/output dimensions must match decoded content', async t => {
  const f = fixture(t); f.deps.render = async () => ({bytes: png(480, 400), sourceDimensions: {width: 121, height: 80}, dimensions: {width: 480, height: 400}});
  assert.equal((await prepareAnnotation(f.roots, f.request, f.deps)).reason, 'invalid-output');
  f.deps.render = async () => ({bytes: png(480, 400), sourceDimensions: {width: 120, height: 80}, dimensions: {width: 481, height: 400}});
  assert.equal((await prepareAnnotation(f.roots, f.request, f.deps)).reason, 'invalid-output');
  f.deps.render = async () => ({bytes: png(480, 400), sourceDimensions: {width: 120, height: 80}, dimensions: {width: 480, height: 400}});
  assert.equal((await prepareAnnotation(f.roots, {...f.request, maxBytes: f.bytes.length}, f.deps)).reason, 'invalid-output');
});

test('a source changed during rendering cannot become a raw-only deliverable', async t => {
  const f = fixture(t); f.deps.render = async () => {writeFileSync(join(f.roots.projectRoot, f.request.source), png(121, 80)); throw new Error('render failed after source changed');};
  await assert.rejects(prepareAnnotation(f.roots, f.request, f.deps), /changed|hash/i);
  assert.equal(existsSync(join(f.roots.projectRoot, f.request.output)), false);
});

test('unchanged preparation reuses exact output without rendering or resetting corrections', async t => {
  const f = fixture(t), first = await prepareAnnotation(f.roots, f.request, f.deps);
  const again = await prepareAnnotation(f.roots, f.request, {...f.deps, render: () => {throw new Error('must not rerender');}}); assert.equal(again.sha256, first.sha256); assert.equal(again.specificationFingerprint, first.specificationFingerprint);
  for (let count = 1; count <= 2; count++) {const result = await prepareAnnotation(f.roots, {...f.request, output: `.harness/runs/bug-example/correction-${count}.png`, boxes: [{...f.request.boxes[0], x: 0.1 + count / 10}]}, f.deps); assert.equal(result.state, 'PREPARED'); assert.equal(result.correctionCount, count);}
  const limit = await prepareAnnotation(f.roots, {...f.request, correctionCount: 0, output: '.harness/runs/bug-example/correction-3.png', boxes: [{...f.request.boxes[0], x: 0.4}]}, f.deps); assert.equal(limit.state, 'RAW_ONLY'); assert.equal(limit.reason, 'correction-limit');
});

test('changed derived or raw bytes invalidate a previously reviewed annotation', async t => {
  const f = fixture(t), result = await prepareAnnotation(f.roots, f.request, f.deps), reviewed = bindAnnotationReview(result, {sourceSha256: result.sourceSha256, specificationFingerprint: result.specificationFingerprint, outputSha256: result.sha256, relevance: true, placement: true, privacy: true});
  writeFileSync(join(f.roots.projectRoot, result.output), png(480, 401)); assert.throws(() => verifyAnnotation(f.roots, reviewed), /changed|hash/i);
  writeFileSync(join(f.roots.projectRoot, result.output), png(480, 400)); writeFileSync(join(f.roots.projectRoot, f.request.source), png(121, 80)); assert.throws(() => verifyAnnotation(f.roots, reviewed), /changed|hash/i);
});
