// Fault fixture: owns real resources, then either drains cancellation or stops responding.
import {readFileSync, writeFileSync, renameSync} from 'node:fs';
import {join} from 'node:path';
import {hostDatabases} from './host-databases.mjs';
import {packageRoot, consumerRoots} from '../../scripts/lib/consumer-paths.mjs';
import {prepareNativeSession} from '../../scripts/lib/browser/native-cli.mjs';
import {proofSignal} from '../../scripts/probes/cancellation.mjs';

const projectRoot = process.argv[2], roots = consumerRoots(projectRoot), request = JSON.parse(readFileSync(join(projectRoot, 'request.json'), 'utf8'));
if (!['browser', 'mixed'].includes(request.kind) || typeof request.cooperative !== 'boolean') throw new Error('Invalid fixed fault request.');
let databases, browser;
const hold = setInterval(() => {}, 1000);
try {
  if (request.kind === 'mixed') databases = await hostDatabases({signal: proofSignal,
    recordOwnership: record => writeFileSync(join(projectRoot, 'infrastructure-ownership.jsonl'), JSON.stringify(record) + '\n', {flag: 'a', mode: 0o600})});
  browser = await prepareNativeSession({...roots, packageRoot, runRoot: join(projectRoot, '.harness/runs/batch/scenario')}, {origins: ['http://fixture.test']});
  await browser.open();
  if (request.loseOpenReceipt === true) {
    // Model termination after the native launch, before the PID response was saved.
    const next = join(browser.workRoot, 'native-ownership.next.json');
    writeFileSync(next, JSON.stringify({version: 1, session: browser.session, stage: 'opening', trees: []}), {flag: 'wx', mode: 0o600});
    renameSync(next, join(browser.workRoot, 'native-ownership.json'));
  }
  writeFileSync(join(projectRoot, 'ready.json'), JSON.stringify({session: browser.session, trees: browser.ownership(), databases: request.kind === 'mixed' ? 2 : 0}), {flag: 'wx', mode: 0o600});
  await new Promise(resolve => {if (request.cooperative) {if (proofSignal.aborted) resolve(); else proofSignal.addEventListener('abort', resolve, {once: true});}});
} finally {
  clearInterval(hold); const closed = await browser?.close(); await databases?.close();
  writeFileSync(join(projectRoot, 'cooperative-cleanup.json'), JSON.stringify({browser: closed?.complete === true, databases: !!databases}), {flag: 'wx', mode: 0o600});
}
