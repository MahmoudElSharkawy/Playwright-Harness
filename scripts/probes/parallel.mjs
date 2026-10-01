#!/usr/bin/env node
// Fixed, opt-in M16 native validation; runtime secrets never enter saved receipts.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
import sql from 'mssql';
import pg from 'pg';
import {packageRoot, consumerRoots} from '../lib/consumer-paths.mjs';
import {within} from '../lib/skill-roots.mjs';
import {processCall} from '../lib/browser/processes.mjs';
import {inventory} from '../lib/package-validation.mjs';
import {compareExecutions} from '../lib/host-parity.mjs';
import {hostDatabases} from '../../harness-tests/fixtures/host-databases.mjs';
import {executeParallelCases} from '../../harness-tests/fixtures/parallel-live.mjs';
import {proofSignal} from './cancellation.mjs';

if (process.argv.length !== 3) throw new Error('Provide a new external consumer directory for the fixed M16 proof.');
const projectRoot = resolve(process.argv[2]);
assert(!within(packageRoot, projectRoot), 'Native proof requires a separate consumer.');
mkdirSync(projectRoot, {mode: 0o700}); consumerRoots(projectRoot);
if (process.platform === 'win32') {
  const owner = await processCall('whoami', []); assert.equal(owner.exitCode, 0);
  const acl = await processCall('icacls', [projectRoot, '/inheritance:r', '/grant:r', `${owner.stdout.trim()}:(OI)(CI)F`]); assert.equal(acl.exitCode, 0);
}
const save = (name, value) => writeFileSync(join(projectRoot, name), JSON.stringify(value, null, 2), {flag: 'wx', mode: 0o600});
const snapshot = () => inventory(packageRoot).files.map(file => [file, createHash('sha256').update(readFileSync(join(packageRoot, file))).digest('hex')]);
const before = snapshot(), databases = await hostDatabases({signal: proofSignal,
  recordOwnership: record => writeFileSync(join(projectRoot, 'infrastructure-ownership.jsonl'), JSON.stringify(record) + '\n', {flag: 'a', mode: 0o600})});
console.log(JSON.stringify({projectRoot, status: 'FIXTURES_READY'}));
let accepted = false;
try {
  const batches = [];
  for (const concurrency of [1, 2]) {
    proofSignal.throwIfAborted();
    const run = await executeParallelCases(projectRoot, databases, concurrency, proofSignal);
    // Verify retained rows using independent native driver queries before the owned
    // fixture infrastructure is discarded. Retention itself is a successful outcome.
    for (const {recordId, engine, intent} of run.facts.databases) {
      const target = databases.targets[engine], credential = JSON.parse(databases.environment[target.connectionRef.slice(4)]);
      let connection;
      try {
        if (engine === 'sqlserver') {
          connection = new sql.ConnectionPool({server: target.server, port: target.port, database: target.database, ...credential, options: {encrypt: true, trustServerCertificate: true}, connectionTimeout: 5000, requestTimeout: 5000});
          await connection.connect(); const rows = (await connection.request().input('id', sql.Int, recordId).query('SELECT Label FROM m11.Items WHERE Id=@id')).recordset;
          assert.deepEqual(rows, intent === 'persistent' ? [{Label: 'updated'}] : []);
        } else {
          connection = new pg.Client({host: target.server, port: target.port, database: target.database, ...credential, ssl: false, connectionTimeoutMillis: 5000, statement_timeout: 5000});
          await connection.connect(); const rows = (await connection.query('SELECT "Label" FROM m11."Items" WHERE "Id"=$1', [recordId])).rows;
          assert.deepEqual(rows, intent === 'persistent' ? [{Label: 'updated'}] : []);
        }
      } finally {if (connection) await (engine === 'sqlserver' ? connection.close() : connection.end());}
    }
    save(`cases-${concurrency}.json`, run.cases); save(`facts-${concurrency}.json`, run.facts); batches.push(run);
    console.log(JSON.stringify({concurrency, cases: run.cases.length, status: 'VALIDATED'}));
  }
  const comparison = compareExecutions(batches[0].cases, batches[1].cases, batches[0].cases.map(item => item.id));
  assert.equal(comparison.status, 'PASS');
  const packageUnchanged = JSON.stringify(snapshot()) === JSON.stringify(before); assert(packageUnchanged);
  const counts = batches.map(({cases}) => ({scenarios: cases.length, attempts: cases.reduce((sum, item) => sum + item.result.scenarios[0].attempts.length, 0),
    assertions: cases.reduce((sum, item) => sum + item.result.scenarios[0].counts.required, 0), evidence: cases.reduce((sum, item) => sum + item.result.evidence.length, 0),
    statuses: Object.fromEntries(['PASS', 'FAIL', 'NEEDS_REVIEW'].map(status => [status, cases.filter(item => item.result.status === status).length]))}));
  save('assessment.json', {status: 'PASS', platform: process.platform, node: process.version, comparison, counts, packageUnchanged, databases: {versions: databases.versions, images: databases.images}});
  accepted = true;
} finally {
  await databases.close(); save('cleanup.json', {ownedDatabasesRemoved: true, fixtureServersClosed: true});
}
assert(accepted); console.log(readFileSync(join(projectRoot, 'assessment.json'), 'utf8'));
