#!/usr/bin/env node
// Disposable local proof; all SQL and bootstrap use pg, never a SQL shell.
import {execFileSync, spawn} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {mkdtempSync, writeFileSync, rmSync, realpathSync, lstatSync} from 'node:fs';
import {join, relative, isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import pg from 'pg';
import {inventory} from '../lib/package-validation.mjs';

export const postgresqlImage = 'postgres@sha256:fe03a7605299a34ddf5e4f285dff78c3d7190a576b3c6b46f2fcff69f4bffd54';
const args = process.argv.slice(2); if (args.length > 1 || args.length && args[0] !== '--linux-client') throw new Error('Only --linux-client is supported.');
const linux = args.length === 1, name = `harness-m10-${randomUUID()}`, clientName = `${name}-client`, networkName = `${name}-network`;
const nodeImage = 'node@sha256:5711a0d445a1af54af9589066c646df387d1831a608226f4cd694fc59e745059';
const generate = () => randomBytes(32).toString('hex'), adminCredential = generate(), runnerCredential = generate(), base = realpathSync(tmpdir());
let created = false, clientCreated = false, networkCreated = false, staging, client, status = 1;
const docker = (arguments_, env = {}) => execFileSync('docker', arguments_, {encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 180000, windowsHide: true, env: {...process.env, POSTGRES_PASSWORD: adminCredential, ...env}}).trim();
try {
  if (linux) {docker(['network','create','--label','playwright-harness.milestone=M10',networkName]); networkCreated = true;}
  docker(['run','--detach','--name',name,'--label','playwright-harness.milestone=M10',...(linux ? ['--network',networkName,'--network-alias','database'] : []),'--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD',postgresqlImage]); created = true;
  const port = Number(docker(['inspect','--format','{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',name]));
  const config = {host: 'localhost', port, user: 'postgres', password: adminCredential, database: 'postgres', ssl: false, connectionTimeoutMillis: 2000, statement_timeout: 10000};
  for (let i = 0; i < 60; i++) {
    client = new pg.Client(config); client.on('error', () => {});
    try {await client.connect(); break;} catch {await client.end().catch(() => {}); if (i === 59) throw new Error('DATABASE_STARTUP'); await pause(1000);}
  }
  await client.query('CREATE DATABASE "HarnessM10"');
  // Generated hexadecimal credential is never logged or passed through a shell.
  await client.query(`CREATE ROLE harness_runner LOGIN PASSWORD '${runnerCredential}'`);
  await client.end(); client = new pg.Client({...config, database: 'HarnessM10'}); await client.connect();
  for (const statement of ['CREATE SCHEMA m10', 'REVOKE ALL ON DATABASE "HarnessM10" FROM PUBLIC', 'REVOKE ALL ON SCHEMA public FROM PUBLIC',
    'GRANT CONNECT ON DATABASE "HarnessM10" TO harness_runner', 'GRANT USAGE ON SCHEMA m10 TO harness_runner',
    'CREATE TABLE m10."Items" ("Id" integer PRIMARY KEY, "Label" varchar(500))', 'CREATE TABLE m10."OtherItems" ("Id" integer PRIMARY KEY, "Label" varchar(500))',
    'CREATE TABLE public."OutsideScope" ("Id" integer)', 'INSERT INTO public."OutsideScope" VALUES (1)',
    'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA m10 TO harness_runner',
    'ALTER DEFAULT PRIVILEGES IN SCHEMA m10 GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO harness_runner']) await client.query(statement);
  const version = (await client.query('SHOW server_version')).rows[0].server_version;
  const target = {engine: 'postgresql', connectionRef: 'env:M10_DB_CREDENTIAL', server: linux ? 'database' : 'localhost', port: linux ? 5432 : port, database: 'HarnessM10', schema: 'm10', encrypt: false};
  const testEnvironment = {HARNESS_M10_TARGET: JSON.stringify(target), M10_DB_CREDENTIAL: JSON.stringify({user: 'harness_runner', password: runnerCredential}), HARNESS_M10_ADMIN: JSON.stringify({...config, database: 'HarnessM10', ...(linux ? {host: 'database', port: 5432} : {})})};
  const suites = ['harness-tests/postgresql-runtime.test.mjs','harness-tests/postgresql.integration.mjs','harness-tests/database-neutrality.integration.mjs'];
  if (linux) {
    staging = mkdtempSync(join(base, 'harness-m10-public-')); writeFileSync(join(staging, 'files.txt'), inventory(process.cwd()).files.join('\n') + '\n');
    execFileSync('tar', ['-cf',join(staging,'source.tar'),'-T',join(staging,'files.txt')], {stdio: 'pipe', windowsHide: true});
    docker(['create','--name',clientName,'--label','playwright-harness.milestone=M10','--init','--network',networkName,'--env','HARNESS_M10_TARGET','--env','M10_DB_CREDENTIAL','--env','HARNESS_M10_ADMIN','--entrypoint','sh',nodeImage,'-c',
      `mkdir -m 700 /package && tar -xf /source.tar -C /package && cd /package && npm ci --ignore-scripts --no-audit --no-fund && node --version && node --test --test-concurrency=1 ${suites.join(' ')}`], testEnvironment); clientCreated = true;
    docker(['cp',join(staging,'source.tar'),`${clientName}:/source.tar`]);
  }
  const child = linux ? spawn('docker',['start','-a',clientName],{stdio:'inherit',windowsHide:true}) : spawn(process.execPath,['--test','--test-concurrency=1',...suites],{stdio:'inherit',windowsHide:true,env:{...process.env,...testEnvironment}});
  status = await new Promise(resolve => {child.once('error', () => resolve(1)); child.once('exit', code => resolve(code ?? 1));});
  console.log(JSON.stringify({probe:'postgresql',status:status === 0 ? 'PASS' : 'FAIL',image:postgresqlImage,version,driver:'pg-8.23.1',liveDatabase:true,...(linux ? {platform:'linux',clientImage:nodeImage} : {platform:process.platform,node:process.version})}));
} catch {status = 1; console.error(JSON.stringify({probe:'postgresql',status:'ERROR',reason:'Fixture setup or runner failed; native output withheld.'}));}
finally {
  await client?.end().catch(() => {});
  if (clientCreated) try {docker(['rm','--force',clientName]); clientCreated = false;} catch {status = 1;}
  if (created) try {docker(['rm','--force',name]); created = false;} catch {status = 1;}
  if (networkCreated) try {docker(['network','rm',networkName]); networkCreated = false;} catch {status = 1;}
  if (staging) {
    const actual = realpathSync(staging), suffix = relative(base, actual);
    if (isAbsolute(suffix) || !suffix.startsWith('harness-m10-public-') || suffix.includes('..') || lstatSync(staging).isSymbolicLink()) throw new Error('Unexpected fixture staging boundary.');
    rmSync(actual, {recursive: true});
  }
  console.log(JSON.stringify({probe:'postgresql-cleanup',status:!created && !clientCreated && !networkCreated ? 'PASS' : 'FAIL',ownedContainerRemoved:!created,ownedClientRemoved:!clientCreated,ownedNetworkRemoved:!networkCreated}));
}
process.exitCode = status;
