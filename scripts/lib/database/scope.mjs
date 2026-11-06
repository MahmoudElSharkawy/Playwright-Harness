import * as sqlserver from './sqlserver-syntax.mjs';
import * as postgresql from './postgresql-syntax.mjs';
import * as mysql from './mysql-syntax.mjs';
import {DatabaseFailure} from './shared.mjs';

const syntaxes = {sqlserver, postgresql, mysql};
const prepared = new WeakMap();
const words = text => new Set(text.split(' '));
const aliasStops = words('AS FROM WHERE JOIN LEFT RIGHT INNER OUTER FULL CROSS NATURAL STRAIGHT_JOIN APPLY ON USING SET VALUES VALUE DEFAULT SELECT WITH INTO OUTPUT RETURNING GROUP HAVING ORDER WINDOW UNION INTERSECT EXCEPT LIMIT OFFSET FETCH FOR FORCE PARTITION TABLESAMPLE PIVOT UNPIVOT OPTION WHEN THEN ELSE END NULLS ASC DESC');
const noLocalNames = new Set();
const commonCalls = words('abs acos asin atan atan2 avg ceil ceiling char_length coalesce concat concat_ws cos count exp floor greatest least left length lower ltrim max min mod nullif power replace reverse right round rtrim sign sin sqrt substring sum tan trim upper row_number rank dense_rank percent_rank cume_dist ntile lag lead first_value last_value nth_value');
const engineCalls = {
  sqlserver: words('ascii atn2 cast char charindex convert datalength dateadd datediff datediff_big datefromparts datepart datename day eomonth format generate_series getdate getutcdate iif isdate isjson isnull isnumeric json_array json_object json_query json_value log log10 month nchar newid openjson parsename patindex replicate space str string_agg string_escape string_split stuff sysdatetime sysutcdatetime sysdatetimeoffset translate try_cast try_convert unicode year'),
  postgresql: words('array_agg array_length cardinality bit_length btrim cast char_length date_part date_trunc encode decode extract generate_series json_agg json_array_elements json_build_array json_build_object json_each json_extract_path jsonb_agg jsonb_array_elements jsonb_build_array jsonb_build_object jsonb_each jsonb_extract_path length lpad make_date octet_length pg_backend_pid pg_column_size pg_sleep pg_sleep_for pg_sleep_until pg_typeof position regexp_match regexp_matches regexp_replace repeat replace reverse rpad split_part string_agg strpos to_char to_date to_json to_jsonb to_number to_timestamp translate trunc unnest nextval currval setval now'),
  mysql: words('adddate ascii bin cast char convert curdate current_date current_time current_timestamp curtime date date_add date_format date_sub datediff day dayofmonth elt extract field find_in_set format group_concat hex if ifnull instr json_array json_arrayagg json_contains json_extract json_length json_object json_objectagg json_quote json_unquote locate log log10 lpad month now octet_length regexp_instr regexp_like regexp_replace regexp_substr repeat rpad sleep space strcmp subdate substr time timestamp timestampdiff truncate unhex unix_timestamp uuid year')
};
const specialCalls = words('coalesce nullif greatest least extract position substring trim');
const builtinTypes = words('bigint binary bit bool boolean bpchar bytea char character date datetime datetime2 datetimeoffset decimal double float float4 float8 int int2 int4 int8 integer interval json jsonb money name nchar numeric nvarchar oid real regclass signed smallint smallmoney sysname text time timestamp timestamptz timetz tinyint uniqueidentifier unsigned uuid varbinary varchar xid xid8 year');
const sequenceCalls = words('nextval currval setval');
const sqlServerRowsets = words('GENERATE_SERIES OPENJSON STRING_SPLIT');
const legacyHints = words('NOLOCK READUNCOMMITTED READCOMMITTED REPEATABLEREAD SERIALIZABLE SNAPSHOT HOLDLOCK UPDLOCK XLOCK ROWLOCK PAGLOCK TABLOCK TABLOCKX READPAST NOWAIT NOEXPAND');
const sqlServerHints = new Set([...legacyHints, ...words('READCOMMITTEDLOCK INDEX FORCESEEK FORCESCAN')]);
const binaryWords = words('AND OR XOR LIKE ILIKE SIMILAR IN BETWEEN REGEXP RLIKE ESCAPE');
const symbols = ['->>', '#>>', '<=>', '->', '#>', '>=', '<=', '<>', '!=', '!<', '!>', '||', '&&', '@>', '<@', '?|', '?&', '=', '<', '>', '+', '-', '*', '/', '%', '^', '&', '|', '#', '?'];
const word = (token, value) => token?.kind === 'word' && (value === undefined || token.upper === value);
const symbol = (token, value) => token?.kind === 'symbol' && token.value === value;
const name = token => word(token) || token?.kind === 'identifier';

function need(condition, reason = 'DB_SCOPE_UNSUPPORTED') {
  if (!condition) throw new DatabaseFailure('EXECUTOR', false, reason);
}

// This parser consumes the supported statement shapes and walks expressions for
// subqueries and object-bearing syntax. The database still evaluates SQL grammar,
// operators, constraints and permissions. An unconsumed clause never reaches it.
class ScopeSql {
  constructor(target, text, tokens) {
    this.engine = target.engine;
    this.scope = this.engine === 'mysql' ? target.database : target.schema;
    this.syntax = syntaxes[this.engine];
    this.text = text;
    this.tokens = tokens;
    this.pos = 0;
    this.ctes = new Set();
    this.tables = new Set();
    this.routines = new Set();
    this.localPairs = new Map();
    this.edits = new Map();
    need(tokens.every(token => token.depth <= 64));
  }

  peek(offset = 0) {return this.tokens[this.pos + offset];}
  at(value) {return word(this.peek(), value) || symbol(this.peek(), value);}
  eat(value) {
    if (!this.at(value)) return false;
    this.pos++;
    return true;
  }
  take(value) {need(this.eat(value));}
  next() {return this.tokens[this.pos++];}
  namePart() {
    need(name(this.peek()));
    const token = this.next();
    if (this.engine !== 'mysql') this.syntax.quoteIdentifier(this.spelling(token));
    return token;
  }
  spelling(token) {
    return this.engine === 'postgresql' && word(token) ? token.value.toLowerCase() : token.value;
  }
  path() {
    const parts = [this.namePart()];
    while (this.at('.') && name(this.peek(1))) {
      this.pos++;
      parts.push(this.namePart());
    }
    return parts;
  }
  list(read) {
    do {read();} while (this.eat(','));
  }
  group(read) {
    this.take('(');
    read();
    this.take(')');
  }
  matchSymbol(value) {
    for (let i = 0; i < value.length; i++) {
      const token = this.peek(i);
      if (!symbol(token, value[i]) || i && this.peek(i - 1).end !== token.start) return false;
    }
    return true;
  }
  eatSymbol(value) {
    if (!this.matchSymbol(value)) return false;
    this.pos += value.length;
    return true;
  }
  closing(open) {
    const depth = this.tokens[open].depth;
    for (let end = open + 1; end < this.tokens.length; end++) {
      const token = this.tokens[end];
      if (token.depth === depth && symbol(token, ')')) return end;
    }
    need(false);
  }
  alias() {
    if (this.eat('AS')) return this.namePart();
    const token = this.peek();
    if (this.engine === 'sqlserver' && word(token, 'HOLDLOCK')) return;
    if (token?.kind === 'identifier' || word(token) && !aliasStops.has(token.upper)) return this.namePart();
  }
  columns() {this.group(() => this.list(() => this.namePart()));}
  insertPrefix(token, prefix) {this.edits.set(token.start, {end: token.start, text: prefix});}
  qualify(parts) {
    need(parts.length <= 2, 'DB_SCOPE_DENIED');
    if (parts.length === 2) need(this.spelling(parts[0]) === this.scope, 'DB_SCOPE_DENIED');
    else this.insertPrefix(parts[0], this.syntax.quoteIdentifier(this.scope) + '.');
  }
  table(parts, local = this.ctes) {
    const tableName = this.spelling(parts.at(-1));
    if (parts.length === 1) {
      if (local.has(tableName)) return;
      // Native collation may equate different spellings. Check those pairs
      // before dispatch so qualification cannot redirect a local reference.
      if (this.engine !== 'postgresql') for (const candidate of local) {
        this.localPairs.set(JSON.stringify([tableName, candidate]), Object.freeze([tableName, candidate]));
        need(this.localPairs.size <= 256);
      }
    }
    this.qualify(parts);
    this.syntax.quoteIdentifier(tableName);
    this.tables.add(tableName);
  }
  finish() {
    this.statement();
    this.eat(';');
    need(!this.peek() && this.tables.size + this.routines.size <= 128);
    let text = this.text;
    for (const [start, edit] of [...this.edits].sort(([a], [b]) => b - a)) {
      text = text.slice(0, start) + edit.text + text.slice(edit.end);
    }
    return {text, tables: Object.freeze([...this.tables]), routines: Object.freeze([...this.routines]),
      localPairs: Object.freeze([...this.localPairs.values()])};
  }

  statement(readOnly = false) {
    const outer = this.ctes;
    try {
      if (this.eat('WITH')) this.withQueries();
      if (this.at('SELECT') || readOnly && this.at('VALUES')) this.selectQuery();
      else if (!readOnly && this.eat('INSERT')) this.insert();
      else if (!readOnly && this.eat('UPDATE')) this.update();
      else if (!readOnly && this.eat('DELETE')) this.delete();
      else need(false);
    } finally {this.ctes = outer;}
  }
  withQueries() {
    const recursive = this.engine !== 'sqlserver' && this.eat('RECURSIVE');
    const definitions = [];
    const names = new Set();
    this.list(() => {
      const label = this.spelling(this.namePart());
      need(!names.has(label));
      names.add(label);
      if (this.at('(')) this.columns();
      this.take('AS');
      if (this.engine === 'postgresql' && this.eat('NOT')) this.take('MATERIALIZED');
      else if (this.engine === 'postgresql') this.eat('MATERIALIZED');
      const open = this.pos;
      this.take('(');
      const end = this.closing(open);
      definitions.push({label, start: this.pos, end});
      this.pos = end + 1;
    });
    const main = this.pos;
    this.ctes = new Set(this.ctes);
    if (recursive && this.engine === 'postgresql') for (const label of names) this.ctes.add(label);
    for (const {label, start, end} of definitions) {
      if (recursive || this.engine === 'sqlserver') this.ctes.add(label);
      this.pos = start;
      this.statement(true);
      need(this.pos === end);
      this.ctes.add(label);
    }
    this.pos = main;
  }
  top() {
    if (this.engine !== 'sqlserver' || !this.eat('TOP')) return;
    if (this.at('(')) this.group(() => this.expression());
    else need(this.next()?.kind === 'number');
    this.eat('PERCENT');
    if (this.eat('WITH')) this.take('TIES');
  }
  projections() {this.list(() => {this.expression(); this.alias();});}
  selectQuery() {
    this.selectTerm();
    while (this.eat('UNION') || this.eat('INTERSECT') || this.eat('EXCEPT')) {
      if (!this.eat('ALL')) this.eat('DISTINCT');
      if (this.at('(')) this.group(() => this.statement(true));
      else this.selectTerm();
    }
    this.orderLimit();
    if (this.engine === 'sqlserver' && this.eat('FOR')) this.serialization();
  }
  serialization() {
    const json = this.eat('JSON');
    if (!json) this.take('XML');
    if (this.eat('PATH') || !json && this.eat('RAW')) {
      if (!json && this.at('(')) this.group(() => {need(this.next()?.kind === 'literal');});
    } else if (!this.eat('AUTO')) {
      need(!json);
      this.take('EXPLICIT');
    }
    while (this.eat(',')) {
      if (this.eat('ROOT')) {
        if (this.at('(')) this.group(() => {need(this.next()?.kind === 'literal');});
      } else if (json) need(this.eat('INCLUDE_NULL_VALUES') || this.eat('WITHOUT_ARRAY_WRAPPER'));
      else if (this.eat('ELEMENTS')) {
        if (!this.eat('XSINIL')) this.eat('ABSENT');
      } else need(this.eat('TYPE') || this.eat('BINARY') && this.eat('BASE64'));
    }
  }
  selectTerm() {
    if (this.eat('VALUES')) {this.values(); return;}
    this.take('SELECT');
    if (this.eat('DISTINCT')) {
      if (this.engine === 'postgresql' && this.eat('ON')) this.group(() => this.list(() => this.expression()));
    } else if (!this.eat('ALL') && this.engine === 'mysql') this.eat('DISTINCTROW');
    this.top();
    this.projections();
    if (this.eat('FROM')) this.sources();
    this.where();
    if (this.eat('GROUP')) {
      this.take('BY');
      this.list(() => this.expression());
      if (this.engine === 'mysql' && this.eat('WITH')) this.take('ROLLUP');
    }
    if (this.eat('HAVING')) this.expression();
    if (this.eat('WINDOW')) this.list(() => {this.namePart(); this.take('AS'); this.group(() => this.window());});
  }
  where() {if (this.eat('WHERE')) this.expression();}
  order() {
    if (!this.eat('ORDER')) return;
    this.take('BY');
    this.list(() => {
      this.expression();
      if (!this.eat('ASC')) this.eat('DESC');
      if (this.eat('NULLS') && !this.eat('FIRST')) this.take('LAST');
    });
  }
  orderLimit() {
    this.order();
    if (this.eat('LIMIT')) {
      this.expression();
      if (this.engine === 'mysql' && this.eat(',')) this.expression();
    }
    if (this.eat('OFFSET')) {
      this.expression();
      if (!this.eat('ROW')) this.eat('ROWS');
    }
    if (this.engine === 'postgresql' && this.eat('FETCH')) {
      if (!this.eat('FIRST')) this.take('NEXT');
      if (!this.at('ROW') && !this.at('ROWS')) this.expression();
      if (!this.eat('ROW')) this.take('ROWS');
      this.take('ONLY');
    }
  }

  sources() {
    const aliases = new Set();
    this.source(aliases);
    while (this.eat(',') || this.join()) {
      this.source(aliases);
      if (this.eat('ON')) this.expression();
      else if (this.eat('USING')) {
        this.columns();
        if (this.engine === 'postgresql' && this.eat('AS')) this.namePart();
      }
    }
    return aliases;
  }
  join() {
    if (this.eat('JOIN') || this.engine === 'mysql' && this.eat('STRAIGHT_JOIN')) return true;
    const natural = this.eat('NATURAL');
    if (this.eat('LEFT') || this.eat('RIGHT') || this.eat('FULL')) this.eat('OUTER');
    else if (!(this.eat('INNER') || this.eat('CROSS') || this.eat('OUTER') || natural)) return false;
    if (!(this.engine === 'sqlserver' && this.eat('APPLY'))) this.take('JOIN');
    return true;
  }
  source(aliases) {
    if (this.engine !== 'sqlserver') this.eat('LATERAL');
    let derived = false, relation, nestedAliases;
    if (this.at('(')) {
      this.group(() => {
        if (this.at('SELECT') || this.at('WITH') || this.at('VALUES')) this.statement(true);
        else nestedAliases = this.sources();
      });
      derived = true;
    } else {
      const only = this.engine === 'postgresql' && this.eat('ONLY');
      if (only && this.eat('(')) {relation = this.path(); this.take(')');}
      else relation = this.path();
      if (this.engine === 'mysql' && relation.length === 1 && word(relation[0], 'DUAL')) {
        // MySQL's unquoted DUAL is a grammar construct with no backing table.
      } else if (this.legacyTableHint()) {
        this.table(relation);
        this.tableHints();
      } else if (!only && this.at('(')) {
        if (this.engine === 'sqlserver' && relation.length === 1) {
          need(word(relation[0]) && sqlServerRowsets.has(relation[0].upper));
        }
        this.call(relation);
        if (this.engine === 'sqlserver' && relation.length === 1 && word(relation[0], 'OPENJSON') && this.eat('WITH')) {
          this.group(() => this.list(() => {
            this.namePart();
            this.type();
            if (this.peek()?.kind === 'literal') this.next();
            if (this.eat('AS')) this.take('JSON');
          }));
        }
        derived = true;
      } else {
        this.table(relation, only ? noLocalNames : this.ctes);
        if (this.engine === 'postgresql') this.eat('*');
        if (this.engine === 'mysql' && this.eat('PARTITION')) this.columns();
      }
    }
    const alias = this.alias();
    if (alias) aliases.add(this.spelling(alias));
    else if (this.engine === 'mysql' && relation) aliases.add(this.spelling(relation.at(-1)));
    else if (nestedAliases) for (const child of nestedAliases) aliases.add(child);
    if (alias && (derived || this.engine === 'postgresql') && this.at('(')) this.columns();
    if (this.engine === 'sqlserver') {
      // Bare HOLDLOCK is a table hint, never a local alias for a DML target.
      const hold = !derived && this.eat('HOLDLOCK');
      if (this.eat('WITH') || !derived && (this.legacyTableHint() || (alias || hold) && this.at('('))) this.tableHints();
    }
    while (this.engine === 'mysql' && this.eat('FORCE')) {
      if (!this.eat('INDEX')) this.take('KEY');
      if (this.eat('FOR') && !this.eat('JOIN')) {
        need(this.eat('ORDER') || this.eat('GROUP'));
        this.take('BY');
      }
      this.columns();
    }
  }
  legacyTableHint() {
    return this.engine === 'sqlserver' && this.at('(') && word(this.peek(1)) && sqlServerHints.has(this.peek(1).upper);
  }
  tableHints() {
    // These hints apply to the already scoped relation. Their arguments name
    // its indexes, columns or counts, not independent SQL expressions.
    if (this.peek(1)?.kind === 'number' && /^\d+$/.test(this.peek(1).value) && symbol(this.peek(2), ')')) {
      this.group(() => this.next());
      return;
    }
    this.group(() => this.list(() => {
      need(word(this.peek()) && sqlServerHints.has(this.next().upper));
      if (this.eat('=')) {need(name(this.peek()) || this.peek()?.kind === 'number'); this.next();}
      else if (this.at('(')) this.group(() => this.list(() => {
        need(name(this.peek()) || this.peek()?.kind === 'number');
        this.next();
        if (this.at('(')) this.columns();
      }));
    }));
  }
  values() {this.list(() => this.group(() => this.list(() => this.expression())));}
  output() {if (this.engine === 'sqlserver' && this.eat('OUTPUT')) this.projections();}
  returning() {if (this.engine === 'postgresql' && this.eat('RETURNING')) this.projections();}
  assignments() {
    this.list(() => {
      if (this.at('(')) this.columns();
      else this.column(this.path());
      const compound = this.engine === 'sqlserver' && ['+=','-=','*=','/=','%=','&=','^=','|='].some(operator => this.eatSymbol(operator));
      if (!compound) this.take('=');
      this.expression();
    });
  }
  insert() {
    this.top();
    this.eat('INTO');
    this.table(this.path(), this.engine === 'sqlserver' ? this.ctes : noLocalNames);
    if (this.engine === 'mysql' && this.eat('PARTITION')) this.columns();
    if (this.engine === 'postgresql') this.alias();
    if (this.at('(')) this.columns();
    this.output();
    if (this.eat('DEFAULT')) this.take('VALUES');
    else if (this.eat('VALUES') || this.engine === 'mysql' && this.eat('VALUE')) this.values();
    else if (this.engine === 'mysql' && this.eat('SET')) this.assignments();
    else this.statement(true);
    this.returning();
  }
  update() {
    this.top();
    let target;
    if (this.engine === 'mysql') this.sources();
    else {
      const only = this.engine === 'postgresql' && this.eat('ONLY');
      if (only && this.eat('(')) {target = this.path(); this.take(')');}
      else target = this.path();
      if (this.engine === 'postgresql') {
        this.table(target, noLocalNames);
        this.eat('*');
        this.alias();
      } else if (this.eat('WITH')) this.tableHints();
    }
    this.take('SET');
    this.assignments();
    this.output();
    const sources = this.eat('FROM') ? this.sources() : new Set();
    if (this.engine === 'sqlserver') this.table(target, new Set([...this.ctes, ...sources]));
    this.where();
    this.returning();
    if (this.engine === 'mysql') this.orderLimit();
  }
  delete() {
    this.top();
    const from = this.eat('FROM');
    if (this.engine === 'mysql') {
      const targets = [];
      this.list(() => {
        targets.push(this.path());
        if (this.eat('.')) this.take('*');
      });
      const multiple = from ? this.eat('USING') : (this.take('FROM'), true);
      if (multiple) {
        const aliases = this.sources();
        for (const parts of targets) {
          if (parts.length > 1) this.qualify(parts);
          need(aliases.has(this.spelling(parts.at(-1))));
        }
      } else {
        need(targets.length === 1);
        this.table(targets[0], noLocalNames);
        if (this.eat('PARTITION')) this.columns();
        this.alias();
      }
      this.where();
      this.orderLimit();
      return;
    }
    const only = this.engine === 'postgresql' && this.eat('ONLY');
    let target;
    if (only && this.eat('(')) {target = this.path(); this.take(')');}
    else target = this.path();
    if (this.engine === 'postgresql') {
      this.table(target, noLocalNames);
      this.eat('*');
      this.alias();
      if (this.eat('USING')) this.sources();
    } else {
      if (this.eat('WITH')) this.tableHints();
      this.output();
      const sources = this.eat('FROM') ? this.sources() : new Set();
      this.table(target, new Set([...this.ctes, ...sources]));
    }
    this.where();
    this.returning();
  }

  expression() {
    let literal = this.term();
    while (this.operator()) {this.term(); literal = undefined;}
    return literal;
  }
  operator() {
    if (this.eat('IS')) {
      this.eat('NOT');
      if (this.eat('DISTINCT')) this.take('FROM');
      return true;
    }
    if (this.eat('AT')) {this.take('TIME'); this.take('ZONE'); return true;}
    if (this.eat('NOT')) {
      need(word(this.peek()) && binaryWords.has(this.next().upper));
      return true;
    }
    if (word(this.peek()) && binaryWords.has(this.peek().upper)) {
      if (word(this.next(), 'SIMILAR')) this.take('TO');
      return true;
    }
    return symbols.some(value => this.eatSymbol(value));
  }
  term() {
    let unary = false;
    while (this.eat('+') || this.eat('-') || this.eat('~') || this.eat('NOT') || this.engine === 'mysql' && this.eat('!')) unary = true;
    let literal = this.atom();
    while (true) {
      if (this.engine === 'postgresql' && this.eatSymbol('::')) this.type(literal);
      else if (this.eat('COLLATE')) {
        const parts = this.path();
        if (this.engine === 'postgresql') {
          const builtin = ['C', 'POSIX', 'default'].includes(this.spelling(parts.at(-1)));
          if (!(builtin && (parts.length === 1 || parts.length === 2 && this.spelling(parts[0]) === 'pg_catalog'))) this.qualify(parts);
        } else need(parts.length === 1);
      } else if (this.eat('OVER')) {
        if (this.at('(')) this.group(() => this.window()); else this.namePart();
      } else if (this.eat('FILTER')) this.group(() => {this.take('WHERE'); this.expression();});
      else if (this.eat('WITHIN')) {this.take('GROUP'); this.group(() => this.order());}
      else if (this.engine === 'postgresql' && this.eat('[')) {this.expression(); this.take(']');}
      else if (this.engine === 'postgresql' && this.eat('.')) this.namePart();
      else break;
      literal = undefined;
    }
    return unary ? undefined : literal;
  }
  atom() {
    const token = this.peek();
    if (this.at('(')) {
      this.group(() => {
        if (this.at('SELECT') || this.at('WITH') || this.at('VALUES')) this.statement(true);
        else this.list(() => this.expression());
      });
      return;
    }
    if (this.eat('CASE')) {
      if (!this.at('WHEN')) this.expression();
      do {this.take('WHEN'); this.expression(); this.take('THEN'); this.expression();} while (this.at('WHEN'));
      if (this.eat('ELSE')) this.expression();
      this.take('END');
      return;
    }
    if (this.eat('EXISTS')) {this.group(() => this.statement(true)); return;}
    if ((this.at('ANY') || this.at('SOME') || this.at('ALL')) && symbol(this.peek(1), '(')) {
      this.next();
      this.group(() => {
        if (this.at('SELECT') || this.at('WITH')) this.statement(true); else this.expression();
      });
      return;
    }
    if (this.engine === 'postgresql' && this.at('ARRAY') && symbol(this.peek(1), '[')) {
      this.pos += 2;
      if (!this.at(']')) this.list(() => this.expression());
      this.take(']');
      return;
    }
    if (this.eat('*')) return;
    if (['number', 'parameter', 'literal'].includes(token?.kind)) {
      this.next();
      return token.kind === 'literal' ? token : undefined;
    }
    const parts = this.path();
    if (this.at('(')) {this.call(parts); return;}
    if (this.peek()?.kind === 'literal') {
      if (parts.length === 1 && word(parts[0]) && ['N', 'B', 'X'].includes(parts[0].upper)) {this.next(); return;}
      this.typeName(parts, this.next());
      return;
    }
    if (this.eat('.')) this.take('*');
    this.column(parts);
  }
  column(parts) {
    need(parts.length <= 3, 'DB_SCOPE_DENIED');
    if (parts.length === 3) need(this.spelling(parts[0]) === this.scope, 'DB_SCOPE_DENIED');
  }
  window() {
    if (name(this.peek()) && !['PARTITION', 'ORDER', 'ROWS', 'RANGE', 'GROUPS'].includes(this.peek().upper)) this.namePart();
    if (this.eat('PARTITION')) {this.take('BY'); this.list(() => this.expression());}
    this.order();
    if (this.eat('ROWS') || this.eat('RANGE') || this.eat('GROUPS')) {
      if (this.eat('BETWEEN')) {this.frameBound(); this.take('AND'); this.frameBound();}
      else this.frameBound();
    }
  }
  frameBound() {
    if (this.eat('CURRENT')) this.take('ROW');
    else {
      if (!this.eat('UNBOUNDED')) this.term();
      if (!this.eat('PRECEDING')) this.take('FOLLOWING');
    }
  }

  call(parts) {
    const last = parts.at(-1), spelling = this.spelling(last);
    const key = this.engine === 'postgresql' ? spelling : spelling.toLowerCase();
    const builtinNamespace = this.engine === 'postgresql' && parts.length === 2 && this.spelling(parts[0]) === 'pg_catalog';
    const builtin = (builtinNamespace || parts.length === 1 && (this.engine === 'postgresql' || word(last)))
      && (commonCalls.has(key) || engineCalls[this.engine].has(key));
    if (!builtin) {
      // An unrecognized bare function may be a builtin or a server-wide UDF.
      // Require an explicit application schema rather than changing its meaning.
      need(parts.length > 1);
      this.qualify(parts);
      if (this.engine === 'sqlserver') this.routines.add(spelling);
      this.group(() => {if (!this.at(')')) this.list(() => this.expression());});
      return;
    }
    if (this.engine === 'postgresql' && parts.length === 1 && !specialCalls.has(key) && key !== 'cast') this.insertPrefix(last, 'pg_catalog.');
    this.group(() => {
      if (this.engine === 'postgresql' && sequenceCalls.has(key)) {
        const literal = this.next();
        this.scopeLiteral(literal);
        if (this.eatSymbol('::')) {
          const type = this.path();
          need(this.spelling(type.at(-1)) === 'regclass');
          this.typeName(type, literal);
        }
        if (key === 'setval') {
          this.take(',');
          this.expression();
          if (this.eat(',')) this.expression();
        }
      } else if (key === 'cast' || key === 'try_cast') {
        const literal = this.expression();
        this.take('AS');
        this.type(literal);
      } else if (this.engine === 'sqlserver' && ['convert', 'try_convert'].includes(key)) {
        this.type();
        this.take(',');
        this.list(() => this.expression());
      } else if (key === 'extract') {
        this.namePart();
        this.take('FROM');
        this.expression();
      } else if (key === 'trim') {
        const positioned = this.eat('BOTH') || this.eat('LEADING') || this.eat('TRAILING');
        if (!this.at('FROM')) this.expression();
        if (this.eat('FROM')) this.expression();
        else need(!positioned || this.engine === 'postgresql');
        if (this.engine === 'postgresql' && this.eat(',')) this.expression();
      } else if (!this.at(')')) {
        if (!this.eat('DISTINCT')) this.eat('ALL');
        this.list(() => this.expression());
        if (key === 'substring' && this.eat('FROM')) this.expression();
        if (key === 'substring' && this.eat('FOR')) this.expression();
        if (key === 'convert' && this.engine === 'mysql' && this.eat('USING')) this.namePart();
        this.order();
      }
    });
  }
  type(literal) {
    const parts = this.path();
    const type = this.typeName(parts, literal);
    if (this.at('(')) this.group(() => this.list(() => {need(this.eat('MAX') || this.next()?.kind === 'number');}));
    if (type === 'double') this.eat('PRECISION');
    if (type === 'character' || type === 'bit') this.eat('VARYING');
    if (type === 'signed' || type === 'unsigned') this.eat('INTEGER');
    if (['timestamp', 'time'].includes(type) && (this.eat('WITH') || this.eat('WITHOUT'))) {
      this.take('TIME'); this.take('ZONE');
    }
    while (this.engine === 'postgresql' && this.eat('[')) {
      need(type !== 'regclass');
      this.take(']');
    }
  }
  typeName(parts, literal) {
    const type = this.spelling(parts.at(-1));
    const key = this.engine === 'postgresql' ? type : type.toLowerCase();
    const builtin = builtinTypes.has(key) && (parts.length === 1
      || this.engine === 'postgresql' && parts.length === 2 && this.spelling(parts[0]) === 'pg_catalog');
    if (!builtin) {
      need(parts.length > 1);
      this.qualify(parts);
    }
    if (this.engine === 'postgresql' && key === 'regclass' && builtin) this.scopeLiteral(literal);
    return key;
  }
  scopeLiteral(literal) {
    // PostgreSQL's regclass accepts names and raw OIDs. Only a complete static
    // identifier path can be bound to this scope, never a computed OID or string.
    need(literal?.kind === 'literal' && this.text[literal.start] === "'");
    const value = literal.value.trim();
    const parts = this.syntax.tokens(value);
    need((parts.length === 1 || parts.length === 3 && symbol(parts[1], '.'))
      && name(parts[0]) && name(parts.at(-1)) && parts[0].start === 0 && parts.at(-1).end === value.length
      && parts.every((part, i) => i === 0 || value.slice(parts[i - 1].end, part.start).trim() === ''));
    if (parts.length === 3) need(this.spelling(parts[0]) === this.scope, 'DB_SCOPE_DENIED');
    const qualified = this.syntax.quoteIdentifier(this.scope) + '.' + this.syntax.quoteIdentifier(this.spelling(parts.at(-1)));
    this.edits.set(literal.start, {end: literal.end, text: "'" + qualified.replaceAll("'", "''") + "'"});
  }
}

/** Resolve all caller-authored SQL before credentials or native dispatch. */
export function scopeDatabaseRequest(target, request) {
  const scope = target.engine === 'mysql' ? target.database : target.schema;
  const previous = prepared.get(request);
  if (previous?.engine === target.engine && previous.scope === scope) return request;
  try {
    const classified = syntaxes[target.engine].classifySql(request.text);
    need(request.command === undefined || request.command === classified.command);
    need(request.capability === undefined || request.capability === classified.capability);
    const scoped = new ScopeSql(target, request.text, classified.tokens).finish();
    const result = Object.freeze({...request, ...scoped, command: classified.command, capability: classified.capability});
    prepared.set(result, {engine: target.engine, scope});
    return result;
  } catch (error) {
    if (error instanceof DatabaseFailure) throw error;
    throw new DatabaseFailure('EXECUTOR', false, 'DB_SCOPE_UNSUPPORTED');
  }
}
