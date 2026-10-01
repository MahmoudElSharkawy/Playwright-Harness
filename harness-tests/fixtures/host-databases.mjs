// Owned, disposable M11 infrastructure. Driver bootstrap is outside scenario execution.
import {execFileSync} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {createServer, connect} from 'node:net';
import sql from 'mssql';
import pg from 'pg';
export const images = Object.freeze({
  sqlserver: 'mcr.microsoft.com/mssql/server@sha256:4402d880dd4c34bfa7d8705e56a86cd6c88da80a1f6bbbe741f999e76264a090',
  postgresql: 'postgres@sha256:fe03a7605299a34ddf5e4f285dff78c3d7190a576b3c6b46f2fcff69f4bffd54'
});
// A Docker Desktop client has a different loopback namespace. Keep only this
// owned fixture's transport local; parity must not ignore arbitrary remote ports.
async function localFixturePort(host, port, cleanup) {
  const sockets = new Set();
  const server = createServer(socket => {
    const upstream = connect({host, port}); sockets.add(socket); sockets.add(upstream);
    socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
    socket.on('close', () => {sockets.delete(socket); upstream.destroy();});
    upstream.on('close', () => {sockets.delete(upstream); socket.destroy();});
    socket.pipe(upstream); upstream.pipe(socket);
  });
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  return server.address().port;
}
export async function hostDatabases({signal, recordOwnership = () => {}, dockerHost = process.env.HARNESS_PROOF_DOCKER_HOST ?? 'localhost'} = {}) {
  // Containerized local clients reach the same loopback-published fixtures through
  // Docker Desktop's host gateway. This is not an arbitrary database destination.
  if (!['localhost', 'host.docker.internal'].includes(dockerHost)) throw new Error('Unsupported local fixture route.');
  const owned = [], connections = [], targets = {}, environment = {}, versions = {};
  const docker = (args, env = {}) => execFileSync('docker', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 180000, env: {...process.env, ...env}}).trim();
  const close = async () => {
    const errors = [];
    for (const connection of connections.reverse()) try {await connection();} catch {errors.push('connection');}
    for (const name of owned.reverse()) try {docker(['rm', '--force', name]);} catch {errors.push('container');}
    if (errors.length) throw new Error('Owned database cleanup incomplete.');
  };
  try {
    for (const engine of Object.keys(images)) {
      signal?.throwIfAborted();
      const owner = randomUUID();
      const name = `harness-m11-${engine}-${randomUUID()}`, admin = `${randomBytes(32).toString('hex')}aA1!`, runner = `${randomBytes(32).toString('hex')}aA1!`;
      const isPg = engine === 'postgresql', internalPort = isPg ? '5432' : '1433';
      const key = {postgresql: 'POSTGRES_PASSWORD', sqlserver: 'MSSQL_SA_PASSWORD'}[engine];
      // Register intent before launch: a daemon error after create must still trigger exact-name cleanup.
      owned.push(name);
      recordOwnership({name, owner});
      docker(['run', '--detach', '--name', name, '--label', 'playwright-harness.milestone=M11', '--label', `playwright-harness.owner=${owner}`, '--publish', `127.0.0.1::${internalPort}`, '--env', key,
        ...(!isPg ? ['--env', 'ACCEPT_EULA=Y', '--env', 'MSSQL_PID=Developer'] : []), images[engine]], {[key]: admin});
      const port = Number(docker(['inspect', '--format', `{{(index (index .NetworkSettings.Ports "${internalPort}/tcp") 0).HostPort}}`, name]));
      let connection;
      connections.push(async () => {if (connection) await (isPg ? connection.end() : connection.close());});
      const config = isPg ? {host: dockerHost, port, user: 'postgres', password: admin, database: 'postgres', ssl: false, connectionTimeoutMillis: 2000, statement_timeout: 10000}
        : {server: dockerHost, port, user: 'sa', password: admin, database: 'master', connectionTimeout: 2000, requestTimeout: 10000, options: {encrypt: true, trustServerCertificate: true}};
      for (let i = 0; i < 90; i++) {
        signal?.throwIfAborted();
        connection = isPg ? new pg.Client(config) : new sql.ConnectionPool(config); connection.on('error', () => {});
        try {await connection.connect(); break;} catch {await (isPg ? connection.end() : connection.close()).catch(() => {}); if (i === 89) throw new Error('Native database startup failed.'); await pause(1000);}
      }
      let query = text => isPg ? connection.query(text) : connection.request().query(text);
      await query(isPg ? 'CREATE DATABASE "HarnessM11"' : 'CREATE DATABASE HarnessM11');
      await query(isPg ? `CREATE ROLE harness_runner LOGIN PASSWORD '${runner}'` : `CREATE LOGIN harness_runner WITH PASSWORD = '${runner}'`);
      await (isPg ? connection.end() : connection.close());
      connection = isPg ? new pg.Client({...config, database: 'HarnessM11'}) : new sql.ConnectionPool({...config, database: 'HarnessM11'});
      await connection.connect();
      query = text => isPg ? connection.query(text) : connection.request().query(text);
      for (const statement of isPg ? ['CREATE SCHEMA m11', 'REVOKE ALL ON DATABASE "HarnessM11" FROM PUBLIC', 'REVOKE ALL ON SCHEMA public FROM PUBLIC',
        'CREATE TABLE m11."Items" ("Id" integer PRIMARY KEY,"Label" varchar(500))', 'GRANT CONNECT ON DATABASE "HarnessM11" TO harness_runner',
        'GRANT USAGE ON SCHEMA m11 TO harness_runner', 'GRANT SELECT,INSERT,UPDATE,DELETE ON m11."Items" TO harness_runner']
        : ['CREATE SCHEMA m11', 'CREATE USER harness_runner FOR LOGIN harness_runner WITH DEFAULT_SCHEMA=m11',
          'CREATE TABLE m11.Items (Id int PRIMARY KEY, Label nvarchar(500))', 'GRANT SELECT,INSERT,UPDATE,DELETE ON SCHEMA::m11 TO harness_runner']) await query(statement);
      versions[engine] = isPg ? (await query('SHOW server_version')).rows[0].server_version : (await query("SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS version")).recordset[0].version;
      const reference = isPg ? 'M11_POSTGRESQL_CREDENTIAL' : 'M11_SQLSERVER_CREDENTIAL';
      const targetPort = dockerHost === 'localhost' ? port : await localFixturePort(dockerHost, port, connections);
      targets[engine] = {engine, server: 'localhost', port: targetPort, database: 'HarnessM11', schema: 'm11', connectionRef: `env:${reference}`, encrypt: !isPg, ...(!isPg ? {trustServerCertificate: true} : {})};
      environment[reference] = JSON.stringify({user: 'harness_runner', password: runner});
    }
    return {targets, environment, versions, images, close};
  } catch (error) {await close(); throw error;}
}
