import {requireThat, keys, id, integer, oneOf} from '../execution-core/data.mjs';

/** PostgreSQL lexical boundaries for classification/identifier slots, not a grammar. */
export function tokens(text) {
  requireThat(typeof text === 'string' && text.length > 0 && text.length <= 65536, 'SQL must be bounded text.');
  const result = []; let i = 0, depth = 0;
  while (i < text.length) {
    const start = i, ch = text[i];
    if (/\s/.test(ch)) {i++; continue;}
    if (text.startsWith('--', i)) {i = text.indexOf('\n', i); if (i < 0) break; continue;}
    if (text.startsWith('/*', i)) {
      let nesting = 1; i += 2;
      while (i < text.length && nesting) {if (text.startsWith('/*', i)) {nesting++; i += 2;} else if (text.startsWith('*/', i)) {nesting--; i += 2;} else i++;}
      requireThat(nesting === 0, 'Unclosed SQL comment.'); continue;
    }
    let kind = 'symbol', value;
    const dollar = ch === '$' && /^(?:\$\$|\$[A-Za-z_][A-Za-z0-9_]*\$)/.exec(text.slice(i));
    const escaped = /[eE]/.test(ch) && text[i + 1] === "'";
    if (dollar) {
      const end = text.indexOf(dollar[0], i + dollar[0].length); requireThat(end >= 0, 'Unclosed dollar-quoted value.');
      kind = 'literal'; value = text.slice(i + dollar[0].length, end); i = end + dollar[0].length;
    } else if (ch === "'" || ch === '"' || escaped) {
      const end = escaped ? "'" : ch; kind = end === "'" ? 'literal' : 'identifier'; i += escaped ? 2 : 1; value = ''; let closed = false;
      while (i < text.length) {
        if (escaped && text[i] === '\\') {value += text.slice(i, i + 2); i += 2;}
        else if (text[i] === end) {if (text[i + 1] === end) {value += end; i += 2;} else {i++; closed = true; break;}}
        else value += text[i++];
      }
      requireThat(closed, 'Unclosed SQL quoted value.');
    } else if (text.startsWith('{{', i)) {
      const match = /^\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/.exec(text.slice(i)); requireThat(match, 'Invalid identifier slot.'); kind = 'slot'; value = match[1]; i += match[0].length;
    } else {
      const match = /^(?:\$[0-9]+|[A-Za-z_][A-Za-z0-9_$]*|\d+(?:\.\d+)?)/.exec(text.slice(i));
      if (match) {value = match[0]; kind = value.startsWith('$') ? 'parameter' : /^[0-9]/.test(value) ? 'number' : 'word'; i += value.length;}
      else {value = ch; i++;}
    }
    if (kind === 'symbol' && value === ')') depth--;
    requireThat(depth >= 0, 'Unbalanced SQL parentheses.'); result.push({kind, value, upper: kind === 'word' ? value.toUpperCase() : value, depth, start, end: i});
    if (kind === 'symbol' && value === '(') depth++;
  }
  requireThat(depth === 0, 'Unbalanced SQL parentheses.'); return result;
}

const forbidden = new Set('CREATE ALTER DROP TRUNCATE GRANT REVOKE COPY CALL DO EXECUTE PREPARE DEALLOCATE BEGIN COMMIT ROLLBACK SAVEPOINT RELEASE SET RESET DISCARD LISTEN NOTIFY UNLISTEN VACUUM ANALYZE REINDEX CLUSTER REFRESH CHECKPOINT LOAD MERGE LOCK DECLARE FETCH CLOSE MOVE SECURITY INTO'.split(' '));
// Read-only transactions do not prevent signaling/notification or SQL-evaluating
// builtins. Reserve their call surface without parsing a general SQL grammar.
const supportedPgFunctions = new Set('pg_typeof pg_column_size pg_backend_pid pg_sleep pg_sleep_for pg_sleep_until'.split(' '));
function validateFunctionCalls(list) {
  for (let i = 0; i < list.length; i++) {
    const token = list[i];
    if (!['word','identifier'].includes(token.kind) || list[i + 1]?.value !== '(') continue;
    let start = i;
    while (start >= 2 && list[start - 1].value === '.' && ['word','identifier','slot'].includes(list[start - 2].kind)) start -= 2;
    if (list[start - 1]?.upper === 'INTO') continue; // INSERT target column list, not a function call.
    const name = token.value.toLowerCase();
    requireThat(!(name.startsWith('pg_') && !supportedPgFunctions.has(name)) && !name.startsWith('lo_')
      && !name.startsWith('query_to_xml') && !['set_config','loread','lowrite','ts_stat','ts_rewrite'].includes(name),
    'Administrative, large-object and SQL-evaluating function calls are unsupported.');
  }
}
export function classifySql(text) {
  const all = tokens(text), list = all.at(-1)?.kind === 'symbol' && all.at(-1).value === ';' ? all.slice(0, -1) : all;
  requireThat(list.length && !list.some(t => t.kind === 'symbol' && t.value === ';'), 'Only one SQL statement is supported.');
  validateFunctionCalls(list);
  const commands = list.filter(t => t.kind === 'word' && ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(t.upper));
  const top = commands.filter(t => t.depth === 0), command = top[0]?.upper;
  requireThat(['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(command) && list[0].kind === 'word' && [command, 'WITH'].includes(list[0].upper), 'Only SELECT/INSERT/UPDATE/DELETE are supported.');
  requireThat(commands.every(t => t.depth === 0 || t.upper === 'SELECT'), 'Data-modifying CTEs and nested writes are unsupported.');
  requireThat(top.slice(1).every(t => t.upper === 'SELECT'), 'Multiple SQL operations are unsupported.');
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.kind === 'word' && forbidden.has(t.upper)) requireThat(t.upper === 'INTO' && list[i - 1]?.upper === 'INSERT' || t.upper === 'SET' && command === 'UPDATE' && t.depth === 0, 'Unsupported SQL capability or statement.');
    requireThat(!(t.kind === 'word' && t.upper === 'U' && list[i + 1]?.value === '&'), 'Unicode escape syntax is unsupported; bind Unicode values.');
  }
  requireThat(list.filter(t => t.kind === 'word' && t.upper === 'SET').length === (command === 'UPDATE' ? 1 : 0), 'Session commands are unsupported.');
  for (let i = 1; i < top.length; i++) {
    if (command === 'INSERT' && i === 1) continue;
    const at = list.indexOf(top[i]), preceding = list[at - 1]?.upper === 'ALL' ? list[at - 2]?.upper : list[at - 1]?.upper;
    requireThat(['UNION', 'INTERSECT', 'EXCEPT'].includes(preceding), 'Multiple SELECT statements are unsupported.');
  }
  return {command, capability: command === 'SELECT' ? 'dbSelect' : 'dbDml', tokens: all};
}
export function quoteIdentifier(value) {
  requireThat(typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 63 && !/[\x00-\x1f]/.test(value), 'Invalid PostgreSQL identifier.');
  return `"${value.replaceAll('"', '""')}"`;
}
export function validateParameters(definition, classified) {
  const parameters = definition.parameters ?? [];
  for (const p of parameters) {
    keys(p, ['name', 'type', 'input', 'length', 'precision', 'scale'], 'PostgreSQL parameter'); id(p.name); id(p.input);
    oneOf(p.type, ['text', 'varchar', 'bytea', 'integer', 'bigint', 'boolean', 'double precision', 'numeric', 'timestamp', 'timestamptz', 'date', 'uuid', 'jsonb', 'xid']);
    if (['text', 'varchar', 'bytea', 'jsonb'].includes(p.type)) requireThat(integer(p.length, 1, 1048576), 'Text/binary/JSON bindings need a bounded length.');
    else requireThat(p.length === undefined, 'Unexpected binding length.');
    if (p.type === 'numeric') requireThat(integer(p.precision, 1, 1000) && integer(p.scale, 0, p.precision), 'Numeric bindings need precision and scale.');
    else requireThat(p.precision === undefined && p.scale === undefined, 'Unexpected numeric metadata.');
  }
  const references = classified.tokens.filter(t => t.kind === 'parameter').map(t => Number(t.value.slice(1)));
  requireThat(references.every(n => integer(n, 1, parameters.length)) && parameters.every((_, i) => references.includes(i + 1)), 'Native positional parameters must match the ordered definitions.');
}
export function validateVersionParameter(version) {requireThat(version.type === 'xid', 'PostgreSQL restoration binds a server xmin transaction identity.');}

/** Optional direct-table restoration using a unique identity and server-owned xmin. */
export function validateRestoration(text, guard, parameters) {
  const {command, tokens: all} = classifySql(text), list = all.filter(t => !(t.kind === 'symbol' && t.value === ';'));
  const where = list.findLastIndex(t => t.kind === 'word' && t.depth === 0 && t.upper === 'WHERE'), predicate = list.slice(where + 1);
  const identity = `$${parameters.findIndex(p => p.name === guard.identityParameter) + 1}`, version = `$${parameters.findIndex(p => p.name === guard.versionParameter) + 1}`;
  const name = token => token && ['word', 'identifier', 'slot'].includes(token.kind), actual = token => token.kind === 'word' ? token.value.toLowerCase() : token.value;
  requireThat(command === 'UPDATE' && where >= 0 && predicate.length === 7 && predicate.every(t => t.depth === 0)
    && name(predicate[0]) && predicate[1].value === '=' && predicate[2].value === identity && predicate[3].upper === 'AND'
    && name(predicate[4]) && actual(predicate[4]) === 'xmin' && predicate[5].value === '=' && predicate[6].value === version,
  'Restoration needs terminal identity AND xmin equality predicates.');
  requireThat(actual(predicate[0]) !== 'xmin', 'Restoration identity must differ from its version.');
  let schema, table;
  if (name(list[1]) && list[2]?.value === '.' && name(list[3]) && list[4]?.upper === 'SET') {schema = actual(list[1]); table = actual(list[3]);}
  else if (name(list[1]) && list[2]?.upper === 'SET') table = actual(list[1]);
  requireThat(table && !list.some(t => t.kind === 'word' && t.depth === 0 && ['FROM', 'JOIN'].includes(t.upper)), 'Restoration needs a direct table UPDATE without aliases or joins.');
  return {...(schema ? {schema} : {}), table, identityColumn: actual(predicate[0]), versionColumn: 'xmin'};
}
