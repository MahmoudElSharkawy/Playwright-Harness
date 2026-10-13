#!/usr/bin/env node
// Disposable MySQL proof: bootstrap and test SQL use mysql2, never a SQL shell.
import {execFileSync, spawn} from 'node:child_process';
import {randomBytes, randomUUID, X509Certificate} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import mysql from 'mysql2/promise';
import {mkdtempSync, writeFileSync, rmSync, realpathSync, lstatSync} from 'node:fs';
import {resolve, join, relative, isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

// Official library/mysql:8.4 manifest digest verified against registry-1.docker.io.
export const mysqlImage = 'mysql@sha256:24989179f58856db763f418010c1169fecc944e3ec1ea7e921572d83eb070f70';
export async function main(args = []) {
  if (args.length) throw new Error('The MySQL probe accepts no options.');
  const name = `harness-mysql-${randomUUID()}`, generate = () => randomBytes(32).toString('hex');
  const adminCredential = generate(), runnerCredential = generate(), temporaryRoot = realpathSync(tmpdir());
  let containerAttempted = false, removed = true, certificateRemoved = true, certificateDirectory, client, status = 1;
  const docker = (args, timeout = 180000) => execFileSync('docker', args, {encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout,
    windowsHide: true, env: {...process.env, MYSQL_ROOT_PASSWORD: adminCredential}}).trim();
  try {
    docker(['version','--format','{{.Server.Version}}'], 10000);
    containerAttempted = true; removed = false;
    docker(['run','--detach','--name',name,'--label','playwright-harness.issue=57','--publish','127.0.0.1::3306',
      '--env','MYSQL_ROOT_PASSWORD','--env','MYSQL_ROOT_HOST=%',mysqlImage,'--default-time-zone=+00:00','--local-infile=0',
      '--sql-mode=STRICT_ALL_TABLES,NO_BACKSLASH_ESCAPES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO']);
    const port = Number(docker(['inspect','--format','{{(index (index .NetworkSettings.Ports "3306/tcp") 0).HostPort}}',name], 10000));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MYSQL_FIXTURE_PORT');
    const config = {host: '127.0.0.1', port, user: 'root', password: adminCredential, connectTimeout: 2000,
      supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, jsonStrings: true, timezone: 'Z', multipleStatements: false};
    const deadline = Date.now() + 120000;
    while (!client) {
      try {client = await mysql.createConnection(config);}
      catch {if (Date.now() >= deadline) throw new Error('MYSQL_STARTUP'); await pause(1000);}
    }
    const bootstrap = sql => client.query({sql, timeout: 10000});
    await bootstrap('CREATE DATABASE HarnessMysql CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
    await bootstrap('CREATE DATABASE OutsideMysql');
    // The generated hexadecimal password stays in native driver memory and environment variables.
    await bootstrap(`CREATE USER 'harness_runner'@'%' IDENTIFIED BY '${runnerCredential}'`);
    for (const sql of [
      'CREATE TABLE HarnessMysql.Items (Id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, Label VARCHAR(500)) ENGINE=InnoDB AUTO_INCREMENT=9007199254740993',
      'CREATE TABLE HarnessMysql.HugeIds (Id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, Label VARCHAR(500)) ENGINE=InnoDB AUTO_INCREMENT=9223372036854775808',
      'CREATE TABLE HarnessMysql.Typed (Id INT PRIMARY KEY, SignedValue BIGINT, UnsignedValue BIGINT UNSIGNED, Amount DECIMAL(30,4), Flag BOOLEAN, Ratio DOUBLE, Label VARCHAR(500), BodyText TEXT, Bytes VARBINARY(10), Day DATE, Moment DATETIME(6), Stamp TIMESTAMP(6) NULL, Document JSON, NullableValue VARCHAR(50)) ENGINE=InnoDB',
      'CREATE TABLE HarnessMysql.ProbeBits (Bits BIT(8)) ENGINE=InnoDB',
      'INSERT INTO HarnessMysql.ProbeBits VALUES (0x81)',
      'CREATE TABLE HarnessMysql.UniqueItems (Label VARCHAR(500) NOT NULL UNIQUE) ENGINE=InnoDB',
      'CREATE TABLE OutsideMysql.Items (Id INT PRIMARY KEY) ENGINE=InnoDB',
      'INSERT INTO OutsideMysql.Items VALUES (1)',
      "GRANT SELECT,INSERT,UPDATE,DELETE ON HarnessMysql.* TO 'harness_runner'@'%'"
    ]) await bootstrap(sql);
    const [[{version}]] = await bootstrap('SELECT VERSION() AS version');
    if (!/^8\.4\./.test(version)) throw new Error('MYSQL_FIXTURE_VERSION');
    await client.end(); client = undefined;
    const publicCa = new X509Certificate(docker(['exec',name,'cat','/var/lib/mysql/ca.pem'],10000));
    if (!publicCa.ca) throw new Error('MYSQL_FIXTURE_CA');
    certificateDirectory = mkdtempSync(join(temporaryRoot,'harness-mysql-public-')); certificateRemoved = false;
    const certificatePath = join(certificateDirectory,'ca.pem'); writeFileSync(certificatePath,publicCa.toString(),{mode:0o600});
    const target = {engine: 'mysql', connectionRef: 'env:MYSQL_DB_CREDENTIAL', server: config.host, port, database: 'HarnessMysql', schema: 'HarnessMysql', encrypt: false};
    const testEnvironment = {HARNESS_MYSQL_TARGET: JSON.stringify(target), MYSQL_DB_CREDENTIAL: JSON.stringify({user: 'harness_runner', password: runnerCredential}),
      HARNESS_MYSQL_ADMIN: JSON.stringify({...config, database: target.database}), NODE_EXTRA_CA_CERTS:certificatePath, HARNESS_MYSQL_CA_PATH:certificatePath};
    const child = spawn(process.execPath, ['--test','--test-reporter=tap','--test-concurrency=1','--test-timeout=180000','harness-tests/mysql-driver.test.mjs','harness-tests/mysql-syntax.test.mjs','harness-tests/mysql-runtime.test.mjs','harness-tests/mysql.integration.mjs'],
      {stdio: 'inherit', windowsHide: true, timeout: 360000, env: {...process.env, ...testEnvironment}});
    status = await new Promise(resolve => {child.once('error', () => resolve(1)); child.once('exit', code => resolve(code ?? 1));});
    console.log(JSON.stringify({probe: 'mysql', status: status === 0 ? 'PASS' : 'FAIL', image: mysqlImage, version, driver: 'mysql2-3.24.5',
      liveDatabase: true, nativeBrowserRequired: true, platform: process.platform, node: process.version}));
  } catch {status = 1; console.error(JSON.stringify({probe: 'mysql', status: 'ERROR', reason: 'Fixture setup or runner failed; native output withheld.'}));}
  finally {
    await client?.end().catch(() => {});
    if (containerAttempted) {
      try {docker(['rm','--force',name], 15000); removed = true;}
      catch (error) {removed = /No such container/i.test(error.stderr?.toString() ?? ''); if (!removed) status = 1;}
    }
    if (certificateDirectory) {
      const actual = realpathSync(certificateDirectory), suffix = relative(temporaryRoot,actual);
      if (isAbsolute(suffix) || !suffix.startsWith('harness-mysql-public-') || suffix.includes('..') || lstatSync(certificateDirectory).isSymbolicLink()) throw new Error('Unexpected fixture certificate boundary.');
      try {rmSync(actual,{recursive:true}); certificateRemoved = true;} catch {status = 1;}
    }
    console.log(JSON.stringify({probe: 'mysql-cleanup', status: removed && certificateRemoved ? 'PASS' : 'FAIL', ownedContainerRemoved: removed, ownedCertificateRemoved:certificateRemoved}));
  }
  return status;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
