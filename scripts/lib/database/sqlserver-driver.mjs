import sql from 'mssql';
import {requireThat, integer} from '../execution-core/data.mjs';
import {DatabaseFailure, credentials} from './shared.mjs';
export {DatabaseFailure, bounded, credentials} from './shared.mjs';

export function validateTarget(target) {
  requireThat(target?.engine === 'sqlserver' && typeof target.server === 'string' && /^[A-Za-z0-9.-]+$/.test(target.server)
    && typeof target.database === 'string' && target.database.length <= 128 && target.database.trim().length > 0 && !/[\x00-\x1f]/.test(target.database)
    && typeof target.schema === 'string' && target.schema.length <= 128 && target.schema.trim().length > 0 && !/[\x00-\x1f]/.test(target.schema),
  'SQL Server execution requires an explicit server, database and schema.');
  requireThat(!['master', 'model', 'msdb', 'tempdb'].includes(target.database.toLowerCase()) && !['sys', 'information_schema'].includes(target.schema.toLowerCase()), 'System databases/schemas are unsupported targets.');
}
/** Values go exclusively to Request.input; identifiers never go through this path. */
export function parameter(p) {
  const v = p.value;
  requireThat(v !== undefined && !(typeof v === 'number' && !Number.isFinite(v)), 'SQL values cannot be undefined or nonfinite.');
  let type, value = v;
  if (['nvarchar', 'varchar'].includes(p.type)) {
    requireThat(v === null || typeof v === 'string' && v.length <= p.length, 'SQL text value exceeds its bound.');
    requireThat(p.type !== 'varchar' || v === null || /^[\x00-\x7f]*$/.test(v), 'Use nvarchar for Unicode text.');
    type = p.type === 'nvarchar' ? sql.NVarChar(p.length) : sql.VarChar(p.length);
  } else if (p.type === 'varbinary') {
    requireThat(v === null || typeof v === 'string' && /^(?:[a-f0-9]{2})*$/i.test(v) && v.length / 2 <= p.length, 'Binary bindings use bounded hexadecimal text.');
    type = sql.VarBinary(p.length); value = v === null ? null : Buffer.from(v, 'hex');
  } else if (p.type === 'int') {requireThat(v === null || Number.isInteger(v) && v >= -2147483648 && v <= 2147483647, 'SQL int is out of range.'); type = sql.Int;}
  else if (p.type === 'bigint') {
    requireThat(v === null || typeof v === 'string' && /^-?(?:0|[1-9][0-9]*)$/.test(v) && BigInt(v) >= -(2n ** 63n) && BigInt(v) <= 2n ** 63n - 1n, 'SQL bigint uses exact integer text.'); type = sql.BigInt;
  } else if (p.type === 'bit') {requireThat(v === null || typeof v === 'boolean', 'SQL bit needs a boolean.'); type = sql.Bit;}
  else if (p.type === 'float') {requireThat(v === null || typeof v === 'number', 'SQL float needs a number.'); type = sql.Float;}
  else if (p.type === 'decimal') {
    // Tedious uses JS numbers for decimals. Refuse precision it cannot represent reliably.
    requireThat(p.precision <= 15 && (v === null || typeof v === 'number' && Math.abs(v) < 10 ** (p.precision - p.scale) && Math.round(v * 10 ** p.scale) / 10 ** p.scale === v), 'SQL decimal needs a representable value; use explicit SQL conversion for larger exact decimals.'); type = sql.Decimal(p.precision, p.scale);
  } else if (p.type === 'datetime2') {
    requireThat(v === null || typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && new Date(v).toISOString() === v, 'SQL datetime2 uses canonical UTC milliseconds.'); type = sql.DateTime2(3); value = v === null ? null : new Date(v);
  } else if (p.type === 'uniqueidentifier') {requireThat(v === null || typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v), 'Invalid SQL UUID.'); type = sql.UniqueIdentifier;}
  else throw new DatabaseFailure('EXECUTOR', false, 'UNSUPPORTED_TYPE');
  return {type, value};
}

// Effective privilege checks supplement a dedicated principal. Database grants remain
// the security boundary, including for views/triggers and ownership chains managed by its owner.
const scopeQuery = `
SELECT DB_NAME() AS databaseName, SCHEMA_NAME() AS defaultSchema;
SELECT permission_name FROM sys.fn_my_permissions(NULL, 'SERVER')
 WHERE permission_name NOT IN ('CONNECT SQL', 'VIEW ANY DATABASE');
SELECT permission_name FROM sys.fn_my_permissions(NULL, 'DATABASE')
 WHERE permission_name NOT IN ('CONNECT', 'VIEW ANY COLUMN ENCRYPTION KEY DEFINITION', 'VIEW ANY COLUMN MASTER KEY DEFINITION');
SELECT s.name FROM sys.schemas s CROSS APPLY sys.fn_my_permissions(QUOTENAME(s.name), 'SCHEMA') p
 WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA') AND (s.name <> @scope OR p.permission_name NOT IN ('SELECT','INSERT','UPDATE','DELETE'));
SELECT o.name FROM sys.objects o JOIN sys.schemas s ON o.schema_id=s.schema_id
 CROSS APPLY sys.fn_my_permissions(QUOTENAME(s.name)+'.'+QUOTENAME(o.name), 'OBJECT') p
 WHERE o.is_ms_shipped=0 AND s.name <> @scope AND p.permission_name IN ('SELECT','INSERT','UPDATE','DELETE','EXECUTE','CONTROL','ALTER','TAKE OWNERSHIP');`;

// Supported restoration strategy: a direct table's unique single-column identity
// plus its server-maintained rowversion. Labels or parameter names cannot prove this.
const restorationQuery = `SELECT CASE WHEN EXISTS (
 SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
 JOIN sys.columns identityColumn ON identityColumn.object_id=t.object_id AND identityColumn.name=@identityColumn
 JOIN sys.columns versionColumn ON versionColumn.object_id=t.object_id AND versionColumn.name=@versionColumn AND versionColumn.system_type_id=189
 WHERE s.name=@scope AND t.name=@tableName AND EXISTS (
  SELECT 1 FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
  WHERE i.object_id=t.object_id AND i.is_unique=1 AND i.is_disabled=0 AND i.has_filter=0 AND i.is_hypothetical=0
   AND ic.column_id=identityColumn.column_id AND ic.key_ordinal=1
   AND NOT EXISTS (SELECT 1 FROM sys.index_columns otherKey WHERE otherKey.object_id=i.object_id AND otherKey.index_id=i.index_id AND otherKey.key_ordinal>1)
 )) THEN 1 ELSE 0 END AS supported`;

function normalized(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {requireThat(Number.isFinite(value), 'Nonfinite database result.'); return value;}
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) {
    const iso = value.toISOString(), remainder = value.nanosecondsDelta ?? 0;
    // Tedious retains sub-millisecond SQL time in a non-enumerable property.
    requireThat(Number.isFinite(remainder) && remainder >= 0 && remainder < 0.001, 'Invalid SQL temporal precision.');
    return remainder === 0 ? iso : iso.replace(/Z$/, `${String(Math.round(remainder * 1e7)).padStart(4, '0')}Z`);
  }
  if (Buffer.isBuffer(value)) return value.toString('hex');
  throw new DatabaseFailure('EXECUTOR', true, 'UNSUPPORTED_RESULT');
}

/** Own one short-lived pool per operation; no global connection or host dependency. */
export async function executeSqlServer(target, auth, request, {signal, timeoutMs, maxRows, maxResponseBytes}) {
  validateTarget(target); auth = credentials(auth);
  const bindings = request.parameters.map(p => ({name: p.name, ...parameter(p)}));
  if (request.guard) {
    requireThat((request.guard.schema ?? target.schema) === target.schema, 'Restoration target is outside the configured schema.');
    const version = request.parameters.find(p => p.name === request.guard.versionParameter);
    requireThat(version?.type === 'varbinary' && version.length === 8 && typeof version.value === 'string' && /^[a-f0-9]{16}$/i.test(version.value), 'Restoration requires a concrete rowversion.');
  }
  if (signal.aborted) throw new DatabaseFailure(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
  const pool = new sql.ConnectionPool({server: target.server, port: target.port ?? 1433, database: target.database, ...auth,
    connectionTimeout: Math.min(timeoutMs, 5000), requestTimeout: timeoutMs,
    options: {encrypt: target.encrypt ?? true, trustServerCertificate: target.trustServerCertificate ?? false, cancelTimeout: 1000, textsize: maxResponseBytes + 2, useUTC: true, appName: 'playwright-pom-harness'},
    pool: {min: 0, max: 1, acquireTimeoutMillis: timeoutMs, destroyTimeoutMillis: 1500}});
  pool.on('error', () => {}); // Never log native messages (which may contain SQL/data).
  let active, dispatched = false, ownFailure;
  const cancel = () => active?.cancel(); signal.addEventListener('abort', cancel, {once: true});
  try {
    await pool.connect();
    if (signal.aborted) throw new DatabaseFailure(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
    active = new sql.Request(pool, {requestTimeout: timeoutMs}); active.input('scope', sql.NVarChar(128), target.schema);
    const scope = await active.query(scopeQuery);
    requireThat(scope.recordsets[0]?.[0]?.databaseName === target.database && scope.recordsets[0]?.[0]?.defaultSchema === target.schema
      && scope.recordsets.slice(1).every(rows => rows.length === 0), 'Database principal must be dedicated to the configured schema without broad privileges.');
    if (request.guard) {
      if (signal.aborted) throw new DatabaseFailure(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
      active = new sql.Request(pool, {requestTimeout: timeoutMs});
      for (const [name, value] of Object.entries({scope: target.schema, tableName: request.guard.table, identityColumn: request.guard.identityColumn, versionColumn: request.guard.versionColumn})) active.input(name, sql.NVarChar(128), value);
      const verified = await active.query(restorationQuery);
      requireThat(verified.recordset[0]?.supported === 1, 'Restoration requires a unique identity and actual server-maintained rowversion column.');
    }
    if (signal.aborted) throw new DatabaseFailure(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
    active = new sql.Request(pool, {requestTimeout: timeoutMs});
    for (const binding of bindings) active.input(binding.name, binding.type, binding.value);
    active.stream = true;
    const recordsets = []; let rows = [], bytes = 0, count = 0;
    const stop = reason => {ownFailure ??= new DatabaseFailure('EXECUTOR', true, reason); active.cancel();};
    active.on('recordset', columns => {
      if (Object.values(columns).some(c => ['Decimal', 'Numeric', 'Money', 'SmallMoney'].includes(c.type?.name) && (c.precision ?? 19) > 15)) stop('UNREPRESENTABLE_DECIMAL');
      if (Object.values(columns).some(c => ['Xml','Variant','UDT','Geography','Geometry'].includes(c.type?.name))) stop('UNSUPPORTED_RESULT');
      rows = []; recordsets.push(rows); if (recordsets.length > 1) stop('MULTIPLE_RESULTSETS');
    });
    active.on('row', row => {
      if (ownFailure) return;
      try {
        const result = Object.fromEntries(Object.entries(row).map(([name, value]) => {
          requireThat(!['__proto__','prototype','constructor'].includes(name), 'Unsafe result field.');
          // TEXTSIZE bounds native LOB decoding. A value at its ceiling is never
          // accepted as complete, including UTF-16 truncation on a code-unit boundary.
          requireThat(!(typeof value === 'string' && Buffer.byteLength(value, 'utf16le') >= maxResponseBytes || Buffer.isBuffer(value) && value.length >= maxResponseBytes), 'Database cell reached its completeness limit.');
          return [name, normalized(value)];
        }));
        bytes += Buffer.byteLength(JSON.stringify(result)); count++;
        if (count > maxRows || bytes > maxResponseBytes) stop('RESULT_LIMIT'); else rows.push(result);
      } catch {stop('UNSUPPORTED_RESULT');}
    });
    // In stream mode node-mssql emits server errors while its query promise can resolve.
    // Capture the event as a failure; never treat a drained stream as proof of success.
    active.on('error', error => {
      const classification = error.code === 'ETIMEOUT' ? 'TIMEOUT' : ['ESOCKET','ECONNCLOSED','ECONNRESET'].includes(error.code) ? 'TRANSPORT' : error.code === 'ECANCEL' && signal.aborted ? (signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED') : 'EXECUTOR';
      ownFailure ??= new DatabaseFailure(classification, true, error.code === 'EREQUEST' ? 'SERVER_REJECTED' : classification);
    });
    dispatched = true;
    const completed = await active.query(request.text);
    if (ownFailure) throw ownFailure;
    if (signal.aborted) throw new DatabaseFailure(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED', true);
    const counts = completed.rowsAffected;
    requireThat(Array.isArray(counts) && counts.every(n => integer(n)), 'Invalid database affected counts.');
    return {rows: recordsets[0] ?? [], rowCount: count, rowsAffected: counts, ...(counts.length === 1 ? {affectedRows: counts[0]} : {}), ...(request.guard ? {restorationGuardVerified: true} : {}), bytes};
  } catch (error) {
    if (ownFailure) throw ownFailure;
    if (signal.aborted) throw new DatabaseFailure(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED', dispatched);
    if (error instanceof DatabaseFailure) throw error;
    const classification = error.code === 'ETIMEOUT' ? 'TIMEOUT' : ['ESOCKET','ECONNCLOSED','ECONNRESET','ENOTOPEN'].includes(error.code) ? 'TRANSPORT' : error.code === 'ELOGIN' ? 'UNAVAILABLE' : 'EXECUTOR';
    throw new DatabaseFailure(classification, dispatched, error.code === 'EREQUEST' ? 'SERVER_REJECTED' : classification);
  } finally {
    signal.removeEventListener('abort', cancel);
    // Native connection, acquisition and cancellation timeouts bound draining as well.
    await pool.close().catch(() => {throw new DatabaseFailure('EXECUTOR', dispatched, 'CONNECTION_CLEANUP');});
  }
}
