#!/usr/bin/env node
// Own a disposable local instance. SQL (including bootstrap) only goes through mssql.
import {execFileSync, spawn} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {mkdtempSync, writeFileSync, rmSync, realpathSync, lstatSync} from 'node:fs';
import {join, relative, isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {inventory} from '../lib/package-validation.mjs';
import sql from 'mssql';

export const sqlServerImage = 'mcr.microsoft.com/mssql/server@sha256:4402d880dd4c34bfa7d8705e56a86cd6c88da80a1f6bbbe741f999e76264a090';
const args = process.argv.slice(2), linux = args.includes('--linux-client'), mixed = args.includes('--mixed'), neutrality = args.includes('--neutrality');
if (mixed && neutrality || new Set(args).size !== args.length || args.some(arg => !['--linux-client','--mixed','--neutrality'].includes(arg) && !/^--browser-client-image=sha256:[a-f0-9]{64}$/.test(arg))) throw new Error('Unsupported probe option.');
const browserImages = args.filter(arg => arg.startsWith('--browser-client-image='));
if (browserImages.length > 1 || (linux && mixed ? browserImages.length !== 1 : browserImages.length !== 0)) throw new Error('Mixed Linux proof needs exactly one pinned browser-client image.');
const milestone = neutrality ? 'M10' : mixed ? 'M9' : 'M8', suite = neutrality ? 'harness-tests/database-neutrality.integration.mjs' : mixed ? 'harness-tests/mixed.integration.mjs' : 'harness-tests/sqlserver.integration.mjs';
const name = `harness-${milestone.toLowerCase()}-${randomUUID()}`, generate = () => `${randomBytes(32).toString('hex')}aA1!`;
const clientName = `${name}-client`, networkName = `${name}-network`;
const nodeImage = mixed && linux ? browserImages[0].slice('--browser-client-image='.length) : 'node@sha256:5711a0d445a1af54af9589066c646df387d1831a608226f4cd694fc59e745059';
const adminCredential = generate(), runnerCredential = generate();
const stagingBase = realpathSync(tmpdir());
let created = false, clientCreated = false, networkCreated = false, staging, pool, status = 1, cleanup = false;
const docker = (args, env = {}) => execFileSync('docker', args, {encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 180000, env: {...process.env, MSSQL_SA_PASSWORD: adminCredential, ...env}}).trim();
try {
  if (linux) {docker(['network','create','--label',`playwright-harness.milestone=${milestone}`,networkName]); networkCreated = true;}
  docker(['run','--detach','--name',name,'--label',`playwright-harness.milestone=${milestone}`,...(linux?['--network',networkName,'--network-alias','database']:[]),'--publish','127.0.0.1::1433','--env','ACCEPT_EULA=Y','--env','MSSQL_PID=Developer','--env','MSSQL_SA_PASSWORD',sqlServerImage]); created = true;
  const port = Number(docker(['inspect','--format','{{(index (index .NetworkSettings.Ports "1433/tcp") 0).HostPort}}',name]));
  const config = {server: 'localhost', port, user: 'sa', password: adminCredential, database: 'master', connectionTimeout: 2000, requestTimeout: 10000, options: {encrypt: true, trustServerCertificate: true}, pool: {min: 0, max: 4}};
  for (let i = 0; i < 90; i++) {
    pool = new sql.ConnectionPool(config); pool.on('error', () => {});
    try {await pool.connect(); break;} catch {await pool.close().catch(() => {}); if (i === 89) throw new Error('SQL_STARTUP'); await pause(1000);}
  }
  await pool.request().query('CREATE DATABASE HarnessM8');
  await pool.request().query(`CREATE LOGIN harness_runner WITH PASSWORD = '${runnerCredential}'`);
  await pool.close(); pool = await new sql.ConnectionPool({...config, database: 'HarnessM8'}).connect();
  await pool.request().query(`CREATE SCHEMA m8 AUTHORIZATION dbo`);
  await pool.request().query(`CREATE USER harness_runner FOR LOGIN harness_runner WITH DEFAULT_SCHEMA=m8;
    GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::m8 TO harness_runner;
    CREATE TABLE m8.Items (Id int NOT NULL PRIMARY KEY, Label nvarchar(500) NULL, Revision rowversion);
    CREATE TABLE m8.OtherItems (Id int NOT NULL PRIMARY KEY, Label nvarchar(500) NULL);
    CREATE TABLE dbo.OutsideScope (Id int);
    INSERT dbo.OutsideScope VALUES (1)`);
  const version = (await pool.request().query("SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS version")).recordset[0].version;
  const target = {engine: 'sqlserver', connectionRef: 'env:M8_DB_CREDENTIAL', server: 'localhost', port, database: 'HarnessM8', schema: 'm8', encrypt: true, trustServerCertificate: true};
  const testEnvironment = {HARNESS_M8_TARGET: JSON.stringify({...target,...(linux?{server:'database',port:1433}:{})}), M8_DB_CREDENTIAL: JSON.stringify({user: 'harness_runner', password: runnerCredential}), HARNESS_M8_ADMIN: JSON.stringify({...config, database: 'HarnessM8',...(linux?{server:'database',port:1433}:{})})};
  if (neutrality) Object.assign(testEnvironment, {HARNESS_M10_TARGET: JSON.stringify({...JSON.parse(testEnvironment.HARNESS_M8_TARGET),connectionRef:'env:M10_DB_CREDENTIAL'}), M10_DB_CREDENTIAL:testEnvironment.M8_DB_CREDENTIAL,HARNESS_M10_ADMIN:testEnvironment.HARNESS_M8_ADMIN});
  if (linux) {
    staging = mkdtempSync(join(stagingBase,'harness-m8-public-')); const files = inventory(process.cwd()).files;
    writeFileSync(join(staging,'files.txt'), files.join('\n')+'\n');
    execFileSync('tar',['-cf',join(staging,'source.tar'),'-T',join(staging,'files.txt')],{stdio:'pipe'});
    docker(['create','--name',clientName,'--label',`playwright-harness.milestone=${milestone}`,'--init','--shm-size=1g','--network',networkName,...Object.keys(testEnvironment).flatMap(name=>['--env',name]),'--entrypoint','sh',nodeImage,'-c',
      `mkdir -m 700 /package && tar -xf /source.tar -C /package && cd /package && npm ci --ignore-scripts --no-audit --no-fund && ${mixed?'mkdir -p scripts/spikes/playwright-cli/node_modules && cp -a /opt/m4/node_modules/. scripts/spikes/playwright-cli/node_modules/ && ':''}node --version && node --test --test-concurrency=1 ${mixed?'harness-tests/sequential-runtime.test.mjs':'harness-tests/database-runtime.test.mjs'} ${suite}`],testEnvironment); clientCreated=true;
    docker(['cp',join(staging,'source.tar'),`${clientName}:/source.tar`]);
  }
  const child = linux ? spawn('docker',['start','-a',clientName],{stdio:'inherit'}) : spawn(process.execPath, ['--test','--test-concurrency=1',suite], {stdio: 'inherit', env: {...process.env,...testEnvironment}});
  status = await new Promise(resolve => {child.once('error', () => resolve(1)); child.once('exit', code => resolve(code ?? 1));});
  console.log(JSON.stringify({probe: mixed ? 'mixed' : 'sqlserver', status: status === 0 ? 'PASS' : 'FAIL', image: sqlServerImage, version, driver: 'mssql-12.7.2', ...(linux?{clientImage:nodeImage,platform:'linux'}:{node:process.version,platform:process.platform}), liveDatabase: true, ...(mixed?{nativeBrowserRequired:true}:{} )}));
} catch {status = 1; console.error(JSON.stringify({probe: 'sqlserver', status: 'ERROR', reason: 'Fixture setup or runner failed; native output withheld.'}));}
finally {
  if (pool) await pool.close().catch(() => {});
  if (clientCreated) {try {docker(['rm','--force',clientName]);clientCreated=false;}catch{status=1;}}
  if (created) {try {docker(['rm','--force',name]); cleanup = true;} catch {status = 1;}}
  if (networkCreated) {try {docker(['network','rm',networkName]);networkCreated=false;}catch{status=1;}}
  if (staging) {
    const actual = realpathSync(staging), suffix = relative(stagingBase, actual);
    if (isAbsolute(suffix) || !suffix.startsWith('harness-m8-public-') || suffix.includes('..') || lstatSync(staging).isSymbolicLink()) throw new Error('Unexpected fixture staging boundary.');
    rmSync(actual,{recursive:true});
  }
  console.log(JSON.stringify({probe: 'sqlserver-cleanup', status: cleanup && !clientCreated && !networkCreated ? 'PASS' : 'FAIL', ownedContainerRemoved: cleanup, ownedClientRemoved:!clientCreated,ownedNetworkRemoved:!networkCreated}));
}
process.exitCode = status;
