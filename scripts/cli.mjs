#!/usr/bin/env node
// pom-harness: setup (install, update, repair, restore), check, unlink, and pass-throughs to the existing
// scripts. Every command except a setup started from an archive acts only as the project's own installation.
import {spawnSync} from 'node:child_process';
import {join, resolve} from 'node:path';
import {realpathSync} from 'node:fs';
import {packageRoot} from './lib/consumer-paths.mjs';
import {VERSION, installedProject, verifyInstallation, locateArchive, setupFromArchive, planInstalled, configureInstalled, writeResult, restoreLastRun, unlinkHarness} from './lib/setup.mjs';
import {runCheck} from './lib/check.mjs';

const SCRIPTS = {
  'check-conventions': 'check-conventions.mjs', tracker: 'generate-tracker.mjs', metrics: 'harness-metrics.mjs',
  'fetch-suite': 'fetch-ado-suite.mjs', 'fetch-story': 'fetch-ado-story.mjs', 'publish-results': 'publish-ado-results.mjs',
  'tag-workitem': 'tag-ado-workitem.mjs', 'relink-story': 'relink-ado-story.mjs', pr: 'ado-pr.mjs', 'load-source': 'load-local-source.mjs',
  generate: 'generate-tests.mjs', 'render-results': 'render-results.mjs', 'generate-allure': 'generate-allure.mjs',
};
const USAGE = `pom-harness ${VERSION}

  setup [--archive <path>] [--environment <name> --mode test|protected|custom] [--skip-browsers] [--project-root <dir>] [--dry-run] [--json]
        install from the release archive, or update, repair and configure the installed harness
  setup --restore          undo the last setup run from its journal
  check [--add-env-keys] [--json]
        per-feature readiness; --add-env-keys adds empty .env entries for missing secrets
  unlink                   remove the harness skill links, for example before a rollback
  ${Object.keys(SCRIPTS).join(', ')}
                           run an existing harness script in this project`;

function parse(args, values, flags) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const name = args[index].startsWith('--') ? args[index].slice(2) : undefined;
    if (flags.includes(name)) options[name] = true;
    else if (values.includes(name) && args[index + 1] !== undefined && !args[index + 1].startsWith('--')) options[name] = args[++index];
    else throw new Error(`Unknown or incomplete option: ${args[index]}`);
  }
  return options;
}
const same = (left, right) => {try {return realpathSync(left) === realpathSync(right);} catch {return false;}};

function print(result, json) {
  if (json) {console.log(JSON.stringify(result, null, 2)); return;}
  const lines = [], list = (title, items) => {if (items?.length) lines.push(title, ...items.map(item => `  - ${item}`));};
  if (['DONE', 'INCOMPLETE'].includes(result.status)) {
    lines.push(`Playwright POM Harness ${result.version} is set up${result.previousVersion ? ` (was ${result.previousVersion})` : ''}.`);
    if (result.checksum) lines.push('The archive matched its published checksum.');
    lines.push(`Skill links: ${result.links.created} created, ${result.links.repaired} repaired, ${result.links.removed} removed.`);
    list('Changed files:', result.changed); list('Replaced legacy folders:', result.removedFolders); list('Added starter files:', result.starter); list('Needs a decision:', result.reports);
    lines.push('Readiness:', ...result.readiness.map(item => `  ${item.status.padEnd(24)} ${item.name}${item.detail ? ` (${item.detail})` : ''}`));
    list('Errors:', result.errors); list('Notes:', result.notes); list(`Upgrade actions since ${result.previousVersion ?? 'your previous setup'}:`, result.upgradeActions); list('Next:', result.next);
  } else if (result.status === 'PLANNED') {
    lines.push(result.archive ? `Setup would install playwright-pom-harness ${result.version} from ${result.archive}.` : `Setup would update this project's playwright-pom-harness ${result.version} setup.`);
    list('Files it would change:', result.changes); lines.push(`Skill links: ${result.links.created} to create, ${result.links.repaired} to repair, ${result.links.removed} to remove.`);
    list('Needs a decision:', result.reports); if (result.starter) lines.push('There is no Playwright framework yet, so the minimal starter would be added.');
  } else if (result.status === 'RESTORED') {
    lines.push(`Restored the state before setup run ${result.journal}.`); list('Restored:', result.restored); list('Notes:', result.notes);
  } else {
    lines.push(result.status === 'STOPPED' ? 'Setup stopped before changing anything:' : 'Setup did not complete:', ...(result.stops ?? []).map(stop => `  - ${stop}`));
    if (result.output) lines.push(result.output);
    list('Restored:', result.restored); list('Notes:', result.notes); list('To recover:', result.recovery);
  }
  list('Warnings:', result.warnings);
  console.log(lines.join('\n'));
}
const succeeded = result => ['DONE', 'PLANNED', 'RESTORED'].includes(result.status);

const [first, ...rest] = process.argv.slice(2);
const command = first === undefined || first.startsWith('--') ? 'setup' : first, args = command === 'setup' && first !== 'setup' ? process.argv.slice(2) : rest;
try {
  if (['help', '-h', '--help'].includes(command)) console.log(USAGE);
  else if (command === 'setup') {
    const options = parse(args, ['archive', 'environment', 'mode', 'project-root', 'configure', 'download'], ['skip-browsers', 'dry-run', 'json', 'restore', 'starter']);
    const projectRoot = resolve(options['project-root'] ?? process.cwd()), installed = installedProject(packageRoot);
    const common = {environment: options.environment, mode: options.mode, skipBrowsers: Boolean(options['skip-browsers'])};
    if (options.configure) {
      // Stage 2, started by the bootstrap inside this freshly installed copy.
      const root = verifyInstallation(packageRoot), carried = JSON.parse(process.env.POM_HARNESS_SETUP_NOTES ?? '{}');
      writeResult(root, options.configure, configureInstalled({projectRoot: root, run: options.configure, ...common, starter: Boolean(options.starter), download: options.download, carried}));
    } else if (options.restore) {
      const result = restoreLastRun(verifyInstallation(packageRoot)); print(result, options.json); if (!succeeded(result)) process.exitCode = 1;
    } else if (installed && same(installed, projectRoot)) {
      // The project's own copy: repair, add an environment, refresh. It never installs over itself.
      const root = verifyInstallation(packageRoot); if (options.archive) locateArchive(root, options.archive);
      const result = options['dry-run'] ? planInstalled({projectRoot: root, ...common}) : configureInstalled({projectRoot: root, ...common});
      print(result, options.json); if (!succeeded(result)) process.exitCode = 1;
    } else {
      const result = setupFromArchive({projectRoot, archive: options.archive, ...common, explicitRoot: Boolean(options['project-root']), dryRun: Boolean(options['dry-run'])});
      print(result, options.json); if (!succeeded(result)) process.exitCode = 1;
    }
  } else if (command === 'check') {
    const options = parse(args, [], ['add-env-keys', 'json']), projectRoot = verifyInstallation(packageRoot);
    const result = runCheck({projectRoot, packageRoot, addEnvKeys: Boolean(options['add-env-keys'])});
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(['Readiness:', ...result.features.map(item => `  ${item.status.padEnd(24)} ${item.name}${item.detail ? ` (${item.detail})` : ''}`),
        ...(result.errors.length ? ['Errors:', ...result.errors.map(item => `  - ${item}`)] : []), ...(result.notes.length ? ['Notes:', ...result.notes.map(item => `  - ${item}`)] : []),
        ...(result.envKeysAdded.length ? [`Added empty .env entries for you to fill in: ${result.envKeysAdded.join(', ')}`] : [])].join('\n'));
    }
    if (result.errors.length) process.exitCode = 1;
  } else if (command === 'unlink') {
    parse(args, [], []); const result = unlinkHarness(verifyInstallation(packageRoot));
    console.log(`Removed ${result.removed.length} harness links and pointer files.${result.kept.length ? ` Kept, not harness links: ${result.kept.join(', ')}.` : ''}`);
  } else if (SCRIPTS[command]) {
    const projectRoot = verifyInstallation(packageRoot);
    process.exitCode = spawnSync(process.execPath, [join(packageRoot, 'scripts', SCRIPTS[command]), ...args], {cwd: projectRoot, stdio: 'inherit', windowsHide: true}).status ?? 1;
  } else throw new Error(`Unknown command "${command}". Run "pom-harness help".`);
} catch (error) {console.error(`pom-harness: ${error.message}`); process.exitCode = 1;}
