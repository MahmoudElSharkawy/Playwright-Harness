import sql from 'mssql';
import {requireThat, integer} from '../execution-core/data.mjs';
import {DatabaseFailure, credentials} from './shared.mjs';
import {scopeDatabaseRequest} from './scope.mjs';
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

const destinationSql = 'SELECT DB_NAME() AS databaseName, SCHEMA_NAME(SCHEMA_ID(@scope)) AS schemaName';

const tableSearchSql = `SELECT TOP (9) t.name AS tableName
FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
WHERE s.name=@scope AND t.is_ms_shipped=0 AND CHARINDEX(@tableHint,t.name)>0
ORDER BY t.name`;

// Fixed catalog reads are internal driver requests, never a caller-authored SQL escape hatch.
// SELECT on the exact table establishes catalog visibility without new metadata grants.
const metadataSql = `WITH selected AS (
 SELECT t.* FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
 WHERE s.name=@scope AND t.name=@tableName AND t.is_ms_shipped=0
)
SELECT 'table' AS kind,t.name AS tableName,CAST(NULL AS nvarchar(128)) AS columnName,0 AS ordinal,
 CAST(NULL AS nvarchar(128)) AS typeName,CAST(NULL AS bit) AS nullable,CAST(NULL AS int) AS length,
 CAST(NULL AS int) AS precision,CAST(NULL AS int) AS scale,CAST(NULL AS nvarchar(128)) AS keyName,
 CAST(NULL AS bit) AS primaryKey,CAST(NULL AS nvarchar(128)) AS referencedSchema,
 CAST(NULL AS nvarchar(128)) AS referencedTable,CAST(NULL AS nvarchar(128)) AS referencedColumn,
 CAST(CASE WHEN t.temporal_type=0 AND t.is_memory_optimized=0 AND t.is_filetable=0 AND t.is_external=0
 AND HAS_PERMS_BY_NAME(QUOTENAME(@scope)+'.'+QUOTENAME(t.name),'OBJECT','SELECT')=1 THEN 1 ELSE 0 END AS bit) AS supported
FROM selected t
UNION ALL
SELECT 'column',t.name,c.name,c.column_id,ty.name,c.is_nullable,c.max_length,c.precision,c.scale,
 NULL,NULL,NULL,NULL,NULL,CAST(CASE WHEN c.user_type_id=c.system_type_id AND c.is_computed=0 AND c.is_hidden=0 THEN 1 ELSE 0 END AS bit)
FROM selected t JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id
UNION ALL
SELECT 'key',t.name,c.name,ic.key_ordinal,NULL,NULL,NULL,NULL,NULL,i.name,i.is_primary_key,NULL,NULL,NULL,CAST(1 AS bit)
FROM selected t JOIN sys.indexes i ON i.object_id=t.object_id
 JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
 JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
WHERE i.is_unique=1 AND i.is_disabled=0 AND i.is_hypothetical=0 AND i.has_filter=0 AND i.type IN (1,2) AND ic.key_ordinal>0 AND ic.is_included_column=0
UNION ALL
SELECT 'foreignKey',t.name,c.name,fc.constraint_column_id,NULL,NULL,NULL,NULL,NULL,f.name,NULL,rs.name,rt.name,rc.name,
 CAST(CASE WHEN f.is_disabled=0 AND f.is_not_trusted=0 AND rt.is_ms_shipped=0 THEN 1 ELSE 0 END AS bit)
FROM selected t JOIN sys.foreign_keys f ON f.parent_object_id=t.object_id
 JOIN sys.foreign_key_columns fc ON fc.constraint_object_id=f.object_id
 JOIN sys.columns c ON c.object_id=fc.parent_object_id AND c.column_id=fc.parent_column_id
 LEFT JOIN sys.tables rt ON rt.object_id=fc.referenced_object_id
 LEFT JOIN sys.schemas rs ON rs.schema_id=rt.schema_id
 LEFT JOIN sys.columns rc ON rc.object_id=fc.referenced_object_id AND rc.column_id=fc.referenced_column_id`;

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

export async function executeSqlServer(target, auth, request, options) {
  validateTarget(target);
  if (options.signal.aborted) throw new DatabaseFailure(options.signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
  return executeRequest(target, auth, scopeDatabaseRequest(target, request), options);
}

/** Discovery can select one fixed catalog read. Callers cannot supply its SQL or schema. */
export async function inspectSqlServer(target, auth, input, value, options) {
  requireThat(input === 'tableHint' || input === 'tableName', 'Unsupported database catalog request.');
  const text = input === 'tableHint' ? tableSearchSql : metadataSql;
  return executeRequest(target, auth, {text, parameters: [
    {name: 'scope', type: 'nvarchar', length: 128, value: target.schema},
    {name: input, type: 'nvarchar', length: 128, value}
  ]}, options);
}

/** Own one short-lived pool per operation. */
async function executeRequest(target, auth, request, {signal, timeoutMs, maxRows, maxResponseBytes}) {
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
    options: {encrypt: target.encrypt ?? true, trustServerCertificate: target.trustServerCertificate ?? false, cancelTimeout: 1000, textsize: maxResponseBytes + 2, useUTC: true, enableQuotedIdentifier: true, appName: 'playwright-pom-harness'},
    pool: {min: 0, max: 1, acquireTimeoutMillis: timeoutMs, destroyTimeoutMillis: 1500}});
  pool.on('error', () => {}); // Never log native messages (which may contain SQL/data).
  let active, dispatched = false, ownFailure;
  const cancel = () => active?.cancel(); signal.addEventListener('abort', cancel, {once: true});
  try {
    await pool.connect();
    if (signal.aborted) throw new DatabaseFailure(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
    active = new sql.Request(pool, {requestTimeout: timeoutMs});
    active.input('scope', sql.NVarChar(128), target.schema);
    const destination = await active.query(destinationSql);
    const actual = destination.recordset[0];
    if (actual?.databaseName !== target.database || actual.schemaName !== target.schema) throw new DatabaseFailure('EXECUTOR', false, 'DB_SCOPE_DENIED');
    if (request.localPairs?.length) {
      const pairs = request.localPairs.map(([reference, local], i) => {
        active.input(`reference${i}`, sql.NVarChar(128), reference);
        active.input(`local${i}`, sql.NVarChar(128), local);
        return `(@reference${i},@local${i})`;
      });
      const collision = await active.query(`SELECT COUNT(*) AS collisions FROM (VALUES ${pairs.join(',')}) names(referenceName,localName)
        WHERE referenceName COLLATE CATALOG_DEFAULT=localName COLLATE CATALOG_DEFAULT`);
      if (collision.recordset[0]?.collisions !== 0) throw new DatabaseFailure('EXECUTOR', false, 'DB_SCOPE_AMBIGUOUS');
    }
    const objects = [...(request.tables ?? []).map(name => [name, 0]), ...(request.routines ?? []).map(name => [name, 1])];
    if (objects.length) {
      const refs = objects.map(([name, routine], i) => {
        active.input(`ref${i}`, sql.NVarChar(128), name);
        return `(@ref${i},${routine})`;
      });
      // In particular, reject legacy dbo catalog aliases and unresolved synonyms.
      const result = await active.query(`SELECT COUNT(*) AS supported FROM (VALUES ${refs.join(',')}) refs(name,routine)
        JOIN sys.schemas s ON s.name=@scope JOIN sys.objects o ON o.schema_id=s.schema_id AND o.name=refs.name
        WHERE o.is_ms_shipped=0 AND (refs.routine=0 AND o.type IN ('U','V') OR refs.routine=1 AND o.type IN ('FN','FS','AF','IF','TF','FT'))`);
      if (result.recordset[0]?.supported !== objects.length) throw new DatabaseFailure('EXECUTOR', false, 'DB_OBJECT_UNAVAILABLE');
    }
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
      ownFailure ??= new DatabaseFailure(classification, true, nativeReason(error, classification));
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
    throw new DatabaseFailure(classification, dispatched, nativeReason(error, classification));
  } finally {
    signal.removeEventListener('abort', cancel);
    // Native connection, acquisition and cancellation timeouts bound draining as well.
    await pool.close().catch(() => {throw new DatabaseFailure('EXECUTOR', dispatched, 'CONNECTION_CLEANUP');});
  }
}

function nativeReason(error, classification) {
  if (error.code === 'ELOGIN') return 'DB_AUTHENTICATION_FAILED';
  if ([229, 230, 262, 297, 916].includes(error.number)) return 'DB_PERMISSION_DENIED';
  return error.code === 'EREQUEST' ? 'SERVER_REJECTED' : classification;
}
