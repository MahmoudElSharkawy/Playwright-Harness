import {createRequire} from 'node:module';
import {readFileSync, readdirSync, lstatSync, writeFileSync, existsSync} from 'node:fs';
import {join, dirname, delimiter} from 'node:path';
import {execFileSync} from 'node:child_process';
import {consumerRoots, consumerPath} from '../consumer-paths.mjs';
import {digest, requireThat, data} from '../execution-core/data.mjs';
import {verificationRecord} from '../generation/index.mjs';
import {escapeHtml} from './render.mjs';

export function installedAllure(roots, name) {
  requireThat(['allure-playwright', 'allure-commandline'].includes(name), 'Unsupported Allure component.');
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
    const installation = installedAllure(roots, 'allure-commandline'); requireThat(installation.version === '2.46.1', 'Use the validated Allure commandline 2.46.1.');
    const output = join(path, 'allure-report'); requireThat(!existsSync(output), 'Do not overwrite a generated Allure report.');
    // Same entrypoint as the installed official launcher, with argv binding and no shell.
    const classpath = [join(installation.directory, 'dist/lib/*'), join(installation.directory, 'dist/lib/config')].join(delimiter);
    phase = 'GENERATION';
    execFileSync('java', ['-Xms128m', '-Xmx512m', '-cp', classpath, 'io.qameta.allure.CommandLine', 'generate', join(path, 'allure-results'), '--single-file', '-o', output],
      {cwd: roots.projectRoot, windowsHide: true, stdio: 'pipe', timeout: 60000, maxBuffer: 1024 * 1024});
    phase = 'OUTPUT';
    const bytes = readFileSync(join(output, 'index.html')); requireThat(bytes.length > 0, 'Allure generated no report.');
    requireThat(JSON.stringify(allureInventory(join(path, 'allure-results'))) === JSON.stringify(current), 'Allure evidence changed during generation.');
    const receipt = {status: 'GENERATED', source: 'playwright-native', tests: manifest.tests, reporter: manifest.reporter, commandline: installation.version,
      artifact: {path: `${directory}/allure-report/index.html`, bytes: bytes.length, sha256: digest(bytes)}};
    if (verification) {
      // The native runner can pass while source coverage fails (for example, a
      // swallowed assertion). Keep the authoritative gate above native details.
      const landing = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><title>Harness verification ${escapeHtml(verification.status)}</title><style>body{font:18px/1.6 system-ui;max-width:900px;margin:50px auto;padding:24px;color:#183149}strong{font-size:1.5em}a{color:#17528a}code{overflow-wrap:anywhere}</style></head><body><h1>Harness verification</h1><p>Recorded outcome: <strong>${escapeHtml(verification.status)}</strong></p><p>Invocation: <code>${escapeHtml(verification.id)}</code></p><p>Reviewed revision: <code>${escapeHtml(verification.revision)}</code></p><p>This outcome is supplied by the generation verifier. Native test status alone does not establish assertion coverage or readiness.</p><p><a href="allure-report/index.html">Open Allure native test details</a></p><p>Readiness requires two independent green runs for the same reviewed candidate. Reporting does not change that gate.</p></body></html>\n`;
      writeFileSync(join(path, 'index.html'), landing, {flag: 'wx', mode: 0o600});
      receipt.nativeArtifact = receipt.artifact; receipt.verification = {id: verification.id, revision: verification.revision, status: verification.status};
      receipt.artifact = {path: `${directory}/index.html`, bytes: Buffer.byteLength(landing), sha256: digest(landing)};
    }
    writeFileSync(join(path, 'generation.json'), JSON.stringify(receipt, null, 2), {flag: 'wx', mode: 0o600}); return receipt;
  } catch {return {status: 'FAILED', phase, reason: 'Allure capture, dependency, Java or generation is unavailable; execution verdicts are unchanged.'};}
}
