import {createRequire} from 'node:module';
import {readFileSync, readdirSync, lstatSync, writeFileSync, existsSync, mkdirSync, copyFileSync, renameSync, rmdirSync, openSync, closeSync, fstatSync, unlinkSync, constants} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {consumerRoots, consumerPath} from '../consumer-paths.mjs';
import {digest, requireThat, data} from '../execution-core/data.mjs';
import {verificationRecord} from '../generation/index.mjs';
import {readAllureRun, publishLatest} from './history.mjs';
export {reserveAllureReport} from './history.mjs';

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

/** Capture ordinary reporter output after every native reporter has flushed. */
export function captureAllureResults(inputRoots, directory, resultsDirectory) {
  const roots = consumerRoots(inputRoots.projectRoot, inputRoots.packageRoot), run = readAllureRun(roots, directory);
  const source = consumerPath(roots, resultsDirectory), artifacts = allureInventory(source);
  const target = consumerPath(roots, `${directory}/allure-results`); mkdirSync(target, {mode: 0o700});
  for (const artifact of artifacts) {
    const destination = consumerPath(roots, `${directory}/allure-results/${artifact.path}`);
    mkdirSync(dirname(destination), {recursive: true, mode: 0o700}); copyFileSync(join(source, artifact.path), destination, constants.COPYFILE_EXCL);
  }
  requireThat(JSON.stringify(allureInventory(target)) === JSON.stringify(artifacts) && JSON.stringify(allureInventory(source)) === JSON.stringify(artifacts), 'Allure evidence changed during capture.');
  const tests = artifacts.filter(item => item.path.endsWith('-result.json')).length;
  requireThat(tests > 0, 'Allure capture is empty.');
  writeFileSync(join(run.path, 'capture.json'), JSON.stringify({version: 1, source: 'playwright-native', status: 'CAPTURED', reporter: '3.13.0', tests, artifacts}, null, 2), {flag: 'wx', mode: 0o600, flush: true});
}

/** Separate idempotent report job after native flush; never a verdict engine. */
export async function generateAllure(inputRoots, directory, {configuration} = {}) {
  let phase = 'CAPTURE', generationLock, lockFile;
  try {
    const roots = consumerRoots(inputRoots.projectRoot, inputRoots.packageRoot);
    requireThat(typeof directory === 'string' && (directory.startsWith('reports/') || directory.startsWith('.harness/runs/allure/')) && !/[\\:\r\n]/.test(directory) && directory.split('/').every(p => p && !['.', '..'].includes(p)), 'Use a relative captured report directory.');
    const path = consumerPath(roots, directory), captureFile = consumerPath(roots, `${directory}/capture.json`);
    const manifest = data(JSON.parse(readFileSync(captureFile, 'utf8')));
    requireThat(manifest.status === 'CAPTURED' && manifest.source === 'playwright-native' && manifest.tests > 0, 'Allure capture is incomplete or empty.');
    const current = allureInventory(join(path, 'allure-results'));
    requireThat(JSON.stringify(current) === JSON.stringify(manifest.artifacts), 'Allure evidence changed after capture.');
    requireThat(current.filter(item => item.path.endsWith('-result.json')).length === manifest.tests, 'Allure test scope is empty or inconsistent.');
    const run = existsSync(join(path, 'run.json')) ? readAllureRun(roots, directory) : undefined;
    let verification;
    phase = 'VERIFICATION';
    if (directory.startsWith('reports/generation/') || run?.id.startsWith('verify-') || existsSync(join(path, 'verification.json'))) {
      const reference = data(JSON.parse(readFileSync(consumerPath(roots, `${directory}/verification.json`), 'utf8')));
      verification = await verificationRecord(roots, reference.sourceId, reference.invocation);
      requireThat(verification.reporting?.directory === directory && verification.revision === reference.revision && verification.status === reference.status, 'Allure capture belongs to another verification.');
    }
    phase = 'DEPENDENCY';
    const installation = installedAllure(roots, 'allure'); requireThat(installation.version === '3.19.1', 'Use the validated Allure Report 3.19.1.');
    configuration = configuration === undefined ? fileURLToPath(new URL('./allurerc.json', import.meta.url)) : consumerPath(roots, configuration);
    if (run && verification) requireThat(run.id === verification.id, 'Allure report directory belongs to another invocation.');
    const receiptFile = consumerPath(roots, `${directory}/generation.json`);
    const latest = async () => {
      if (!run || run.version === 1) return undefined;
      try {return await publishLatest(roots, run);} catch {return {status: 'FAILED', reason: 'Latest Allure report could not be published; the completed evidence is retained.'};}
    };
    phase = 'GENERATION';
    lockFile = consumerPath(roots, `${directory}/.generation.lock`); generationLock = openSync(lockFile, 'wx', 0o600);
    writeFileSync(generationLock, JSON.stringify({pid: process.pid, invocation: run?.id, startedAt: new Date().toISOString()}), {flush: true});
    // Another process may have completed while this job was waiting to acquire ownership.
    if (existsSync(receiptFile)) {
      const receipt = data(JSON.parse(readFileSync(receiptFile, 'utf8')));
      requireThat(receipt.status === 'GENERATED' && receipt.generator === 'allure' && receipt.commandline === installation.version
        && receipt.tests === manifest.tests && receipt.reporter === manifest.reporter && receipt.configuration === digest(readFileSync(configuration))
        && receipt.artifact?.path === `${directory}/index.html`, 'Invalid prior Allure generation receipt.');
      requireThat(verification ? receipt.verification?.id === verification.id && receipt.verification.revision === verification.revision
        && receipt.verification.status === verification.status && receipt.verification.gate === verification.gate : !receipt.verification, 'Generated Allure verification association changed.');
      for (const artifact of [receipt.artifact, ...(receipt.nativeArtifact ? [receipt.nativeArtifact] : [])]) {
        requireThat(artifact === receipt.artifact || artifact.path === `${directory}/allure-report/index.html`, 'Invalid prior native report path.');
        const bytes = readFileSync(consumerPath(roots, artifact.path));
        requireThat(bytes.length === artifact.bytes && digest(bytes) === artifact.sha256, 'Generated Allure report changed.');
      }
      // Re-opening an older completed report must not move the latest pointer backwards.
      const delivery = run?.version === 2 && !existsSync(join(path, 'publication.json')) ? await latest() : undefined;
      return {...receipt, ...(delivery ? {latest: delivery} : {})};
    }
    // Pinned official CLI, bound argv and an explicit package config: consumer
    // discovery cannot enable publishing, result filters, known issues or quality gates.
    // The CLI treats inputs as globs. A fixed relative input avoids interpreting
    // brackets or other glob syntax in the consumer's absolute directory name.
    execFileSync(process.execPath, [join(installation.directory, 'cli.js'), 'generate', 'allure-results', '--config', configuration, '--output', path],
      {cwd: path, windowsHide: true, stdio: 'pipe', timeout: 60000, maxBuffer: 1024 * 1024});
    phase = 'OUTPUT';
    // Allure keeps its plugin directory when native inputs already occupy the output.
    // Move the single-file renderer output in place; never retain a second HTML copy.
    const plugin = join(path, 'awesome');
    if (existsSync(plugin)) {
      requireThat(!lstatSync(plugin).isSymbolicLink(), 'Allure output cannot redirect.');
      for (const name of readdirSync(plugin)) {
        const destination = consumerPath(roots, `${directory}/${name}`);
        requireThat(!existsSync(destination) || run && ['index.html', 'summary.json'].includes(name) && !lstatSync(destination).isSymbolicLink(), 'Allure output would replace an existing artifact.');
        renameSync(join(plugin, name), destination);
      }
      rmdirSync(plugin);
    }
    const reportFile = consumerPath(roots, `${directory}/index.html`);
    const html = readFileSync(reportFile, 'utf8'); requireThat(html.includes('<head>'), 'Allure generated no HTML report.');
    // Allure 3.19.1's Awesome template embeds analytics without an opt-out.
    // Keep this local single-file artifact offline, including when opened directly.
    const csp = "default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; connect-src data: blob:; media-src data: blob:; frame-src data: blob:; base-uri 'self'; form-action 'none'";
    const bytes = Buffer.from(html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`));
    writeFileSync(reportFile, bytes, {mode: 0o600});
    requireThat(JSON.stringify(allureInventory(join(path, 'allure-results'))) === JSON.stringify(current), 'Allure evidence changed during generation.');
    const receipt = {status: 'GENERATED', source: 'playwright-native', tests: manifest.tests, reporter: manifest.reporter, commandline: installation.version,
      generator: 'allure', configuration: digest(readFileSync(configuration)),
      artifact: {path: `${directory}/index.html`, bytes: bytes.length, sha256: digest(bytes)}};
    if (verification) {
      receipt.verification = {id: verification.id, revision: verification.revision, status: verification.status, ...(verification.gate ? {gate: verification.gate} : {})};
    }
    writeFileSync(receiptFile, JSON.stringify(receipt, null, 2), {flag: 'wx', mode: 0o600, flush: true});
    const delivery = await latest(); return {...receipt, ...(delivery ? {latest: delivery} : {})};
  } catch {return {status: 'FAILED', phase, reason: 'Allure capture, dependency or generation is unavailable or already in progress; execution verdicts are unchanged.'};}
  finally {
    if (generationLock !== undefined) {
      try {
        const owner = fstatSync(generationLock); closeSync(generationLock);
        if (existsSync(lockFile)) {const current = lstatSync(lockFile); if (!current.isSymbolicLink() && current.dev === owner.dev && current.ino === owner.ino) unlinkSync(lockFile);}
      } catch { /* Reporting cleanup cannot mask a verdict; a retained lock requires ownership inspection. */ }
    }
  }
}
