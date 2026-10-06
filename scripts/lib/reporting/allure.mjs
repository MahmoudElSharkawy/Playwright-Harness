import {createRequire} from 'node:module';
import {readFileSync, readdirSync, lstatSync, writeFileSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {consumerRoots, consumerPath} from '../consumer-paths.mjs';
import {digest, requireThat, data} from '../execution-core/data.mjs';
import {verificationRecord} from '../generation/index.mjs';
import {escapeHtml} from './render.mjs';

export function installedAllure(roots, name) {
  requireThat(['allure-playwright', 'allure'].includes(name), 'Unsupported Allure component.');
  const require = createRequire(join(roots.projectRoot, 'package.json')), entry = require.resolve(name);
  let directory = dirname(entry);
  for (let depth = 0; depth < 5; depth++, directory = dirname(directory)) {
    const file = join(directory, 'package.json');
    if (existsSync(file)) {const manifest = JSON.parse(readFileSync(file, 'utf8')); if (manifest.name === name) return {require, entry, directory, version: manifest.version};}
  }
  throw new Error('Installed Allure metadata unavailable.');
}

/** Bounded inventory after native reporter flush; no linked attachments or path escapes. */
export function allureInventory(directory) {
  const files = []; let total = 0;
  function walk(path, prefix = '') {
    requireThat(!lstatSync(path).isSymbolicLink(), 'Allure results cannot redirect.');
    for (const name of readdirSync(path).sort()) {
      const file = join(path, name), stat = lstatSync(file); requireThat(!stat.isSymbolicLink(), 'Allure artifacts cannot be linked.');
      if (stat.isDirectory()) walk(file, prefix + name + '/');
      else {
        requireThat(stat.isFile() && stat.size <= 16 * 1024 * 1024 && files.length < 10000 && (total += stat.size) <= 128 * 1024 * 1024, 'Allure results exceed bounds.');
        files.push({path: prefix + name, bytes: stat.size, sha256: digest(readFileSync(file))});
      }
    }
  }
  walk(directory); return files;
}

/** Separate report job after the native process exits and all reporters have flushed. */
export async function generateAllure(inputRoots, directory) {
  let phase = 'CAPTURE';
  try {
    const roots = consumerRoots(inputRoots.projectRoot, inputRoots.packageRoot);
    requireThat(typeof directory === 'string' && directory.startsWith('reports/') && !/[\\:\r\n]/.test(directory) && directory.split('/').every(p => p && !['.', '..'].includes(p)), 'Use a relative captured report directory.');
    const path = consumerPath(roots, directory), captureFile = consumerPath(roots, `${directory}/capture.json`);
    const manifest = data(JSON.parse(readFileSync(captureFile, 'utf8')));
    requireThat(manifest.status === 'CAPTURED' && manifest.source === 'playwright-native' && manifest.tests > 0, 'Allure capture is incomplete or empty.');
    const current = allureInventory(join(path, 'allure-results'));
    requireThat(JSON.stringify(current) === JSON.stringify(manifest.artifacts), 'Allure evidence changed after capture.');
    requireThat(current.filter(item => item.path.endsWith('-result.json')).length === manifest.tests, 'Allure test scope is empty or inconsistent.');
    let verification;
    phase = 'VERIFICATION';
    if (directory.startsWith('reports/generation/') || existsSync(join(path, 'verification.json'))) {
      const reference = data(JSON.parse(readFileSync(consumerPath(roots, `${directory}/verification.json`), 'utf8')));
      verification = await verificationRecord(roots, reference.sourceId, reference.invocation);
      requireThat(verification.reporting?.directory === directory && verification.revision === reference.revision && verification.status === reference.status, 'Allure capture belongs to another verification.');
    }
    phase = 'DEPENDENCY';
    const installation = installedAllure(roots, 'allure'); requireThat(installation.version === '3.19.1', 'Use the validated Allure Report 3.19.1.');
    const output = join(path, 'allure-report'); requireThat(!existsSync(output), 'Do not overwrite a generated Allure report.');
    // Pinned official CLI, bound argv and an explicit package config: consumer
    // discovery cannot enable publishing, result filters, known issues or quality gates.
    const configuration = fileURLToPath(new URL('./allurerc.json', import.meta.url));
    phase = 'GENERATION';
    // The CLI treats inputs as globs. A fixed relative input avoids interpreting
    // brackets or other glob syntax in the consumer's absolute directory name.
    execFileSync(process.execPath, [join(installation.directory, 'cli.js'), 'generate', 'allure-results', '--config', configuration, '--output', output],
      {cwd: path, windowsHide: true, stdio: 'pipe', timeout: 60000, maxBuffer: 1024 * 1024});
    phase = 'OUTPUT';
    const reportFile = join(output, 'index.html');
    const html = readFileSync(reportFile, 'utf8'); requireThat(html.includes('<head>'), 'Allure generated no HTML report.');
    // Allure 3.19.1's Awesome template embeds analytics without an opt-out.
    // Keep this local single-file artifact offline, including when opened directly.
    const csp = "default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; connect-src data: blob:; media-src data: blob:; frame-src data: blob:; base-uri 'self'; form-action 'none'";
    const bytes = Buffer.from(html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`));
    writeFileSync(reportFile, bytes, {mode: 0o600});
    requireThat(JSON.stringify(allureInventory(join(path, 'allure-results'))) === JSON.stringify(current), 'Allure evidence changed during generation.');
    const receipt = {status: 'GENERATED', source: 'playwright-native', tests: manifest.tests, reporter: manifest.reporter, commandline: installation.version,
      generator: 'allure', configuration: digest(readFileSync(configuration)),
      artifact: {path: `${directory}/allure-report/index.html`, bytes: bytes.length, sha256: digest(bytes)}};
    if (verification) {
      // The native runner can pass while assertion assessment fails (for example, a
      // swallowed assertion). Keep the authoritative gate above native details.
      const gateDescription = verification.gate === 'case-assertions'
        ? 'This case-level gate checks completed assertions and skipped steps. Independent review assesses scenario coverage; the receipt does not prove execution of every source expectation.'
        : 'This historical verification used the legacy source-expectation gate.';
      const landing = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><title>Harness verification ${escapeHtml(verification.status)}</title><style>body{font:18px/1.6 system-ui;max-width:900px;margin:50px auto;padding:24px;color:#183149}strong{font-size:1.5em}a{color:#17528a}code{overflow-wrap:anywhere}</style></head><body><h1>Harness verification</h1><p>Recorded outcome: <strong>${escapeHtml(verification.status)}</strong></p><p>Invocation: <code>${escapeHtml(verification.id)}</code></p><p>Reviewed revision: <code>${escapeHtml(verification.revision)}</code></p><p>${gateDescription} Native test status alone does not establish readiness.</p><p><a href="allure-report/index.html">Open Allure native test details</a></p><p>Readiness requires two independent green runs for the same reviewed candidate. Reporting does not change that gate.</p></body></html>\n`;
      writeFileSync(join(path, 'index.html'), landing, {flag: 'wx', mode: 0o600});
      receipt.nativeArtifact = receipt.artifact; receipt.verification = {id: verification.id, revision: verification.revision, status: verification.status, ...(verification.gate ? {gate: verification.gate} : {})};
      receipt.artifact = {path: `${directory}/index.html`, bytes: Buffer.byteLength(landing), sha256: digest(landing)};
    }
    writeFileSync(join(path, 'generation.json'), JSON.stringify(receipt, null, 2), {flag: 'wx', mode: 0o600}); return receipt;
  } catch {return {status: 'FAILED', phase, reason: 'Allure capture, dependency or generation is unavailable; execution verdicts are unchanged.'};}
}
