import {existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, lstatSync} from 'node:fs';
import {join, dirname, relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {consumerRoots, consumerPath} from '../consumer-paths.mjs';
import {requireThat, data} from '../execution-core/data.mjs';
import {reportDirectory, timestampedReportDirectory} from './directories.mjs';

export const ALLURE_HISTORY = 'reports/allure-history';

/** One persisted directory association per native invocation; raw/internal IDs remain metadata. */
export function reserveAllureReport(inputRoots, {historyRoot = process.env.HARNESS_ALLURE_HISTORY ?? ALLURE_HISTORY, directory, id = randomUUID(), at} = {}) {
  const roots = consumerRoots(inputRoots.projectRoot, inputRoots.packageRoot);
  const allocated = directory ? {directory, path: reportDirectory(roots, directory)} : timestampedReportDirectory(roots, {parent: historyRoot, at});
  const record = {version: 1, id, directory: allocated.directory, historyRoot: dirname(allocated.directory).replaceAll('\\', '/')};
  writeFileSync(join(allocated.path, 'run.json'), JSON.stringify(record, null, 2) + '\n', {flag: 'wx', mode: 0o600, flush: true});
  return {...record, path: allocated.path};
}

export function readAllureRun(roots, directory, expectedId) {
  const path = consumerPath(roots, `${directory}/run.json`), run = data(JSON.parse(readFileSync(path, 'utf8')));
  requireThat(run.version === 1 && run.directory === directory && run.historyRoot === dirname(directory).replaceAll('\\', '/') && typeof run.id === 'string'
    && (expectedId === undefined || run.id === expectedId), 'Allure report directory belongs to another invocation.');
  return {...run, path: consumerPath(roots, directory)};
}

/** Atomic replacement is the publication order: only complete reports can become latest. */
export function publishLatest(roots, run) {
  const latest = consumerPath(roots, `${run.historyRoot}/latest.html`), marker = '<!-- harness-allure-latest/1 -->';
  if (existsSync(latest)) requireThat(!lstatSync(join(roots.projectRoot, run.historyRoot, 'latest.html')).isSymbolicLink()
    && readFileSync(latest, 'utf8').startsWith(marker), 'Latest Allure entry point is not harness-owned.');
  const href = relative(dirname(latest), consumerPath(roots, `${run.directory}/index.html`)).replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/');
  const html = `${marker}\n<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'"><meta http-equiv="refresh" content="0;url=${href}"><title>Latest Allure report</title></head><body><a href="${href}">Open the latest completed Allure report</a></body></html>\n`;
  const temporary = consumerPath(roots, `${run.historyRoot}/.latest-${randomUUID()}.tmp`);
  try {writeFileSync(temporary, html, {flag: 'wx', mode: 0o600, flush: true}); renameSync(temporary, latest);}
  finally {if (existsSync(temporary)) unlinkSync(temporary);}
  return {status: 'WRITTEN', path: `${run.historyRoot}/latest.html`, target: `${run.directory}/index.html`};
}
