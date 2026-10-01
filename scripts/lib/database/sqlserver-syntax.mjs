import {requireThat, keys, id, integer, oneOf} from '../execution-core/data.mjs';

export function validateParameters(definition, classified) {
  for (const p of definition.parameters ?? []) {
    keys(p, ['name', 'type', 'input', 'length', 'precision', 'scale'], 'SQL parameter');
    requireThat(typeof p.name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(p.name), 'Invalid SQL parameter name.'); id(p.input);
    oneOf(p.type, ['nvarchar', 'varchar', 'int', 'bigint', 'bit', 'float', 'decimal', 'datetime2', 'uniqueidentifier', 'varbinary']);
    if (['nvarchar', 'varchar', 'varbinary'].includes(p.type)) requireThat(integer(p.length, 1, p.type === 'nvarchar' ? 4000 : 8000), 'Text/binary bindings need an explicit bounded length.');
    else requireThat(p.length === undefined, 'Unexpected binding length.');
    if (p.type === 'decimal') requireThat(integer(p.precision, 1, 38) && integer(p.scale, 0, p.precision), 'Decimal needs precision and scale.');
    else requireThat(p.precision === undefined && p.scale === undefined, 'Unexpected decimal metadata.');
  }
  for (const token of classified.tokens.filter(t => t.kind === 'parameter' && !t.value.startsWith('@@'))) requireThat(definition.parameters?.some(p => `@${p.name}`.toLowerCase() === token.value.toLowerCase()), 'SQL value parameter is not declared.');
}
export function validateVersionParameter(version) {
  requireThat(version.type === 'varbinary' && version.length === 8, 'Restoration binds an eight-byte SQL Server rowversion.');
}

/** A lexer for classification and binding locations, not a SQL grammar or compiler. */
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
    if (ch === "'" || ch === '[' || ch === '"') {
      const end = ch === '[' ? ']' : ch; kind = ch === "'" ? 'literal' : 'identifier'; i++; let closed = false; value = '';
      while (i < text.length) {if (text[i] === end) {if (text[i + 1] === end) {value += end; i += 2;} else {i++; closed = true; break;}} else value += text[i++];}
      requireThat(closed, 'Unclosed SQL quoted value.');
    } else if (text.startsWith('{{', i)) {
      const match = /^\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/.exec(text.slice(i)); requireThat(match, 'Invalid identifier slot.'); kind = 'slot'; value = match[1]; i += match[0].length;
    } else {
      const match = /^(?:@@?[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_#][A-Za-z0-9_$#]*|\d+(?:\.\d+)?)/.exec(text.slice(i));
      if (match) {value = match[0]; kind = value.startsWith('@') ? 'parameter' : /^[0-9]/.test(value) ? 'number' : 'word'; i += value.length;}
      else {value = ch; i++;}
    }
    if (kind === 'symbol' && value === ')') depth--;
    requireThat(depth >= 0, 'Unbalanced SQL parentheses.');
    result.push({kind, value, upper: kind === 'word' ? value.toUpperCase() : value, depth, start, end: i});
    if (kind === 'symbol' && value === '(') depth++;
  }
  requireThat(depth === 0, 'Unbalanced SQL parentheses.'); return result;
}

const forbidden = new Set('EXEC EXECUTE USE CREATE ALTER DROP TRUNCATE DBCC GRANT REVOKE DENY BACKUP RESTORE KILL WAITFOR MERGE BULK OPENROWSET OPENQUERY OPENDATASOURCE COMMIT ROLLBACK BEGIN DECLARE GO INTO WRITETEXT UPDATETEXT READTEXT SEND RECEIVE MOVE GET CHECKPOINT SHUTDOWN RECONFIGURE ENABLE DISABLE PRINT RAISERROR THROW RETURN OPEN FETCH CLOSE DEALLOCATE'.split(' '));

/** Ordinary single-statement DML including CTEs/INSERT SELECT. Database validates syntax. */
export function classifySql(text) {
  const all = tokens(text), list = all.at(-1)?.kind === 'symbol' && all.at(-1)?.value === ';' ? all.slice(0, -1) : all;
  requireThat(list.length > 0, 'SQL needs a statement.');
  requireThat(!list.some(t => t.kind === 'symbol' && t.value === ';'), 'Multiple SQL statements are unsupported.');
  // INSERT INTO is ordinary DML; SELECT/OUTPUT INTO creates or changes another object.
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.kind === 'word' && forbidden.has(t.upper)) requireThat(t.upper === 'INTO' && list[i - 1]?.upper === 'INSERT', 'Unsupported SQL capability or statement.');
    requireThat(!(t.kind === 'word' && t.upper === 'NEXT' && list[i + 1]?.upper === 'VALUE'), 'Sequence mutation is unsupported.');
    requireThat(!(t.kind === 'word' && t.upper === 'END' && list[i + 1]?.upper === 'CONVERSATION'), 'Broker mutation is unsupported.');
    requireThat(!(t.kind === 'symbol' && t.value === '.' && (list[i + 1]?.value === '.' || list[i + 2]?.value === '.')), 'Cross-database or linked-server names are unsupported.');
    requireThat(!(['word','identifier'].includes(t.kind) && t.value.startsWith('#')), 'Temporary database objects are outside the configured schema.');
  }
  const commands = list.filter(t => t.kind === 'word' && t.depth === 0 && ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(t.upper));
  const command = commands[0]?.upper;
  requireThat(list.filter(t => t.kind === 'word' && t.upper === 'SET').length === (command === 'UPDATE' ? 1 : 0), 'Session SET commands are unsupported.');
  requireThat(['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(command) && list[0].kind === 'word' && (list[0].upper === command || list[0].upper === 'WITH'), 'Only SELECT/INSERT/UPDATE/DELETE are supported.');
  requireThat(commands.slice(1).every(t => t.upper === 'SELECT'), 'Multiple SQL operations are unsupported.');
  // A SELECT following another SELECT needs a set operator, not an omitted semicolon.
  for (let i = 1; i < commands.length; i++) {
    if (command === 'INSERT' && i === 1) continue;
    const at = list.indexOf(commands[i]), preceding = list[at - 1]?.upper === 'ALL' ? list[at - 2]?.upper : list[at - 1]?.upper;
    requireThat(['UNION', 'INTERSECT', 'EXCEPT'].includes(preceding), 'Multiple SELECT statements are unsupported.');
  }
  return {command, capability: command === 'SELECT' ? 'dbSelect' : 'dbDml', tokens: all};
}

export function quoteIdentifier(value) {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f]/.test(value), 'Invalid SQL Server identifier.');
  return `[${value.replaceAll(']', ']]')}]`;
}

/** A deliberately narrow optional restoration predicate, not a prerequisite for normal DML. */
export function validateRestoration(text, guard) {
  const {command, tokens: all} = classifySql(text), list = all.filter(t => !(t.kind === 'symbol' && t.value === ';'));
  requireThat(command === 'UPDATE', 'Restoration supports a guarded UPDATE.');
  const where = list.findLastIndex(t => t.depth === 0 && t.upper === 'WHERE'), predicate = list.slice(where + 1);
  requireThat(where >= 0 && predicate.length === 7 && predicate.every(t => t.depth === 0)
    && ['word', 'identifier'].includes(predicate[0].kind) && predicate[1].value === '=' && predicate[2].value === `@${guard.identityParameter}`
    && predicate[3].upper === 'AND' && ['word', 'identifier'].includes(predicate[4].kind) && predicate[5].value === '=' && predicate[6].value === `@${guard.versionParameter}`,
  'Restoration needs a terminal identity AND version equality predicate.');
  requireThat(predicate[0].value.toLowerCase() !== predicate[4].value.toLowerCase(), 'Restoration needs distinct identity and version columns.');
  const name = token => token && ['word','identifier','slot'].includes(token.kind);
  let schema, table;
  if (name(list[1]) && list[2]?.value === '.' && name(list[3]) && list[4]?.upper === 'SET') {schema = list[1].value; table = list[3].value;}
  else if (name(list[1]) && list[2]?.upper === 'SET') table = list[1].value;
  requireThat(table && !list.some(t => t.kind === 'word' && t.depth === 0 && ['FROM','JOIN'].includes(t.upper)), 'Restoration needs a direct table UPDATE without joins or aliases.');
  return {...(schema ? {schema} : {}), table, identityColumn: predicate[0].value, versionColumn: predicate[4].value};
}
