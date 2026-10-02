import {mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, readdirSync, rmSync, rmdirSync, renameSync, copyFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {consumerPath} from './consumer-paths.mjs';
import {discoveryEntry, createSkillLink, removeSkillLink} from './skill-roots.mjs';

// One folder per setup run, git-ignored with the rest of .harness/state.
const JOURNALS = '.harness/state/setup';

/** Records what one setup run changes, before each change, so `setup --restore` can undo it.
 * Only the first capture of a path counts: it is the state before the run.
 */
export function startJournal(roots, details = {}) {
  const run = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  return openJournal(roots, run, details);
}
export function openJournal(roots, run, details = {}) {
  if (!/^[0-9TZ-]+-[a-f0-9]{8}$/.test(run)) throw new Error('Invalid setup run.');
  const dir = consumerPath(roots, `${JOURNALS}/${run}`), file = join(dir, 'journal.json');
  const record = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {version: 1, run, started: new Date().toISOString(), ...details, entries: []};
  mkdirSync(join(dir, 'blobs'), {recursive: true});
  const seen = new Set(record.entries.map(entry => `${entry.kind}:${entry.path}`));
  const save = () => writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
  const add = (entry, blob) => {
    const key = `${entry.kind}:${entry.path}`; if (seen.has(key)) return; seen.add(key);
    if (blob) {entry.blob = `${record.entries.length}`; blob(join(dir, 'blobs', entry.blob));}
    record.entries.push(entry); save();
  };
  save();
  return {
    run, record, save,
    set(fields) {Object.assign(record, fields); save();},
    file(path, previous) {add({kind: 'file', path, existed: previous != null}, previous == null ? undefined : target => writeFileSync(target, previous));},
    folder(path, absolute) {add({kind: 'folder', path}, target => cpSync(absolute, target, {recursive: true}));},
    link(path, previous) {add({kind: 'link', path, previous: previous ?? null});},
    // Moved, not deleted: a restore needs the previous archive.
    moved(path, absolute) {add({kind: 'moved', path}, target => {try {renameSync(absolute, target);} catch {copyFileSync(absolute, target); rmSync(absolute);}});},
    modules(existed) {add({kind: 'node_modules', path: 'node_modules', existed});},
  };
}
export function latestJournal(roots) {
  const dir = consumerPath(roots, JOURNALS);
  const runs = existsSync(dir) ? readdirSync(dir).filter(run => existsSync(join(dir, run, 'journal.json'))).sort() : [];
  return runs.length ? openJournal(roots, runs.at(-1)) : undefined;
}

/** Undo a run in reverse order. npm ci runs only when a valid lockfile existed before the run;
 * otherwise what the run created is removed, and an older node_modules is reported, not guessed.
 * With modules: false (a failed install) node_modules is left alone and only reported.
 */
export function restoreJournal(roots, journal, {npm, modules: restoreModules = true}) {
  const dir = consumerPath(roots, `${JOURNALS}/${journal.run}`), restored = [], notes = [];
  const blob = entry => join(dir, 'blobs', entry.blob);
  // Folders the run created and emptied again go too; the project root itself always stays.
  const prune = from => {for (let folder = from; folder.startsWith(roots.projectRoot) && folder !== roots.projectRoot && existsSync(folder) && !readdirSync(folder).length; folder = dirname(folder)) rmdirSync(folder);};
  for (const entry of [...journal.record.entries].reverse()) {
    const absolute = join(roots.projectRoot, entry.path);
    if (entry.kind === 'link') {
      if (discoveryEntry(absolute).kind === 'link') removeSkillLink(absolute);
      if (entry.previous && existsSync(entry.previous)) createSkillLink(entry.previous, absolute);
      else if (entry.previous) notes.push(`${entry.path} pointed at ${entry.previous}, which no longer exists; it was not recreated.`);
      else prune(dirname(absolute));
    } else if (entry.kind === 'folder') {
      if (discoveryEntry(absolute).kind === 'link') removeSkillLink(absolute);
      cpSync(blob(entry), absolute, {recursive: true});
    } else if (entry.kind === 'file') {
      if (entry.existed) {mkdirSync(dirname(absolute), {recursive: true}); writeFileSync(absolute, readFileSync(blob(entry)));}
      else if (existsSync(absolute)) {rmSync(absolute); prune(dirname(absolute));}
    } else if (entry.kind === 'moved') {mkdirSync(dirname(absolute), {recursive: true}); copyFileSync(blob(entry), absolute);}
    if (entry.kind !== 'node_modules') restored.push(entry.path);
  }
  const lock = journal.record.entries.find(entry => entry.kind === 'file' && entry.path === 'package-lock.json');
  const modules = journal.record.entries.find(entry => entry.kind === 'node_modules');
  if (!restoreModules) notes.push('node_modules was not restored.');
  else if (lock?.existed) {
    const result = npm(['ci', '--no-audit', '--no-fund']);
    if (result.status !== 0) notes.push('npm ci failed after the restore; run it again once the cause is fixed.');
  } else if (modules && !modules.existed) rmSync(join(roots.projectRoot, 'node_modules'), {recursive: true, force: true});
  else notes.push('node_modules existed before setup without a lockfile, so it cannot be reproduced exactly; run npm install.');
  if (!restoreModules) {journal.set({restored: new Date().toISOString()}); return {restored, notes};}
  // A completed restore needs no journal; a failed one keeps it for another attempt.
  rmSync(dir, {recursive: true, force: true}); prune(dirname(dir));
  return {restored, notes};
}
