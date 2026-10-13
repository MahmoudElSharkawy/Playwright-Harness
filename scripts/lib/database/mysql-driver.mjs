import mysql from 'mysql2';
import {isIP} from 'node:net';
import {requireThat, integer} from '../execution-core/data.mjs';
import {DatabaseFailure, bounded, credentials} from './shared.mjs';
import {quoteIdentifier} from './mysql-syntax.mjs';

const types = mysql.Types, typed = mysql.TypedParameter;
function validTemporal(value, type) {
  if (typeof value !== 'string') return false;
  const match = /^([1-9]\d{3})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?:T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?)?(Z)?$/.exec(value);
  if (!match || (type === 'date' ? match[4] !== undefined : match[4] === undefined) || Boolean(match[5]) !== (type === 'timestamp')) return false;
  return Number(match[3]) <= new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
}
export function validateTarget(target) {
  requireThat(target?.engine === 'mysql' && typeof target.server === 'string' && /^[A-Za-z0-9.-]+$/.test(target.server), 'MySQL needs an explicit server.');
  requireThat(target.encrypt === false || target.trustServerCertificate || !isIP(target.server), 'Verified MySQL TLS requires a DNS server name.');
  quoteIdentifier(target.database);
  requireThat(target.database.trim() === target.database && !/[.\\/%]/.test(target.database)
    && !['mysql', 'sys', 'information_schema', 'performance_schema'].includes(target.database.toLowerCase()), 'MySQL needs an explicit ordinary database scope.');
  requireThat(target.schema === undefined || target.schema === target.database, 'MySQL schema must equal its database, or be omitted.');
}

/** Bind native protocol values; temporal strings avoid JavaScript Date precision loss. */
export function parameter(p) {
  const v = p.value; requireThat(v !== undefined, 'Database input is missing.');
  if (v === null) return null;
  if (['text', 'varchar'].includes(p.type)) {
    requireThat(typeof v === 'string' && Buffer.byteLength(v) <= p.length, 'Text binding exceeds its byte bound.'); return typed.VARCHAR(v);
  }
  if (p.type === 'int') {requireThat(Number.isInteger(v) && v >= -2147483648 && v <= 2147483647, 'MySQL int is out of range.'); return typed.INT(v);}
  if (['bigint', 'unsigned bigint'].includes(p.type)) {
    requireThat(typeof v === 'string' && /^-?(?:0|[1-9][0-9]*)$/.test(v), 'Bigint needs exact integer text.');
    const n = BigInt(v), unsigned = p.type === 'unsigned bigint';
    requireThat(n >= (unsigned ? 0n : -(2n ** 63n)) && n < 2n ** (unsigned ? 64n : 63n), 'MySQL bigint is out of range.');
    return unsigned ? typed.BIGINT.unsigned(v) : typed.BIGINT(v);
  }
  if (p.type === 'boolean') {requireThat(typeof v === 'boolean', 'Boolean binding needs a boolean.'); return typed.TINYINT(v ? 1 : 0);}
  if (p.type === 'double') {requireThat(typeof v === 'number' && Number.isFinite(v), 'Double binding needs a finite number.'); return typed.DOUBLE(v);}
  if (p.type === 'decimal') {
    requireThat(typeof v === 'string' && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(v), 'Decimal binding needs exact text.');
    const [whole, fraction = ''] = v.replace(/^-/, '').split('.');
    requireThat(whole.replace(/^0$/, '').length <= p.precision - p.scale && fraction.length <= p.scale, 'Decimal exceeds its precision or scale.'); return typed.DECIMAL(v);
  }
  if (p.type === 'varbinary') {
    requireThat(typeof v === 'string' && /^(?:[a-f0-9]{2})*$/i.test(v) && v.length / 2 <= p.length, 'Binary binding needs bounded hexadecimal text.'); return typed.BLOB(Buffer.from(v, 'hex'));
  }
  if (p.type === 'json') {
    requireThat(v && typeof v === 'object', 'JSON binding needs a structured value.'); const encoded = JSON.stringify(v);
    requireThat(Buffer.byteLength(encoded) <= p.length, 'JSON binding exceeds its byte bound.'); return typed.JSON(v);
  }
  if (['date', 'datetime', 'timestamp'].includes(p.type)) {
    requireThat(validTemporal(v, p.type), 'Temporal binding needs valid ISO calendar text with at most microseconds.');
    return typed.VARCHAR(v.replace('T', ' ').replace(/Z$/, '')); // Server strict mode validates calendar/range.
  }
  throw new DatabaseFailure('EXECUTOR', false, 'UNSUPPORTED_TYPE');
}

export function normalized(value, field) {
  if (value === null) return null;
  const type = field.columnType;
  if ([types.TINY, types.SHORT, types.LONG, types.INT24, types.YEAR, types.FLOAT, types.DOUBLE].includes(type)) {
    requireThat(typeof value === 'number' && Number.isFinite(value) && ([types.FLOAT, types.DOUBLE].includes(type) || Number.isSafeInteger(value)), 'Unrepresentable numeric result.'); return value;
  }
  if ([types.LONGLONG, types.DECIMAL, types.NEWDECIMAL].includes(type)) {
    requireThat(typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value), 'Exact numeric result needs text.'); return value;
  }
  if ([types.DATE, types.NEWDATE, types.DATETIME, types.TIMESTAMP].includes(type)) {
    requireThat(typeof value === 'string', 'Unsupported temporal result.');
    const result = value.replace(' ', 'T') + (type === types.TIMESTAMP ? 'Z' : '');
    requireThat(validTemporal(result, type === types.TIMESTAMP ? 'timestamp' : type === types.DATETIME ? 'datetime' : 'date'), 'Unsupported temporal result.'); return result;
  }
  if (type === types.JSON) {requireThat(typeof value === 'string', 'JSON result needs exact text.'); return value;}
  if ([types.VARCHAR, types.VAR_STRING, types.STRING, types.TINY_BLOB, types.MEDIUM_BLOB, types.LONG_BLOB, types.BLOB, types.ENUM, types.SET].includes(type)) {
    requireThat(typeof value === 'string' || Buffer.isBuffer(value), 'Unsupported string or binary result.'); return Buffer.isBuffer(value) ? value.toString('hex') : value;
  }
  throw new DatabaseFailure('EXECUTOR', true, 'UNSUPPORTED_RESULT');
}

/** A narrow, complete SHOW GRANTS allowlist; unknown or role-derived grants fail closed. */
export function validateGrants(grants, database, principal, partialRevokes) {
  const at = principal.lastIndexOf('@'); requireThat(at > 0, 'Invalid database principal.');
  const account = `${quoteIdentifier(principal.slice(0, at))}@${quoteIdentifier(principal.slice(at + 1))}`;
  let scoped = false;
  for (const grant of grants) {
    requireThat(typeof grant === 'string' && grant.endsWith(` TO ${account}`), 'Unsupported database principal grant.');
    const statement = grant.slice(0, -` TO ${account}`.length);
    if (statement === 'GRANT USAGE ON *.*') continue;
    const match = /^GRANT ([A-Z, ]+) ON `((?:[^`]|``)+)`\.\*$/.exec(statement);
    requireThat(match && match[1].split(', ').every(p => ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(p)), 'Database principal must have only scoped DML grants.');
    let scope = match[2].replaceAll('``', '`');
    if (!partialRevokes) {
      requireThat(!/(?:^|[^\\])(?:\\\\)*[_%]/.test(scope), 'Wildcard database grants are unsupported.');
      scope = scope.replace(/\\([_%\\])/g, '$1');
    }
    requireThat(scope === database, 'Database grant is outside the configured scope.'); scoped = true;
  }
  requireThat(scoped, 'A dedicated database grant is required.');
}

/** One connection/transaction per operation; never report partial or uncertain work as success. */
export async function executeMysql(target, auth, request, {signal, timeoutMs, maxRows, maxResponseBytes}) {
  validateTarget(target); auth = credentials(auth); const values = request.parameters.map(parameter);
  requireThat(!request.guard, 'MySQL restoration is unsupported.');
  if (signal.aborted) throw new DatabaseFailure(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
  const connection = mysql.createConnection({host: target.server, port: target.port ?? 3306, database: target.database, ...auth,
    ssl: target.encrypt === false ? undefined : {rejectUnauthorized: !target.trustServerCertificate, verifyIdentity: !target.trustServerCertificate},
    connectTimeout: Math.min(timeoutMs, 5000), charset: 'utf8mb4', timezone: 'Z', multipleStatements: false,
    flags: ['FOUND_ROWS', '-LOCAL_FILES', '-MULTI_STATEMENTS', '-MULTI_RESULTS', '-PS_MULTI_RESULTS'],
    supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, dateStrings: true, jsonStrings: true,
    rowsAsArray: true, namedPlaceholders: false, maxPreparedStatements: 16});
  let dispatched = false, destroyed = false;
  // mysql2.destroy() ends the stream; explicitly destroy its socket for bounded local cancellation.
  const close = () => {if (!destroyed) {destroyed = true; connection.destroy(); connection.stream.destroy();}};
  connection.on('error', () => {}); // Native diagnostics may contain SQL or confidential values.
  signal.addEventListener('abort', close, {once: true});
  async function collect(text, parameters = [], {prepared = true, business = false} = {}) {
    const rows = []; let fields, header, fieldEvents = 0, bytes = 0;
    const rowLimit = business ? maxRows : 1000, byteLimit = business ? maxResponseBytes : 1048576;
    return bounded(() => new Promise((resolve, reject) => {
      let failed = false;
      const fail = error => {if (!failed) {failed = true; reject(error); close();}};
      const command = prepared ? connection.execute({sql: text, values: parameters, rowsAsArray: true}) : connection.query({sql: text, rowsAsArray: true});
      const connectionError = error => fail(error); connection.once('error', connectionError);
      command.on('fields', (columns, index = 0) => {
        if (failed) return;
        try {
          requireThat(index === 0 && ++fieldEvents === 1, 'Multiple resultsets are unsupported.');
          if (columns) {
            requireThat(columns.length <= 1000 && new Set(columns.map(f => f.name)).size === columns.length
              && columns.every(f => !['__proto__', 'constructor', 'prototype'].includes(f.name)), 'Duplicate or unsafe result columns.');
            fields = columns;
          }
        } catch {fail(new DatabaseFailure('EXECUTOR', dispatched, 'UNSUPPORTED_RESULT'));}
      });
      command.on('result', (row, index = 0) => {
        if (failed) return;
        try {
          requireThat(index === 0, 'Multiple resultsets are unsupported.');
          if (!Array.isArray(row)) {requireThat(!fields && !header && integer(row.affectedRows), 'Unexpected affected-row count.'); header = row; return;}
          requireThat(fields && row.length === fields.length && !header, 'Invalid native result.');
          const value = Object.fromEntries(fields.map((f, i) => [f.name, normalized(row[i], f)]));
          bytes += Buffer.byteLength(JSON.stringify(value)); requireThat(rows.length < rowLimit && bytes <= byteLimit, 'Database result exceeds its bound.'); rows.push(value);
        } catch (error) {fail(error instanceof DatabaseFailure ? error : new DatabaseFailure('EXECUTOR', dispatched, 'RESULT_LIMIT_OR_TYPE'));}
      });
      command.once('error', fail);
      command.once('end', () => {
        connection.removeListener('error', connectionError);
        if (!failed) resolve({rows, header, bytes, fields});
      });
    }), signal);
  }
  try {
    const state = (await collect('SELECT VERSION() AS version, DATABASE() AS databaseName, CURRENT_USER() AS principal, CURRENT_ROLE() AS roles, @@GLOBAL.partial_revokes AS partialRevokes')).rows[0];
    requireThat(/^8\.4\.\d+(?:[-.].*)?$/.test(state?.version) && state.databaseName === target.database
      && state.principal.slice(0, state.principal.lastIndexOf('@')) === auth.user && state.roles === 'NONE', 'MySQL 8.4 and a dedicated direct-grant principal are required.');
    const grants = (await collect('SHOW GRANTS', [], {prepared: false})).rows.map(row => Object.values(row)[0]);
    requireThat([0, 1, '0', '1'].includes(state.partialRevokes), 'Unknown privilege matching mode.');
    validateGrants(grants, target.database, state.principal, state.partialRevokes === 1 || state.partialRevokes === '1');
    requireThat((await collect('SELECT COUNT(*) AS count FROM information_schema.APPLICABLE_ROLES')).rows[0].count === '0', 'Database roles are unsupported.');
    requireThat((await collect("SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND (TABLE_TYPE<>'BASE TABLE' OR ENGINE<>'InnoDB')", [target.database])).rows[0].count === '0', 'MySQL execution requires InnoDB base tables.');
    await collect("SET SESSION sql_mode='STRICT_ALL_TABLES,NO_BACKSLASH_ESCAPES,NO_ENGINE_SUBSTITUTION,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO', time_zone='+00:00', innodb_lock_wait_timeout=1", [], {prepared: false});
    await collect(request.capability === 'dbSelect' ? 'START TRANSACTION READ ONLY' : 'START TRANSACTION READ WRITE', [], {prepared: false});
    if (signal.aborted) throw new DatabaseFailure(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
    dispatched = true;
    const result = await collect(request.text, values, {business: true});
    requireThat(request.command === 'SELECT' ? !!result.fields && !result.header : !!result.header && !result.fields, 'Unexpected database result shape.');
    requireThat((await collect('SHOW COUNT(*) WARNINGS', [], {prepared: false})).rows.every(row => Object.values(row).every(value => value === 0 || value === '0')), 'Database warnings make the result indeterminate.');
    let insertId;
    if (request.command === 'INSERT') {
      // mysql2 decodes the OK packet identity as signed; server text preserves the full unsigned range.
      // A fresh connection returns zero here for an explicit identity or an INSERT that generated none.
      const generated = (await collect('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS insertId')).rows[0]?.insertId;
      requireThat(typeof generated === 'string' && /^(?:0|[1-9]\d*)$/.test(generated) && BigInt(generated) <= 2n ** 64n - 1n, 'Unrepresentable generated identity.');
      if (generated !== '0') insertId = generated;
    }
    await collect('COMMIT', [], {prepared: false});
    return {rows: result.rows, rowCount: result.rows.length, rowsAffected: result.header ? [result.header.affectedRows] : [],
      ...(result.header ? {affectedRows: result.header.affectedRows} : {}), ...(insertId ? {insertId} : {}), bytes: result.bytes};
  } catch (error) {
    if (signal.aborted) throw new DatabaseFailure(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED', dispatched);
    if (error instanceof DatabaseFailure) throw error;
    const classification = ['ER_QUERY_TIMEOUT', 'ER_LOCK_WAIT_TIMEOUT', 'PROTOCOL_SEQUENCE_TIMEOUT'].includes(error.code) ? 'TIMEOUT'
      : ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'].includes(error.code) ? 'TRANSPORT'
      : ['ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'HANDSHAKE_SSL_ERROR'].includes(error.code) ? 'UNAVAILABLE' : 'EXECUTOR';
    throw new DatabaseFailure(classification, dispatched, classification === 'EXECUTOR' ? 'SERVER_REJECTED' : classification);
  } finally {
    signal.removeEventListener('abort', close); close();
  }
}
