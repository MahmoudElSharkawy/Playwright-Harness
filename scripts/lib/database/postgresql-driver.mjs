import pg from 'pg';
import {requireThat, integer} from '../execution-core/data.mjs';
import {DatabaseFailure, bounded, credentials} from './shared.mjs';
import {quoteIdentifier} from './postgresql-syntax.mjs';

export function validateTarget(target) {
  requireThat(target?.engine === 'postgresql' && typeof target.server === 'string' && /^[A-Za-z0-9.-]+$/.test(target.server), 'PostgreSQL needs an explicit server.');
  for (const name of ['database', 'schema']) {quoteIdentifier(target[name]); requireThat(target[name].trim().length > 0, 'PostgreSQL needs explicit database/schema scope.');}
  requireThat(!['postgres', 'template0', 'template1'].includes(target.database) && target.schema !== 'information_schema' && !target.schema.startsWith('pg_'), 'System databases/schemas are unsupported targets.');
}

/** JSON-compatible input values become pg values, never SQL string interpolation. */
export function parameter(p) {
  const v = p.value; requireThat(v !== undefined, 'Database input is missing.');
  if (v === null) return null;
  if (['text', 'varchar'].includes(p.type)) {requireThat(typeof v === 'string' && !v.includes('\0') && Buffer.byteLength(v) <= p.length, 'Text binding exceeds its byte bound.'); return v;}
  if (p.type === 'bytea') {requireThat(typeof v === 'string' && /^(?:[a-f0-9]{2})*$/i.test(v) && v.length / 2 <= p.length, 'Binary bindings use bounded hexadecimal text.'); return Buffer.from(v, 'hex');}
  if (p.type === 'integer') {requireThat(Number.isInteger(v) && v >= -2147483648 && v <= 2147483647, 'PostgreSQL integer is out of range.'); return v;}
  if (p.type === 'bigint' || p.type === 'xid') {
    requireThat(typeof v === 'string' && /^-?(?:0|[1-9][0-9]*)$/.test(v), 'Integer identity needs exact text.');
    requireThat(p.type === 'bigint' ? BigInt(v) >= -(2n ** 63n) && BigInt(v) < 2n ** 63n : BigInt(v) >= 0n && BigInt(v) < 2n ** 32n, 'Integer identity is out of range.'); return v;
  }
  if (p.type === 'boolean') {requireThat(typeof v === 'boolean', 'Boolean binding needs a boolean.'); return v;}
  if (p.type === 'double precision') {requireThat(typeof v === 'number' && Number.isFinite(v), 'Floating binding needs a finite number.'); return v;}
  if (p.type === 'numeric') {
    requireThat(typeof v === 'string' && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(v), 'Numeric binding needs exact decimal text.');
    const [whole, fraction = ''] = v.replace(/^-/, '').split('.'); requireThat(whole.replace(/^0$/, '').length <= p.precision - p.scale && fraction.length <= p.scale, 'Numeric binding exceeds its declared precision.'); return v;
  }
  if (p.type === 'uuid') {requireThat(typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v), 'Invalid PostgreSQL UUID.'); return v;}
  if (['date', 'timestamp', 'timestamptz'].includes(p.type)) {
    const pattern = p.type === 'date' ? /^\d{4}-\d{2}-\d{2}$/ : p.type === 'timestamp' ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
    requireThat(typeof v === 'string' && pattern.test(v), 'Temporal binding needs ISO text with at most microseconds.'); return v; // The database validates calendar syntax without JS Date precision loss.
  }
  if (p.type === 'jsonb') {
    requireThat(v && typeof v === 'object', 'JSON bindings need a structured value.'); const encoded = JSON.stringify(v);
    requireThat(Buffer.byteLength(encoded) <= p.length, 'JSON binding exceeds its byte bound.'); return encoded;
  }
  throw new DatabaseFailure('EXECUTOR', false, 'UNSUPPORTED_TYPE');
}

// Ignore global pg type-parser overrides. Preserve exact numerics, JSON and temporal
// text; decode only supported native scalars. No native Date or bigint escapes.
export function normalized(value, oid) {
  if (value === null) return null;
  if (oid === 16) {requireThat(['t', 'f'].includes(value), 'Invalid boolean result.'); return value === 't';}
  if ([21, 23, 26, 700, 701].includes(oid)) {
    const number = Number(value); requireThat(Number.isFinite(number) && (![21, 23, 26].includes(oid) || Number.isSafeInteger(number)), 'Unrepresentable numeric result.'); return number;
  }
  if ([20, 28, 1700].includes(oid)) {requireThat(/^-?[0-9]+(?:\.[0-9]+)?$/.test(value), 'Nonfinite numeric result.'); return value;}
  if ([18, 19, 25, 1042, 1043, 2950, 114, 3802].includes(oid)) return value;
  if (oid === 17) {requireThat(/^\\x(?:[a-f0-9]{2})*$/i.test(value), 'Invalid binary result.'); return value.slice(2);}
  if ([1082, 1114, 1184, 1083].includes(oid)) {
    requireThat(!/infinity|BC/i.test(value), 'Unsupported temporal result.'); return value.replace(' ', 'T').replace(/\+00(?::00)?$/, 'Z');
  }
  throw new DatabaseFailure('EXECUTOR', true, 'UNSUPPORTED_RESULT');
}

const scopeQuery = `SELECT current_database() AS database_name, current_user AS login,
 NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls) AS ordinary_role,
 NOT has_database_privilege(current_user,current_database(),'CREATE,TEMPORARY') AS ordinary_database,
 EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname=$1 AND has_schema_privilege(current_user,n.oid,'USAGE')) AS target_usage,
 NOT EXISTS (SELECT 1 FROM pg_roles other WHERE other.rolname<>current_user AND pg_has_role(current_user,other.oid,'MEMBER')) AS no_memberships,
 NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE has_schema_privilege(current_user,n.oid,'CREATE')) AS no_schema_create,
 NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f') AND
   (pg_has_role(current_user,c.relowner,'USAGE') OR has_table_privilege(current_user,c.oid,'TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(current_user,c.oid,'REFERENCES')
    OR (n.nspname<>$1 AND (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE'))))) AS scoped_tables,
 NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname<>$1
  AND has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE')) AS scoped_sequences,
 NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_'
  AND n.nspname<>'information_schema' AND n.nspname<>$1 AND has_function_privilege(current_user,p.oid,'EXECUTE')) AS scoped_functions
 FROM pg_roles r WHERE r.rolname=current_user`;

const restorationQuery = `SELECT EXISTS (SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
 JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname=$3 AND a.attnum>0 AND NOT a.attisdropped
 JOIN pg_index i ON i.indrelid=t.oid AND i.indisunique AND i.indisvalid AND i.indimmediate
  AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum
 WHERE n.nspname=$1 AND t.relname=$2 AND t.relkind='r') AS supported`;

/** Own one native connection/transaction per operation, with server-enforced read-only reads. */
export async function executePostgresql(target, auth, request, {signal, timeoutMs, maxRows, maxResponseBytes}) {
  validateTarget(target); auth = credentials(auth); const values = request.parameters.map(parameter);
  if (request.guard) {
    requireThat((request.guard.schema ?? target.schema) === target.schema && request.guard.versionColumn === 'xmin', 'Restoration is outside the configured table scope.');
    const version = request.parameters.find(p => p.name === request.guard.versionParameter);
    requireThat(version?.type === 'xid' && version.value !== null, 'Restoration requires a concrete xmin.');
  }
  if (signal.aborted) throw new DatabaseFailure(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
  const client = new pg.Client({host: target.server, port: target.port ?? 5432, database: target.database, ...auth,
    ssl: target.encrypt === false ? false : {rejectUnauthorized: !target.trustServerCertificate}, sslnegotiation: 'postgres', replication: 'false', client_encoding: 'UTF8',
    connectionTimeoutMillis: Math.min(timeoutMs, 5000), statement_timeout: timeoutMs, lock_timeout: timeoutMs, idle_in_transaction_session_timeout: timeoutMs,
    application_name: 'playwright-pom-harness', pipeline: false, binary: false,
    options: '-c search_path=pg_catalog -c timezone=UTC -c datestyle=ISO,YMD -c standard_conforming_strings=on'});
  client.on('error', () => {}); // Native diagnostics may contain SQL or confidential data.
  let dispatched = false, closing, ownFailure;
  const close = () => closing ??= client.end();
  const cancel = () => {void close().catch(() => {});}; signal.addEventListener('abort', cancel, {once: true});
  const query = (text, args = []) => bounded(() => client.query({text, values: args, queryMode: 'extended', types: {getTypeParser: oid => value => normalized(value, oid)}}), signal);
  try {
    await bounded(() => client.connect(), signal);
    const scoped = (await query(scopeQuery, [target.schema])).rows[0];
    requireThat(scoped?.database_name === target.database && scoped.login === auth.user
      && ['ordinary_role','ordinary_database','target_usage','no_memberships','no_schema_create','scoped_tables','scoped_sequences','scoped_functions'].every(name => scoped[name] === true),
    'Database principal must be dedicated to the configured schema without broad privileges.');
    await query("SELECT set_config('search_path',$1,false)", [`${quoteIdentifier(target.schema)},pg_catalog`]);
    if (request.guard) requireThat((await query(restorationQuery, [target.schema, request.guard.table, request.guard.identityColumn])).rows[0]?.supported === true, 'Restoration requires a unique identity on an ordinary table and server-owned xmin.');
    await query(request.capability === 'dbSelect' ? 'BEGIN READ ONLY' : 'BEGIN READ WRITE');
    if (signal.aborted) throw new DatabaseFailure(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
    const rows = []; let bytes = 0;
    const command = new pg.Query({text: request.text, values, queryMode: 'extended', rowMode: 'array', types: {getTypeParser: () => value => value}});
    const completed = new Promise((resolveResult, reject) => {
      command.on('row', (row, result) => {
        if (ownFailure) return;
        try {
          requireThat(new Set(result.fields.map(field => field.name)).size === result.fields.length, 'Duplicate result field.');
          const normalizedRow = Object.fromEntries(result.fields.map((field, i) => {
            requireThat(!['__proto__','constructor','prototype'].includes(field.name), 'Unsafe result field.'); return [field.name, normalized(row[i], field.dataTypeID)];
          }));
          bytes += Buffer.byteLength(JSON.stringify(normalizedRow)); requireThat(rows.length < maxRows && bytes <= maxResponseBytes, 'Database result exceeds its bound.'); rows.push(normalizedRow);
        } catch (error) {ownFailure = error instanceof DatabaseFailure ? error : new DatabaseFailure('EXECUTOR', true, 'RESULT_LIMIT_OR_TYPE'); cancel();}
      });
      command.once('error', reject); command.once('end', resolveResult);
      dispatched = true; client.query(command);
    });
    const result = await completed;
    if (ownFailure) throw ownFailure;
    if (signal.aborted) throw new DatabaseFailure(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED', true);
    requireThat(!Array.isArray(result) && result.command === request.command && integer(result.rowCount), 'Unexpected database completion or affected count.');
    await query('COMMIT');
    return {rows, rowCount: rows.length, rowsAffected: [result.rowCount], affectedRows: result.rowCount, bytes, ...(request.guard ? {restorationGuardVerified: true} : {})};
  } catch (error) {
    if (ownFailure) throw ownFailure;
    if (signal.aborted) throw new DatabaseFailure(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED', dispatched);
    if (error instanceof DatabaseFailure) throw error;
    const code = error.code, classification = code === '57014' || code === '55P03' ? 'TIMEOUT' : ['ECONNRESET','ECONNREFUSED','EPIPE','ENOTFOUND','57P01','08006'].includes(code) || /connection.*(?:terminated|closed)/i.test(error.message ?? '') ? 'TRANSPORT' : ['28P01','28000','3D000'].includes(code) ? 'UNAVAILABLE' : 'EXECUTOR';
    throw new DatabaseFailure(classification, dispatched, typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && classification === 'EXECUTOR' ? 'SERVER_REJECTED' : classification);
  } finally {
    signal.removeEventListener('abort', cancel); let timer;
    try {await Promise.race([close(), new Promise((_, reject) => {timer = setTimeout(() => reject(new DatabaseFailure('EXECUTOR', dispatched, 'CONNECTION_CLEANUP')), 1500);})]);}
    finally {clearTimeout(timer);}
  }
}
