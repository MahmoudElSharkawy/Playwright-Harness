import {existsSync, lstatSync, openSync, closeSync, fstatSync, readSync, mkdirSync, writeFileSync, unlinkSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {createRequire} from 'node:module';
import {inflateSync} from 'node:zlib';
import {consumerPath} from '../consumer-paths.mjs';
import {digest, fingerprint, data, requireThat} from '../execution-core/data.mjs';
import {escapeHtml} from '../reporting/render.mjs';
import {nativeCliInstallation} from '../browser/native-cli.mjs';
import {withTransition} from '../execute/lock.mjs';
import {readBounded, writeJson} from '../execute/storage.mjs';

const MAX_BYTES = 8 * 1024 * 1024, MAX_PIXELS = 16000000, ROUNDING = 0.00001;
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fault = code => Object.assign(new Error('Local screenshot annotation is unavailable.'), {code});

function safePath(roots, value) {
  requireThat(typeof value === 'string' && value.length <= 1024 && !/[\\:\0\r\n]/.test(value) && !value.startsWith('/') && value.split('/').every(part => part && !['.', '..'].includes(part)), 'Annotation path must be consumer-relative.');
  let cursor = roots.projectRoot;
  for (const part of value.split('/')) {cursor = join(cursor, part); if (existsSync(cursor)) requireThat(!lstatSync(cursor).isSymbolicLink(), 'Linked annotation paths are ineligible.');}
  return consumerPath(roots, value);
}
function readImage(roots, path, sha256, maximum) {
  requireThat(validHash(sha256), 'Source image hash is required.');
  const file = safePath(roots, path), descriptor = openSync(file, 'r');
  try {
    const stat = fstatSync(descriptor); requireThat(stat.isFile() && stat.size > 0 && stat.size <= maximum, 'Image is ineligible or exceeds its size bound.');
    const bytes = Buffer.alloc(stat.size + 1); let length = 0, count;
    while (length < bytes.length && (count = readSync(descriptor, bytes, length, bytes.length - length, length)) > 0) length += count;
    requireThat(length === stat.size && fstatSync(descriptor).size === stat.size && digest(bytes.subarray(0, length)) === sha256, 'Image bytes/hash changed.');
    return {bytes: bytes.subarray(0, length), ...imageDimensions(bytes.subarray(0, length))};
  } finally {closeSync(descriptor);}
}
/** Synchronous intake/file boundary: verify bounded bytes, integrity and supported decoded PNG structure. */
export function inspectScreenshot(roots, path, sha256, maximum = 2 * 1024 * 1024) {
  requireThat(Number.isSafeInteger(maximum) && maximum > 0 && maximum <= MAX_BYTES, 'Invalid screenshot byte bound.');
  return readImage(roots, path, sha256, maximum);
}
function crc32(bytes) {let value = 0xffffffff; for (const byte of bytes) {value ^= byte; for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0);} return (value ^ 0xffffffff) >>> 0;}
function dimensions(width, height) {requireThat(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= MAX_PIXELS, 'Image dimensions exceed supported bounds.'); return {width, height};}
function imageDimensions(bytes) {
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    let cursor = 8, header, ended = false; const compressed = [];
    while (cursor + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(cursor), end = cursor + 12 + length;
      requireThat(end <= bytes.length, 'Corrupt PNG image chunk.');
      const kind = bytes.subarray(cursor + 4, cursor + 8).toString(), payload = bytes.subarray(cursor + 8, end - 4);
      requireThat(crc32(bytes.subarray(cursor + 4, end - 4)) === bytes.readUInt32BE(end - 4), 'Corrupt PNG image checksum.');
      if (!header) {requireThat(kind === 'IHDR' && length === 13, 'PNG image has no valid header.'); header = payload;}
      else requireThat(kind !== 'IHDR', 'Duplicate PNG image header.');
      if (kind === 'IDAT') compressed.push(payload);
      cursor = end; if (kind === 'IEND') {requireThat(length === 0 && cursor === bytes.length, 'Corrupt PNG image ending.'); ended = true; break;}
    }
    requireThat(header && ended && compressed.length, 'Incomplete PNG image.');
    const size = dimensions(header.readUInt32BE(0), header.readUInt32BE(4)), channels = {0: 1, 2: 3, 4: 2, 6: 4}[header[9]], depth = header[8];
    requireThat(channels && (header[9] === 0 ? [1, 2, 4, 8, 16] : [8, 16]).includes(depth) && header[10] === 0 && header[11] === 0 && header[12] === 0, 'Unsupported PNG image encoding.');
    requireThat(header[9] === 0 || [8, 16].includes(depth), 'Unsupported PNG color/bit-depth combination.');
    const stride = Math.ceil(size.width * channels * depth / 8) + 1, expected = stride * size.height;
    let pixels; try {pixels = inflateSync(Buffer.concat(compressed), {maxOutputLength: expected});} catch {throw new Error('Corrupt PNG image data.');}
    requireThat(pixels.length === expected, 'Corrupt PNG image pixels.');
    for (let row = 0; row < size.height; row++) requireThat(pixels[row * stride] <= 4, 'Corrupt PNG image filter.');
    return {dimensions: size, mimeType: 'image/png'};
  }
  // A JPEG SOF/EOI header cannot prove decodable image data. No synchronous JPEG
  // decoder is installed in this boundary; require an original supported PNG.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) throw new Error('JPEG screenshot decoding is unavailable; select an original supported PNG capture.');
  throw new Error('Image is not a supported intact PNG.');
}
function normalizeBoxes(boxes, source) {
  requireThat(Array.isArray(boxes) && boxes.length > 0 && boxes.length <= 20 && boxes.some(box => box?.kind === 'defect'), 'Invalid annotation geometry.');
  return boxes.map(box => {
    requireThat(box && ['defect', 'comparison'].includes(box.kind) && ['x', 'y', 'width', 'height'].every(key => typeof box[key] === 'number' && Number.isFinite(box[key])), 'Invalid annotation geometry.');
    let {x, y, width, height} = box;
    requireThat(x >= -ROUNDING && y >= -ROUNDING && x <= 1 && y <= 1 && width > 0 && height > 0 && x + width <= 1 + ROUNDING && y + height <= 1 + ROUNDING, 'Invalid annotation geometry.');
    x = Math.max(0, x); y = Math.max(0, y); width = Math.min(width, 1 - x); height = Math.min(height, 1 - y);
    requireThat(width * source.width >= 1 && height * source.height >= 1, 'Meaningless annotation geometry.');
    return {kind: box.kind, x, y, width, height};
  });
}
function annotationHtml(specification, raw) {
  const h = escapeHtml, width = Math.min(1600, Math.max(480, raw.dimensions.width));
  const boxes = specification.boxes.map(box => `<div class="box ${box.kind}" style="left:${box.x * 100}%;top:${box.y * 100}%;width:${box.width * 100}%;height:${box.height * 100}%"></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>*{box-sizing:border-box}html,body{margin:0;width:${width}px;background:#fff;color:#17202a;font:16px Arial,sans-serif}.banner{padding:16px;background:#fff4f4;border-bottom:3px solid #b91c1c;overflow-wrap:anywhere;white-space:pre-wrap}.summary{font-size:20px;font-weight:bold;margin-bottom:12px}.label{margin:6px 0}.frame{position:relative;width:${width}px}img{display:block;width:100%;height:auto}.box{position:absolute;border:3px solid #c70000;background:rgba(199,0,0,.06);min-width:1px;min-height:1px}.comparison{border-color:#137333;background:rgba(19,115,51,.05)}</style></head><body><section class="banner"><div class="summary" dir="auto">${h(specification.summary)}</div><div class="label" dir="auto"><strong>Expected:</strong> ${h(specification.expected)}</div><div class="label" dir="auto"><strong>Actual:</strong> ${h(specification.actual)}</div></section><div class="frame"><img alt="Verified raw screenshot" src="data:${raw.mimeType};base64,${raw.bytes.toString('base64')}">${boxes}</div></body></html>`;
}
function bounded(promise, milliseconds, onTimeout = () => {}) {
  let timer; const timeout = new Promise((_, reject) => {timer = setTimeout(() => {onTimeout(); reject(fault('RENDER_TIMEOUT'));}, milliseconds);});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
async function renderInstalled(roots, {html, signal, timeoutMs}) {
  let chromium; try {const installation = nativeCliInstallation(roots.packageRoot); ({chromium} = createRequire(installation.executable)('playwright'));} catch {throw fault('RENDERER_UNAVAILABLE');}
  let server, browser, result, cleanupFailed = false;
  const kill = () => {if (server) {try {server.process().kill('SIGKILL');} catch {cleanupFailed = true;}}};
  signal.addEventListener('abort', kill, {once: true});
  try {
    try {server = await chromium.launchServer({headless: true, timeout: timeoutMs});} catch {throw fault('RENDERER_UNAVAILABLE');}
    if (signal.aborted) {kill(); throw fault('RENDER_TIMEOUT');}
    browser = await chromium.connect(server.wsEndpoint(), {timeout: timeoutMs});
    const context = await browser.newContext({viewport: {width: 1600, height: 1000}, serviceWorkers: 'block', javaScriptEnabled: false}); await context.route('**/*', route => route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(timeoutMs); await page.setContent(html, {waitUntil: 'load', timeout: timeoutMs});
    const geometry = await page.evaluate(async () => {const image = document.querySelector('img'); await image.decode(); const box = image.getBoundingClientRect(); return {sourceDimensions: {width: image.naturalWidth, height: image.naturalHeight}, dimensions: {width: Math.ceil(document.body.scrollWidth), height: Math.ceil(document.body.scrollHeight)}, transform: {displayWidth: box.width, displayHeight: box.height, offsetX: box.x, offsetY: box.y}};});
    dimensions(geometry.dimensions.width, geometry.dimensions.height); await page.setViewportSize({width: geometry.dimensions.width, height: geometry.dimensions.height});
    result = {bytes: await page.screenshot({type: 'png', fullPage: true, timeout: timeoutMs}), ...geometry};
  } finally {
    signal.removeEventListener('abort', kill);
    if (server) {try {await bounded(server.close(), Math.min(2000, timeoutMs), kill);} catch {kill(); cleanupFailed = true;}}
    if (cleanupFailed) throw fault('CLEANUP_FAILED');
  }
  return result;
}

/** Local preparation only. PREPARED requires inspecting both exact images before review binding. */
export async function prepareAnnotation(roots, request, dependencies = {}) {
  requireThat(request && request.verification?.relevance === true && request.verification?.privacy === true, 'Raw image must be reviewed for relevance and privacy before it is eligible.');
  const maximum = request.maxBytes ?? 2 * 1024 * 1024; requireThat(Number.isSafeInteger(maximum) && maximum > 0 && maximum <= MAX_BYTES, 'Invalid image size bound.');
  const raw = readImage(roots, request.source, request.sourceSha256, maximum), output = safePath(roots, request.output);
  requireThat(/^\.harness\/runs\/[A-Za-z0-9_-]+\/.+/.test(request.output) && output !== resolve(roots.projectRoot, request.source), 'Annotation output must be a separate new run artifact.');
  const base = {version: 1, source: request.source, sourceSha256: request.sourceSha256, sourceBytes: raw.bytes.length, sourceDimensions: raw.dimensions, mimeType: raw.mimeType, verification: {relevance: true, privacy: true}, maxBytes: maximum};
  const fallback = reason => ({...base, state: 'RAW_ONLY', reason});
  let boxes; try {boxes = normalizeBoxes(request.boxes, raw.dimensions);} catch {return fallback('invalid-geometry');}
  let specification; try {specification = data({summary: request.summary, expected: request.expected, actual: request.actual, boxes}, 32768); requireThat(['summary', 'expected', 'actual'].every(key => typeof specification[key] === 'string' && specification[key].trim() && specification[key].length <= 4000), 'Invalid annotation labels.');} catch {return fallback('invalid-labels');}
  const specificationFingerprint = fingerprint(specification), root = request.output.split('/').slice(0, 3).join('/'), historyPath = `${root}/annotations/${request.sourceSha256}.json`, recordPath = `${request.output}.annotation.json`;
  return withTransition(roots, async () => {
    const persisted = safePath(roots, recordPath);
    if (existsSync(output)) {
      if (existsSync(persisted)) {const previous = readBounded(persisted); if (previous.source === request.source && previous.output === request.output && previous.sourceSha256 === request.sourceSha256 && previous.inputFingerprint === specificationFingerprint) {try {verifyPrepared(roots, previous); return previous;} catch {return fallback('invalid-output');}}}
      return fallback('output-exists');
    }
    const historyFile = safePath(roots, historyPath), history = existsSync(historyFile) ? readBounded(historyFile) : {version: 1, sourceSha256: request.sourceSha256, specifications: []};
    requireThat(history.version === 1 && history.sourceSha256 === request.sourceSha256 && Array.isArray(history.specifications) && history.specifications.length <= 3, 'Annotation history is invalid.');
    let correctionCount = history.specifications.indexOf(specificationFingerprint);
    if (correctionCount < 0) {correctionCount = history.specifications.length; if (correctionCount > 2) return fallback('correction-limit'); history.specifications.push(specificationFingerprint); writeJson(historyFile, history);}
    if (request.correctionCount !== undefined && (!Number.isSafeInteger(request.correctionCount) || request.correctionCount < 0 || request.correctionCount > 2)) return fallback('correction-limit');
    const timeoutMs = request.timeoutMs ?? 15000; requireThat(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 30000, 'Annotation render deadline must be 1–30000 ms.');
    const controller = new AbortController(); let rendered;
    try {
      rendered = await bounded(Promise.resolve().then(() => (dependencies.render ?? (input => renderInstalled(roots, input)))({html: annotationHtml(specification, raw), sourceBytes: raw.bytes, sourceDimensions: raw.dimensions, signal: controller.signal, timeoutMs})), timeoutMs, () => controller.abort());
      if (rendered?.cleanup) {try {await bounded(Promise.resolve().then(() => rendered.cleanup()), Math.min(2000, timeoutMs));} catch {throw fault('CLEANUP_FAILED');}}
      let decoded; try {requireThat(Buffer.isBuffer(rendered?.bytes) && rendered.bytes.length <= maximum && digest(rendered.bytes) !== request.sourceSha256, 'Invalid derived image.'); decoded = imageDimensions(rendered.bytes); requireThat(decoded.mimeType === 'image/png' && fingerprint(rendered.sourceDimensions) === fingerprint(raw.dimensions) && fingerprint(rendered.dimensions) === fingerprint(decoded.dimensions), 'Decoded annotation dimensions do not match.');} catch {throw fault('INVALID_OUTPUT');}
      const transform = rendered.transform ?? {displayWidth: decoded.dimensions.width, displayHeight: raw.dimensions.height, offsetX: 0, offsetY: 0};
      requireThat(['displayWidth', 'displayHeight', 'offsetX', 'offsetY'].every(key => typeof transform[key] === 'number' && Number.isFinite(transform[key])) && transform.displayWidth > 0 && transform.displayHeight > 0 && transform.offsetX >= 0 && transform.offsetY >= 0 && transform.offsetX + transform.displayWidth <= decoded.dimensions.width && transform.offsetY + transform.displayHeight <= decoded.dimensions.height, 'Invalid annotation transform.');
      // Source bytes and output path are checked again immediately before exclusive publication.
      readImage(roots, request.source, request.sourceSha256, maximum); safePath(roots, request.output); mkdirSync(dirname(output), {recursive: true, mode: 0o700});
      const boundSpecification = {...specification, sourceDimensions: raw.dimensions, transform};
      const result = {...base, state: 'PREPARED', specification: boundSpecification, specificationFingerprint: fingerprint(boundSpecification), inputFingerprint: specificationFingerprint, output: request.output, sha256: digest(rendered.bytes), bytes: rendered.bytes.length, dimensions: decoded.dimensions, transform, correctionCount};
      writeFileSync(output, rendered.bytes, {flag: 'wx', mode: 0o600, flush: true});
      try {writeJson(persisted, result, {exclusive: true});} catch (error) {unlinkSync(output); throw error;}
      return result;
    } catch (error) {readImage(roots, request.source, request.sourceSha256, maximum); return fallback(({RENDERER_UNAVAILABLE: 'renderer-unavailable', RENDER_TIMEOUT: 'render-timeout', CLEANUP_FAILED: 'cleanup-failed', INVALID_OUTPUT: 'invalid-output'})[error.code] ?? 'render-failed');}
    finally {controller.abort();}
  }, {key: `annotation-${request.sourceSha256.slice(0, 24)}`, attempts: 1, ...(dependencies.inventory ? {inventory: dependencies.inventory} : {})});
}

/** The reviewer must inspect the exact raw/derived pair; this records, rather than substitutes for, that review. */
export function bindAnnotationReview(record, review) {
  requireThat(record?.state === 'PREPARED' && review?.sourceSha256 === record.sourceSha256 && review?.specificationFingerprint === record.specificationFingerprint && review?.outputSha256 === record.sha256 && review.relevance === true && review.placement === true && review.privacy === true, 'Annotation visual-review binding does not match the prepared pair.');
  return {...data(record), state: 'REVIEWED', visualReview: data(review)};
}
export function verifyAnnotation(roots, record) {
  requireThat(record?.state === 'REVIEWED' && record.visualReview?.sourceSha256 === record.sourceSha256 && record.visualReview?.specificationFingerprint === record.specificationFingerprint && record.visualReview?.outputSha256 === record.sha256 && record.visualReview.relevance === true && record.visualReview.placement === true && record.visualReview.privacy === true, 'Annotation requires an exact visual review.');
  return verifyPrepared(roots, record);
}
function verifyPrepared(roots, record) {
  requireThat(record.version === 1 && Number.isSafeInteger(record.maxBytes) && record.maxBytes > 0 && record.maxBytes <= MAX_BYTES && record.verification?.relevance === true && record.verification?.privacy === true, 'Annotation eligibility changed.');
  requireThat(fingerprint(record.specification) === record.specificationFingerprint && fingerprint(record.specification.transform) === fingerprint(record.transform) && fingerprint(record.specification.sourceDimensions) === fingerprint(record.sourceDimensions), 'Annotation specification changed.');
  const raw = readImage(roots, record.source, record.sourceSha256, record.maxBytes), derived = readImage(roots, record.output, record.sha256, record.maxBytes);
  requireThat(raw.bytes.length === record.sourceBytes && derived.bytes.length === record.bytes && fingerprint(raw.dimensions) === fingerprint(record.sourceDimensions) && fingerprint(derived.dimensions) === fingerprint(record.dimensions), 'Reviewed image dimensions/bytes changed.');
  return {bytes: derived.bytes, rawBytes: raw.bytes, sourceSha256: record.sourceSha256, sha256: record.sha256, sourceDimensions: raw.dimensions, dimensions: derived.dimensions};
}
