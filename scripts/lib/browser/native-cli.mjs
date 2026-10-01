// The only version-specific browser integration. Public actions remain native CLI arguments.
import {readFile, writeFile, mkdir, lstat, realpath, chmod, copyFile, rm, rename} from 'node:fs/promises';
import {join, resolve, dirname} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID, createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolveSkillRoots, within, realFuture} from '../skill-roots.mjs';
import {processCall, rememberTree, refreshTree, stopTree, treeGone} from './processes.mjs';

const PIN = Object.freeze({cli: '0.1.22', playwright: '1.64.0-alpha-1790635538000', lock: '1292f67fda12e1e1beb43fdea946639daefc581a6198d1500fbd7860dbc7f5f2'});
const SYSTEM_KEYS = new Set(['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','TMPDIR','HOME','USERPROFILE','HOMEDRIVE','HOMEPATH','LOCALAPPDATA','APPDATA','XDG_CACHE_HOME','XDG_RUNTIME_DIR','LANG','LANGUAGE','LC_ALL','TZ','PLAYWRIGHT_BROWSERS_PATH']);
const RESERVED = new Set(['open','attach','close','detach','close-all','kill-all','delete-data','install','install-browser','list','show']);

export class NativeFailure extends Error {
  constructor(classification, dispatched = false, interrupted = false) {super(`Native browser operation failed: ${classification}.`); this.classification = classification; this.dispatched = dispatched; this.interrupted = interrupted;}
}
export function classifyNative(reply) {
  if (reply.kind) throw new NativeFailure({TIMEOUT: 'TIMEOUT', CANCELLED: 'CANCELLED', OUTPUT_LIMIT: 'EXECUTOR', SPAWN_FAILURE: 'UNAVAILABLE'}[reply.kind], reply.dispatched, reply.dispatched && reply.kind !== 'SPAWN_FAILURE');
  let payload; try {payload = JSON.parse(reply.stdout);} catch {throw new NativeFailure('EXECUTOR', reply.dispatched);}
  if (reply.exitCode !== 0 || !payload || typeof payload !== 'object' || Array.isArray(payload) || payload.isError || typeof payload.error === 'string') {
    throw new NativeFailure(/timeout/i.test(payload?.error ?? '') ? 'TIMEOUT' : 'EXECUTOR', reply.dispatched);
  }
  return payload;
}

export function validateNativeArguments(args, workRoot, origins) {
  if (!Array.isArray(args) || !args.length || args.some(value => typeof value !== 'string' || value.includes('\0')) || Buffer.byteLength(JSON.stringify(args)) > 128 * 1024 || !/^[a-z][a-z-]+$/.test(args[0])) throw new Error('Native arguments must be a bounded argument array.');
  if (RESERVED.has(args[0]) || args.some(value => /^--init-/.test(value) || /^(?:-s(?:=|$)|--(?:session|config|profile|persistent|cdp|endpoint|extension|browser|headed|json|raw|output-dir|user-data-dir|allow-unrestricted)(?:[=-]|$))/.test(value))) throw new Error('Session ownership and native profile are managed by the harness.');
  for (const value of args.slice(1)) if (/^https?:\/\//.test(value)) {
    const url = new URL(value); if (!origins.includes(url.origin) || url.username || url.password) throw new Error('Native destination is outside the selected browser target.');
  }
  for (let index = 1; index < args.length; index++) {
    const match = args[index].match(/^--(?:filename|path)(?:=(.*))?$/);
    if (match) {const file = match[1] ?? args[++index]; if (!file || !within(workRoot, resolve(workRoot, file))) throw new Error('Native files must stay in protected session storage.');}
  }
  if (['state-save','state-load'].includes(args[0]) && (args.length !== 2 || !within(workRoot, resolve(workRoot, args[1])))) throw new Error('Authentication state must stay in protected session storage.');
}

async function neutralEnvironment() {
  if (Object.keys(process.env).some(key => /^(PLAYWRIGHT_MCP_|PLAYWRIGHT_CLI_|PWTEST_)/i.test(key))) throw new Error('Remove native Playwright overrides before this owned browser profile; values are not logged.');
  try {await lstat(join(homedir(), '.playwright', 'cli.config.json'));} catch (error) {
    if (error.code === 'ENOENT') return Object.freeze({...Object.fromEntries(Object.entries(process.env).filter(([name]) => SYSTEM_KEYS.has(name.toUpperCase()))), CI: '1', NO_UPDATE_NOTIFIER: '1'});
    throw error;
  }
  throw new Error('This browser profile requires neutral native global configuration; existing configuration is untouched.');
}

async function protect(directory) {
  if (process.platform === 'win32') {
    const owner = await processCall('whoami', []);
    if (owner.exitCode !== 0) throw new Error('Cannot identify protected storage owner.');
    const result = await processCall('icacls', [directory, '/inheritance:r', '/grant:r', `${owner.stdout.trim()}:(OI)(CI)F`]);
    if (result.exitCode !== 0) throw new Error('Cannot protect browser runtime storage.');
  } else await chmod(directory, 0o700);
}

/** Create fresh consumer storage and an owned isolated session; no attachment or global cleanup. */
export async function prepareNativeSession(roots, {origins, storageState, nativeTimeoutMs = 5000, commandTimeoutMs = 30000} = {}) {
  roots = resolveSkillRoots(roots);
  const env = await neutralEnvironment(), installation = join(roots.packageRoot, 'scripts/spikes/playwright-cli');
  for (const name of ['@playwright/cli','playwright','playwright-core']) {
    const value = JSON.parse(await readFile(join(installation, 'node_modules', name, 'package.json'), 'utf8'));
    if (value.version !== (name === '@playwright/cli' ? PIN.cli : PIN.playwright)) throw new Error('Install the exact proven native CLI graph.');
  }
  if (createHash('sha256').update(await readFile(join(installation, 'package-lock.json'))).digest('hex') !== PIN.lock) throw new Error('Native CLI lock differs from the proven graph.');
  if (!Number.isSafeInteger(nativeTimeoutMs) || nativeTimeoutMs < 1 || nativeTimeoutMs > 60000 || !Number.isSafeInteger(commandTimeoutMs) || commandTimeoutMs < 1 || commandTimeoutMs > 120000) throw new Error('Native timeouts must be bounded.');
  const require = createRequire(import.meta.url), {tools} = require(join(installation, 'node_modules/playwright-core/lib/coreBundle.js'));
  if (typeof tools?.resolveCLIConfigForCLI !== 'function') throw new Error('Native CLI integration prerequisite is unavailable.');
  const executable = join(installation, 'node_modules/@playwright/cli/playwright-cli.js');
  if (!(await lstat(executable)).isFile()) throw new Error('Native CLI executable is unavailable.');
  let source;
  if (storageState !== undefined) {
    source = await realpath(storageState); const stat = await lstat(source);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024 || within(await realpath(roots.packageRoot), source)) throw new Error('Storage state must be a bounded external runtime file.');
  }
  await mkdir(dirname(roots.runRoot), {recursive: true, mode: 0o700});
  await mkdir(roots.runRoot, {mode: 0o700}); // Refuse reuse, including existing aliases.
  let ownedRoot, workRoot, evidenceRoot, config, statePath;
  const session = `harness_${randomUUID().replaceAll('-', '')}`, trees = [];
  try {
    ownedRoot = await realpath(roots.runRoot);
    await protect(ownedRoot);
    // Node's sync and async realpath implementations can disagree on Windows 8.3 aliases.
    // All native I/O uses the async canonical spelling after the initial root guard.
    roots = {packageRoot: await realpath(roots.packageRoot), projectRoot: await realpath(roots.projectRoot), runRoot: await realpath(roots.runRoot)};
    workRoot = join(roots.runRoot, 'protected'); evidenceRoot = join(roots.runRoot, 'evidence');
    await mkdir(workRoot, {mode: 0o700}); await mkdir(evidenceRoot, {mode: 0o700});
    config = join(workRoot, 'native.json');
    const settings = {browser: {browserName: 'chromium', isolated: true, launchOptions: {headless: true, channel: 'chrome-for-testing', ...(process.platform === 'linux' && process.getuid() === 0 ? {chromiumSandbox: false} : {})}, contextOptions: {serviceWorkers: 'block'}}, network: {allowedOrigins: origins}, timeouts: {action: nativeTimeoutMs, navigation: nativeTimeoutMs}, outputDir: workRoot};
    await writeFile(config, JSON.stringify(settings), {mode: 0o600, flag: 'wx'});
    // Protected identity-only crash recovery. Register the exact session before dispatch.
    await writeFile(join(workRoot, 'native-ownership.json'), JSON.stringify({version: 1, session, stage: 'prepared', trees: []}), {mode: 0o600, flag: 'wx'});
    if (source !== undefined) {
      statePath = join(workRoot, 'restored-state.json'); await copyFile(source, statePath); await chmod(statePath, 0o600);
    }
  } catch (cause) {
    let removed = false;
    try {
      if (!ownedRoot || await realpath(ownedRoot) !== ownedRoot || (await lstat(ownedRoot)).isSymbolicLink() || !within(await realpath(roots.projectRoot), ownedRoot) || within(await realpath(roots.packageRoot), ownedRoot)) throw new Error();
      await rm(ownedRoot, {recursive: true}); removed = true;
    } catch { /* Preserve protected material when safe removal cannot be established. */ }
    const failure = new NativeFailure('UNAVAILABLE');
    Object.defineProperty(failure, 'cause', {value: cause}); // Private diagnostic; omitted from serialized receipts.
    failure.preparation = Object.freeze({storageAcquired: true, privateStorageRemoved: removed, remediationRequired: !removed});
    if (!removed) failure.message += ' Owned setup storage requires remediation.';
    throw failure;
  }
  async function preflight() {
    await neutralEnvironment();
    const actual = await tools.resolveCLIConfigForCLI(workRoot, session, {config}, env);
    if (actual.browser?.isolated !== true || actual.browser.browserName !== 'chromium' || actual.browser.launchOptions?.headless !== true || actual.browser.launchOptions?.channel !== 'chrome-for-testing' || actual.browser.cdpEndpoint || actual.browser.remoteEndpoint || actual.browser.userDataDir || actual.browser.launchOptions.executablePath || actual.extension || actual.sharedBrowserContext || resolve(actual.outputDir) !== workRoot || JSON.stringify(actual.network.allowedOrigins) !== JSON.stringify(origins)) throw new Error('Native profile changed before launch.');
  }
  let opened = false, openingUncertain = false, busy = false, closed = false, lastCleanup;
  const cleanupFailures = [];
  const events = [];
  async function currentStorage() {
    const physical = await realpath(workRoot);
    if (physical !== workRoot || await realpath(roots.runRoot) !== roots.runRoot || !within(roots.projectRoot, physical) || within(roots.packageRoot, physical)) throw new Error('Owned browser storage changed its boundary.');
    return physical;
  }
  async function invoke(args, options = {}) {
    if (busy) throw new Error('Parallel native calls are not supported.');
    busy = true;
    try {
      await currentStorage();
      const reply = await processCall(process.execPath, [executable, '--json', `-s=${session}`, ...args], {cwd: workRoot, env, timeoutMs: Math.min(commandTimeoutMs, options.timeoutMs ?? commandTimeoutMs), signal: options.signal});
      let payload;
      try {payload = classifyNative(reply);} catch (error) {events.push({command: args[0], classification: error.classification, dispatched: reply.dispatched}); throw error;}
      events.push({command: args[0], classification: 'OK', dispatched: reply.dispatched}); return payload;
    } finally {busy = false;}
  }
  async function open(options) {
    if (opened || closed) throw new Error('Session is already open or closed.');
    await preflight(); openingUncertain = true;
    await ownership('opening');
    const reply = await invoke(['open', 'about:blank', `--config=${config}`], options);
    trees.push(await rememberTree(reply.pid));
    await ownership('opened');
    opened = true; openingUncertain = false;
    if (statePath) await invoke(['state-load', statePath], options);
    return {session};
  }
  async function ownership(stage) {
    const next = join(workRoot, 'native-ownership.next.json');
    await writeFile(next, JSON.stringify({version: 1, session, stage, trees}), {mode: 0o600, flag: 'wx'});
    await rename(next, join(workRoot, 'native-ownership.json'));
  }
  async function close({deadlineAt = Date.now() + 30000} = {}) {
    if (closed) return lastCleanup;
    const failures = [];
    for (const tree of trees) try {await refreshTree(tree, deadlineAt);} catch {failures.push('OWNERSHIP_INSPECTION');}
    try {await invoke(['close'], {timeoutMs: Math.max(0, deadlineAt - Date.now())});} catch {failures.push('NATIVE_CLOSE');}
    for (const tree of trees) try {if (!await treeGone(tree, deadlineAt)) await stopTree(tree, deadlineAt); if (!await treeGone(tree, deadlineAt)) failures.push('PROCESS_SURVIVED');} catch {failures.push('PROCESS_CLEANUP');}
    try {await invoke(['delete-data'], {timeoutMs: Math.max(0, deadlineAt - Date.now())});} catch {failures.push('NATIVE_DATA');}
    if (openingUncertain) failures.push('OPEN_EFFECT_UNCERTAIN');
    const stopped = failures.every(item => !['PROCESS_SURVIVED','PROCESS_CLEANUP','OWNERSHIP_INSPECTION','OPEN_EFFECT_UNCERTAIN'].includes(item));
    let authenticationRemoved = false;
    // Protected runtime content is disposable and owned. Recheck physical containment before deletion.
    if (stopped && !failures.includes('NATIVE_DATA')) {
      try {const physical = await currentStorage(); if ((await lstat(workRoot)).isSymbolicLink() || !within(roots.runRoot, physical)) throw new Error(); await rm(physical, {recursive: true}); authenticationRemoved = true;} catch {failures.push('PRIVATE_STORAGE');}
    }
    for (const failure of failures) if (!cleanupFailures.includes(failure)) cleanupFailures.push(failure);
    opened = false; closed = stopped && authenticationRemoved;
    lastCleanup = {complete: closed && cleanupFailures.length === 0, stopped, authenticationRemoved, failures: [...cleanupFailures]};
    return lastCleanup;
  }
  return {session, roots, workRoot, events, open, close,
    command: async (args, options) => {
      if (!opened || closed) throw new NativeFailure('UNAVAILABLE'); validateNativeArguments(args, workRoot, origins);
      const paths = args.slice(1).flatMap((value, index) => /^--(?:filename|path)=/.test(value) ? [value.slice(value.indexOf('=') + 1)] : /^--(?:filename|path)$/.test(value) ? [args[index + 2]] : []);
      if (['state-save','state-load'].includes(args[0])) paths.push(args[1]);
      if (paths.some(file => !within(realFuture(workRoot), realFuture(resolve(workRoot, file))))) throw new Error('Native file alias escapes protected storage.');
      return await invoke(args, options);
    },
    interrupt: async ({deadlineAt = Date.now() + 30000} = {}) => {for (const tree of trees) await stopTree(tree, deadlineAt);},
    // Identity-only ownership receipt for a driver-level crash test; contains no native diagnostic values.
    ownership: () => trees.map(tree => tree.map(item => ({...item})))};
}
