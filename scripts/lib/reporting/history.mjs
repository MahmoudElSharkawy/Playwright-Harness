import {existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, lstatSync, openSync, closeSync, fstatSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {consumerRoots, consumerPath} from '../consumer-paths.mjs';
import {requireThat, data, digest} from '../execution-core/data.mjs';
import {reportDirectory, reportTimestamp} from './directories.mjs';

export const ALLURE_HISTORY = 'reports/allure-history';
const EVIDENCE = '.harness/runs/allure', LATEST = 'reports/allure-report/index.html';
const stampPattern = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}Z(?:-\d{3,})?$/;
const historyPath = value => typeof value === 'string' && value.startsWith('reports/') && !/[\\:\r\n\0]/.test(value)
  && value.split('/').every(part => part && !['.', '..'].includes(part))
  && !['reports/allure-report', 'reports/allure-results'].some(root => value === root || value.startsWith(root + '/'));

/** Immutable native evidence is separate from the published latest/older HTML inventory. */
export function reserveAllureReport(inputRoots, {historyRoot = process.env.HARNESS_ALLURE_HISTORY ?? ALLURE_HISTORY, directory, id = randomUUID(), at} = {}) {
  const roots = consumerRoots(inputRoots.projectRoot, inputRoots.packageRoot);
  requireThat(historyPath(historyRoot) && typeof id === 'string', 'Use a separate history root under reports/.');
  const base = reportTimestamp(at), parent = consumerPath(roots, EVIDENCE); mkdirSync(parent, {recursive: true, mode: 0o700});
  let allocated, timestamp;
  for (let collision = 0; collision < 10000; collision++) {
    timestamp = base + (collision ? `-${String(collision).padStart(3, '0')}` : '');
    const relative = directory ?? `${EVIDENCE}/${timestamp}`;
    try {
      const path = directory ? reportDirectory(roots, directory) : consumerPath(roots, relative);
      if (!directory) mkdirSync(path, {mode: 0o700});
      allocated = {directory: relative, path}; break;
    } catch (error) {if (directory || error.code !== 'EEXIST') throw error;}
  }
  requireThat(allocated, 'Allure timestamp collision limit exceeded.');
  const record = {version: 2, id, directory: allocated.directory, historyRoot, timestamp};
  writeFileSync(join(allocated.path, 'run.json'), JSON.stringify(record, null, 2) + '\n', {flag: 'wx', mode: 0o600, flush: true});
  return {...record, path: allocated.path};
}

export function readAllureRun(roots, directory, expectedId) {
  const path = consumerPath(roots, `${directory}/run.json`), run = data(JSON.parse(readFileSync(path, 'utf8')));
  requireThat(run.directory === directory && typeof run.id === 'string' && (expectedId === undefined || run.id === expectedId)
    && (run.version === 1 ? run.historyRoot === dirname(directory).replaceAll('\\', '/')
      : run.version === 2 && historyPath(run.historyRoot) && stampPattern.test(run.timestamp)), 'Allure report directory belongs to another invocation.');
  return {...run, path: consumerPath(roots, directory)};
}

/** Serialize publishers; archive the prior complete HTML before atomically replacing current. */
export async function publishLatest(roots, run) {
  requireThat(run.version === 2, 'Legacy report captures retain their existing publication.');
  const latest = consumerPath(roots, LATEST), parent = consumerPath(roots, EVIDENCE);
  mkdirSync(parent, {recursive: true, mode: 0o700});
  const lock = consumerPath(roots, `${EVIDENCE}/.publication.lock`), deadline = Date.now() + 10000;
  const publication = consumerPath(roots, `${run.directory}/publication.json`);
  const delivery = {status: 'WRITTEN', path: LATEST, target: `${run.directory}/index.html`};
  const complete = () => {writeFileSync(publication, JSON.stringify(delivery, null, 2) + '\n', {flag: 'wx', mode: 0o600, flush: true}); return delivery;};
  let handle, temporary, archive, replaced = false;
  try {
    while (handle === undefined) {
      try {handle = openSync(lock, 'wx', 0o600);}
      catch (error) {if (error.code !== 'EEXIST' || Date.now() >= deadline) throw error; await delay(25);}
    }
    writeFileSync(handle, JSON.stringify({pid: process.pid, invocation: run.id}), {flush: true});
    if (existsSync(publication)) {
      requireThat(JSON.stringify(JSON.parse(readFileSync(publication, 'utf8'))) === JSON.stringify(delivery), 'Allure publication receipt changed.');
      return delivery;
    }
    const source = readFileSync(consumerPath(roots, `${run.directory}/index.html`));
    const marker = '<!-- harness-allure-report/2 ';
    const metadata = {timestamp: run.timestamp, directory: run.directory, sha256: digest(source)};
    const bytes = Buffer.concat([Buffer.from(`${marker}${JSON.stringify(metadata)} -->\n`), source]);
    mkdirSync(dirname(latest), {recursive: true, mode: 0o700});
    temporary = consumerPath(roots, `reports/allure-report/.latest-${randomUUID()}.tmp`);
    writeFileSync(temporary, bytes, {flag: 'wx', mode: 0o600, flush: true});
    if (existsSync(latest)) {
      requireThat(!lstatSync(join(roots.projectRoot, LATEST)).isSymbolicLink(), 'Latest Allure report cannot redirect.');
      const prior = readFileSync(latest), text = prior.toString(), end = text.indexOf(' -->\n');
      requireThat(text.startsWith(marker) && end > marker.length, 'Latest Allure report is not harness-owned.');
      const previous = data(JSON.parse(text.slice(marker.length, end)));
      requireThat(stampPattern.test(previous.timestamp) && digest(Buffer.from(text.slice(end + 5))) === previous.sha256, 'Latest Allure report changed.');
      if (previous.directory === run.directory && previous.sha256 === metadata.sha256) return complete();
      const history = consumerPath(roots, run.historyRoot); mkdirSync(history, {recursive: true, mode: 0o700});
      const base = previous.timestamp.slice(0, 20), suffix = Number(previous.timestamp.slice(21) || 0);
      for (let collision = 0; collision < 10000; collision++) {
        const ordinal = suffix + collision;
        const name = `${base}${ordinal ? `-${String(ordinal).padStart(3, '0')}` : ''}.html`;
        const target = consumerPath(roots, `${run.historyRoot}/${name}`);
        try {writeFileSync(target, prior, {flag: 'wx', mode: 0o600, flush: true}); archive = target; break;}
        catch (error) {if (error.code !== 'EEXIST') throw error;}
      }
      requireThat(archive, 'Allure archive collision limit exceeded.');
    }
    renameSync(temporary, latest); replaced = true;
    return complete();
  } finally {
    if (temporary && existsSync(temporary)) unlinkSync(temporary);
    if (archive && !replaced) unlinkSync(archive);
    if (handle !== undefined) {
      const owner = fstatSync(handle); closeSync(handle);
      if (existsSync(lock)) {const current = lstatSync(lock); if (!current.isSymbolicLink() && current.dev === owner.dev && current.ino === owner.ino) unlinkSync(lock);}
    }
  }
}
