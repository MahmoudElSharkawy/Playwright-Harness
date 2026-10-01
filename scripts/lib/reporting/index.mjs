import {mkdirSync, writeFileSync} from 'node:fs';
import {join, dirname, relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {consumerRoots, consumerPath} from '../consumer-paths.mjs';
import {digest, requireThat} from '../execution-core/data.mjs';
import {reportView} from './model.mjs';
import {renderJson, renderMarkdown, renderHtml} from './render.mjs';
export {reportView, renderJson, renderMarkdown, renderHtml};

/** New consumer report directory only; never replace source, package files or a prior run. */
export function reportDirectory(inputRoots, path) {
  const roots = consumerRoots(inputRoots.projectRoot, inputRoots.packageRoot);
  requireThat(typeof path === 'string' && path.startsWith('reports/') && !/[\\\r\n\0:]/.test(path) && path.split('/').every(part => part && !['.', '..'].includes(part)), 'Report output must be relative consumer reports/ storage.');
  const directory = consumerPath(roots, path); mkdirSync(dirname(directory), {recursive: true, mode: 0o700});
  requireThat(consumerPath(roots, path) === directory, 'Report directory ownership changed.');
  mkdirSync(directory, {mode: 0o700}); return directory;
}

/** Separate delivery status from immutable test verdicts. A manifest is the completion marker. */
export function writeReports(roots, result, {directory} = {}) {
  try {
    const view = reportView(result), output = reportDirectory(roots, directory ?? `reports/harness/${view.runId}-${randomUUID()}`);
    const files = [['result.json', renderJson(view)], ['report.md', renderMarkdown(view)], ['index.html', renderHtml(view)]];
    const artifacts = files.map(([name, body]) => {writeFileSync(join(output, name), body, {flag: 'wx', mode: 0o600}); return {path: name, bytes: Buffer.byteLength(body), sha256: digest(body)};});
    const receipt = {version: 1, status: 'WRITTEN', runId: view.runId, verdict: view.status, stability: view.stability, reportFingerprint: view.fingerprint, artifacts};
    writeFileSync(join(output, 'manifest.json'), JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx', mode: 0o600, flush: true});
    return {...receipt, directory: relative(roots.projectRoot, output).replaceAll('\\', '/')};
  } catch {return {status: 'FAILED', reason: 'Report validation or output failed; the execution verdict is unchanged.'};}
}

/** Call inside the current technical test.step. Optional presentation can never mask an operation/assertion failure. */
export async function attachResult(test, result) {
  let info; try {info = test.info();} catch {return {status: 'NOT_IN_TEST'};}
  try {
    const view = reportView(result);
    await info.attach('Harness execution result', {body: renderJson(view), contentType: 'application/json'});
    await info.attach('Harness execution report', {body: renderHtml(view), contentType: 'text/html'});
    return {status: 'ATTACHED', runId: view.runId};
  } catch {return {status: 'FAILED', reason: 'Harness attachments unavailable; the execution verdict is unchanged.'};}
}
