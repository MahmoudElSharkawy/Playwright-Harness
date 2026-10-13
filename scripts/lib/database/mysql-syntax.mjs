import {requireThat, keys, id, integer, oneOf} from '../execution-core/data.mjs';

/** MySQL lexical boundaries under NO_BACKSLASH_ESCAPES, not a SQL grammar. */
export function tokens(text) {
  requireThat(typeof text === 'string' && text.length > 0 && text.length <= 65536, 'SQL must be bounded text.');
  requireThat(!/[\x00-\x08\x0e-\x1f\x7f-\x9f\p{Cf}\p{Cs}\u2028\u2029]/u.test(text), 'Unsupported SQL control character.');
  const result = []; let i = 0, depth = 0;
  while (i < text.length) {
    const start = i, ch = text[i];
    if (/[ \t\r\n\v\f]/.test(ch)) {i++; continue;}
    if (ch === '#' || text.startsWith('--', i) && /[ \t\r\n\v\f]/.test(text[i + 2] ?? '')) {
      while (i < text.length && !/[\r\n]/.test(text[i])) i++;
      continue;
    }
    if (text.startsWith('/*', i)) {
      requireThat(!['!', '+'].includes(text[i + 2]), 'Executable and optimizer SQL comments are unsupported.');
      const end = text.indexOf('*/', i + 2), nested = text.indexOf('/*', i + 2);
      requireThat(end >= 0, 'Unclosed SQL comment.');
      requireThat(nested < 0 || nested > end, 'Nested SQL comments are unsupported.');
      i = end + 2; continue;
    }
    requireThat(!text.startsWith('*/', i), 'Unexpected SQL comment delimiter.');
    let kind = 'symbol', value;
    if (["'", '"', '`'].includes(ch)) {
      kind = ch === '`' ? 'identifier' : 'literal'; i++; value = ''; let closed = false;
      while (i < text.length) {
        if (text[i] === ch) {if (text[i + 1] === ch) {value += ch; i += 2;} else {i++; closed = true; break;}}
        else value += text[i++];
      }
      requireThat(closed, 'Unclosed SQL quoted value.');
      if (kind === 'identifier') quoteIdentifier(value);
    } else if (text.startsWith('{{', i)) {
      const match = /^\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/.exec(text.slice(i));
      requireThat(match, 'Invalid identifier slot.'); kind = 'slot'; value = match[1]; i += match[0].length;
    } else if (ch === '?') {
      kind = 'parameter'; value = ch; i++;
    } else {
      const match = /^(?:[A-Za-z_][A-Za-z0-9_$]*|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
      if (match) {value = match[0]; kind = /^[0-9]/.test(value) ? 'number' : 'word'; i += value.length;}
      else {
        requireThat('(),.;+-*/%=<>!|&^~'.includes(ch), 'Unsupported SQL character or variable; bind values with native ? parameters.');
        value = ch; i++;
      }
    }
    if (kind === 'symbol' && value === ')') depth--;
    requireThat(depth >= 0, 'Unbalanced SQL parentheses.');
    result.push({kind, value, upper: kind === 'word' ? value.toUpperCase() : value, depth, start, end:i});
    if (kind === 'symbol' && value === '(') depth++;
  }
  requireThat(depth === 0, 'Unbalanced SQL parentheses.'); return result;
}

const forbidden = new Set('CREATE ALTER DROP TRUNCATE GRANT REVOKE CALL DO EXEC EXECUTE PREPARE DEALLOCATE BEGIN START COMMIT ROLLBACK SAVEPOINT RELEASE SET RESET USE SHOW DESCRIBE EXPLAIN ANALYZE OPTIMIZE REPAIR CHECK FLUSH KILL SHUTDOWN RESTART INSTALL UNINSTALL LOAD HANDLER LOCK UNLOCK XA PURGE CHANGE STOP REPLACE OUTFILE DUMPFILE INTO IGNORE DUPLICATE LOW_PRIORITY HIGH_PRIORITY DELAYED SQL_CALC_FOUND_ROWS'.split(' '));
const forbiddenFunctions = new Set('get_lock release_lock release_all_locks is_free_lock is_used_lock load_file last_insert_id sys_exec sys_eval source_pos_wait master_pos_wait wait_for_executed_gtid_set'.split(' '));
function validateFunctionCalls(list) {
  for (let i = 0; i < list.length; i++) {
    const token = list[i];
    if (!['word', 'identifier'].includes(token.kind) || list[i + 1]?.value !== '(') continue;
    let start = i;
    while (start >= 2 && list[start - 1].value === '.' && ['word', 'identifier', 'slot'].includes(list[start - 2].kind)) start -= 2;
    if (['INTO', 'INSERT'].includes(list[start - 1]?.upper)) continue; // INSERT target column list.
    const name = token.value.toLowerCase();
    requireThat(!forbiddenFunctions.has(name) && !/^(?:mysql_|mysqlx_|group_replication_|version_tokens_|service_|asynchronous_connection_failover_)/.test(name)
      && !list.slice(start, i).some(t => ['word', 'identifier'].includes(t.kind) && ['sys', 'mysql'].includes(t.value.toLowerCase())),
    'Administrative, lock, session-state and SQL-evaluating function calls are unsupported.');
  }
}

/** Classify ordinary single-statement SQL; server privileges remain the boundary. */
export function classifySql(text) {
  const all = tokens(text), list = all.at(-1)?.kind === 'symbol' && all.at(-1).value === ';' ? all.slice(0, -1) : all;
  requireThat(list.length && !list.some(t => t.kind === 'symbol' && t.value === ';'), 'Only one SQL statement is supported.');
  validateFunctionCalls(list);
  const commands = list.filter(t => t.kind === 'word' && ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(t.upper));
  const top = commands.filter(t => t.depth === 0), command = top[0]?.upper;
  requireThat(['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(command) && list[0].kind === 'word' && [command, 'WITH'].includes(list[0].upper), 'Only SELECT/INSERT/UPDATE/DELETE are supported.');
  requireThat(commands.every(t => t.depth === 0 || t.upper === 'SELECT'), 'Data-modifying CTEs, nested writes and locking reads are unsupported.');
  requireThat(top.slice(1).every(t => t.upper === 'SELECT'), 'Multiple SQL operations and locking reads are unsupported.');
  for (let i = 0; i < list.length; i++) {
    const token = list[i];
    if (token.kind !== 'word') continue;
    if (forbidden.has(token.upper)) {
      requireThat(token.upper === 'INTO' && list[i - 1]?.upper === 'INSERT'
        || token.upper === 'SET' && ['UPDATE', 'INSERT'].includes(command) && token.depth === 0
        || ['REPLACE', 'TRUNCATE'].includes(token.upper) && list[i + 1]?.value === '(', 'Unsupported SQL capability or statement.');
    }
    requireThat(!(token.upper === 'FOR' && list[i + 1]?.upper === 'SHARE'), 'Locking reads are unsupported.');
    requireThat(!(token.upper === 'U' && list[i + 1]?.value === '&')
      && !((/^[NXB]$/.test(token.upper) || token.value.startsWith('_')) && list[i + 1]?.kind === 'literal'),
    'Character introducers and Unicode escape syntax are unsupported; bind values.');
  }
  const sets = list.filter(t => t.kind === 'word' && t.upper === 'SET').length;
  requireThat(command === 'UPDATE' ? sets === 1 : command === 'INSERT' ? sets <= 1 : sets === 0, 'Session SET commands are unsupported.');
  for (let i = 1; i < top.length; i++) {
    if (command === 'INSERT' && i === 1) continue;
    const at = list.indexOf(top[i]), preceding = ['ALL', 'DISTINCT'].includes(list[at - 1]?.upper) ? list[at - 2]?.upper : list[at - 1]?.upper;
    requireThat(['UNION', 'INTERSECT', 'EXCEPT'].includes(preceding), 'Multiple SELECT statements are unsupported.');
  }
  return {command, capability:command === 'SELECT' ? 'dbSelect' : 'dbDml', tokens:all};
}

export function quoteIdentifier(value) {
  requireThat(typeof value === 'string' && value.length > 0 && [...value].length <= 64 && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value), 'Invalid MySQL identifier.');
  return `\`${value.replaceAll('`', '``')}\``;
}

export function validateParameters(definition, classified) {
  const parameters = definition.parameters ?? [];
  requireThat(Array.isArray(parameters), 'MySQL parameters must be an ordered array.');
  for (const p of parameters) {
    keys(p, ['name', 'type', 'input', 'length', 'precision', 'scale'], 'MySQL parameter'); id(p.name); id(p.input);
    oneOf(p.type, ['int', 'bigint', 'unsigned bigint', 'boolean', 'double', 'decimal', 'text', 'varchar', 'varbinary', 'date', 'datetime', 'timestamp', 'json']);
    if (['text', 'varchar', 'varbinary', 'json'].includes(p.type)) requireThat(integer(p.length, 1, 1048576), 'Text/binary/JSON bindings need a bounded length.');
    else requireThat(p.length === undefined, 'Unexpected binding length.');
    if (p.type === 'decimal') requireThat(integer(p.precision, 1, 65) && integer(p.scale, 0, Math.min(30, p.precision)), 'Decimal bindings need precision and scale.');
    else requireThat(p.precision === undefined && p.scale === undefined, 'Unexpected numeric metadata.');
  }
  requireThat(classified.tokens.filter(t => t.kind === 'parameter').length === parameters.length, 'Native positional parameters must match the ordered definitions.');
}

export function validateVersionParameter() {requireThat(false, 'MySQL version-based restoration is unsupported.');}
export function validateRestoration() {requireThat(false, 'MySQL version-based restoration is unsupported.');}
