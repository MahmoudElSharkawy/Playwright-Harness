import { test, type TestInfo } from '@playwright/test';
import * as sql from 'mssql';

/** Connection settings for one SQL Server database. The password never appears in any log or attachment. */
export interface DBConnectionConfig {
  /** Optional display name used in step titles and console lines (e.g. 'ordersDb') to tell multiple DBs apart. */
  name?: string;
  /** Host name or IP. 'HOST\\INSTANCE' also works (requires the SQL Browser service; leave `port` unset then). */
  server: string;
  /** TCP port; the driver defaults to 1433 when omitted. */
  port?: number;
  database: string;
  user: string;
  password: string;
  /** TLS encryption. Defaults to true (the tedious >=16 driver default). */
  encrypt?: boolean;
  /**
   * Defaults to true — deviates from the driver default because this is test tooling
   * usually aimed at internal servers with self-signed certificates. Set false to harden.
   */
  trustServerCertificate?: boolean;
  /** Milliseconds to wait for the connection; default 15000. */
  connectionTimeout?: number;
  /** Milliseconds to wait for each query; default 15000. */
  requestTimeout?: number;
  /** Escape hatch merged last into the mssql `options` object (e.g. instanceName, cryptoCredentialsDetails). */
  options?: Record<string, unknown>;
}

export interface DBActionsOptions {
  /** Mirror each query to the console. Defaults to DB_CONSOLE_LOGS=true env var, then project metadata `dbConsoleLogs`. */
  consoleLogs?: boolean;
  /** Max characters of any attached payload before truncation. Default 50000. */
  maxBodyLength?: number;
  /** Set false to disable redaction of credential-like param names / row keys in reports and console output. Default true. */
  redact?: boolean;
}

/** Pass { type, value } as a param to force an explicit sql type (e.g. { type: sql.DateTime2, value: d }). */
export interface DBTypedParam {
  type: sql.ISqlType | (() => sql.ISqlType);
  value: unknown;
}

export type DBParams = Record<string, unknown | DBTypedParam>;

export interface DBQueryResult<T = Record<string, unknown>> {
  /** Rows of the first recordset; [] for non-SELECT statements. */
  rows: T[];
  /** All recordsets, for multi-statement batches (plain arrays, driver metadata stripped). */
  recordsets: T[][];
  /** Rows affected per statement — the useful signal for INSERT/UPDATE/DELETE. */
  rowsAffected: number[];
}

interface DbQueryLog {
  /** ISO timestamp captured when the operation started. */
  timestamp: string;
  operation: 'QUERY' | 'CONNECT' | 'CLOSE';
  /** Display label: config.name when set, otherwise 'server:port/database'. */
  db: string;
  server: string;
  database: string;
  sql?: string;
  params?: Record<string, unknown>;
  /** null when the operation failed before producing a result. */
  rowCount: number | null;
  rowsAffected?: number[];
  recordsetCount?: number;
  rows?: unknown;
  durationMs: number;
  error?: { message: string; code?: string; phase: 'connect' | 'query' | 'close'; stack?: string };
}

const REDACTED_KEYS = new Set([
  'password', 'token', 'access_token', 'refresh_token', 'client_secret', 'secret', 'apikey', 'api_key',
]);

/**
 * Logging facade over an mssql ConnectionPool — the database sibling of ApiActions.
 *
 * Every query becomes a test step with `Query details` / `Query results`
 * attachments nested inside it, visible in the Allure and HTML reports alike.
 * The lazy connect gets its own `DB CONNECT` step (nested in the first query's
 * step, or top-level when `connect()` is called explicitly).
 *
 * Attachments must be created via `test.info().attach()` from inside the step
 * body — allure-playwright nests those in the step, whereas `step.attach()`
 * ends up outside the step in the Allure report.
 *
 * Reporting is strictly best-effort: no logging failure can alter the outcome
 * of the query itself, and everything works (minus attachments) outside a
 * running test, e.g. in global setup.
 *
 * One instance = one database; create several instances (each with its own
 * pool) to talk to several databases in the same scenario. `query()` connects
 * lazily and the pool is reused across queries; call `close()` in teardown.
 * Note: `GO` batch separators are client-side syntax (SSMS/sqlcmd) and are not
 * supported by the driver — use `;`-separated statements instead.
 */
export class DBActions {
  private readonly maxBodyLength: number;
  private pool?: sql.ConnectionPool;
  private connecting?: Promise<sql.ConnectionPool>;

  constructor(private readonly config: DBConnectionConfig, private readonly options: DBActionsOptions = {}) {
    this.maxBodyLength = options.maxBodyLength ?? 50_000;
  }

  /**
   * Runs a (parameterized) T-SQL batch and logs it as a report step with attachments.
   * Params are bound via request.input() (injection-safe): plain values get their type
   * inferred, or pass { type, value } to force one. Works for SELECT and DML alike.
   */
  async query<T = Record<string, unknown>>(queryText: string, params?: DBParams): Promise<DBQueryResult<T>> {
    return this.dispatch(`DB QUERY ${this.label(true)}${this.stepTitle(queryText)}`, attach =>
      this.executeQuery<T>(queryText, params, attach),
    );
  }

  /** Eagerly opens the pool as its own top-level step (optional — query() connects lazily). */
  async connect(): Promise<void> {
    await this.getPool();
  }

  /** Closes the pool if open; safe no-op when never connected. Call from afterAll/teardown. */
  async close(): Promise<void> {
    const pending = this.connecting;
    this.connecting = undefined;
    const pool = this.pool ?? (pending ? await pending.catch(() => undefined) : undefined);
    this.pool = undefined;
    if (!pool) return;

    return this.dispatch(`DB CLOSE ${this.label()} (${this.serverLabel()}/${this.config.database})`, async attach => {
      const timestamp = new Date().toISOString();
      const start = Date.now();
      let failure: unknown;
      try {
        await pool.close();
      } catch (err) {
        failure = err;
      }
      const entry = this.baseEntry('CLOSE', timestamp, Date.now() - start);
      if (failure) entry.error = this.toErrorInfo(failure, 'close');
      await this.report(entry, attach);
      if (failure) throw failure;
    });
  }

  /** Routes an operation through a named `test.step` when inside a test; runs it plainly otherwise. */
  private async dispatch<R>(title: string, fn: (attach: boolean) => Promise<R>): Promise<R> {
    const inTest = this.currentTestInfo() !== undefined;
    if (!inTest) return fn(false);
    return test.step(title, () => fn(true));
  }

  /** Runs the query, measures duration, builds the log entry, reports it, then returns the result or rethrows. */
  private async executeQuery<T>(queryText: string, params: DBParams | undefined, attach: boolean): Promise<DBQueryResult<T>> {
    const timestamp = new Date().toISOString();
    const start = Date.now();
    let result: sql.IResult<T> | undefined;
    let failure: unknown;
    let phase: 'connect' | 'query' = 'connect';

    try {
      const pool = await this.getPool();
      phase = 'query';
      const request = pool.request();
      this.bindParams(request, params);
      result = await request.query<T>(queryText);
    } catch (err) {
      failure = err;
    }
    const durationMs = Date.now() - start;

    const entry = this.baseEntry('QUERY', timestamp, durationMs);
    entry.sql = queryText;
    entry.params = this.redactParams(params);
    if (result) {
      entry.rowCount = result.recordset?.length ?? 0;
      entry.rowsAffected = result.rowsAffected;
      entry.recordsetCount = result.recordsets.length;
      entry.rows = this.redactDeep(
        result.recordsets.length > 1 ? (result.recordsets as T[][]).map(rs => [...rs]) : [...(result.recordset ?? [])],
      );
    }
    if (failure) entry.error = this.toErrorInfo(failure, phase);

    await this.report(entry, attach);

    if (!result) throw failure ?? new Error(`DB query failed without a result: ${this.stepTitle(queryText)}`);
    return {
      rows: [...(result.recordset ?? [])],
      recordsets: (result.recordsets as T[][]).map(rs => [...rs]),
      rowsAffected: result.rowsAffected,
    };
  }

  /** Lazy singleton pool: returns the live pool, awaits an in-flight connect, or starts one. */
  private getPool(): Promise<sql.ConnectionPool> {
    if (this.pool?.connected) return Promise.resolve(this.pool);
    if (!this.connecting) {
      this.connecting = this.openPool().catch(err => {
        this.connecting = undefined;
        throw err;
      });
    }
    return this.connecting;
  }

  /** Opens the pool inside its own 'DB CONNECT' step and reports the outcome. */
  private async openPool(): Promise<sql.ConnectionPool> {
    return this.dispatch(`DB CONNECT ${this.label()} (${this.serverLabel()}/${this.config.database})`, async attach => {
      const timestamp = new Date().toISOString();
      const start = Date.now();
      let pool: sql.ConnectionPool | undefined;
      let failure: unknown;
      try {
        pool = await new sql.ConnectionPool(this.toMssqlConfig()).connect();
      } catch (err) {
        failure = err;
      }
      const entry = this.baseEntry('CONNECT', timestamp, Date.now() - start);
      if (failure) entry.error = this.toErrorInfo(failure, 'connect');
      await this.report(entry, attach);

      if (!pool) throw failure ?? new Error(`DB connect failed: ${this.serverLabel()}/${this.config.database}`);
      this.pool = pool;
      return pool;
    });
  }

  /** Maps DBConnectionConfig to the mssql config object. */
  private toMssqlConfig(): sql.config {
    return {
      server: this.config.server,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      connectionTimeout: this.config.connectionTimeout ?? 15_000,
      requestTimeout: this.config.requestTimeout ?? 15_000,
      options: {
        encrypt: this.config.encrypt ?? true,
        trustServerCertificate: this.config.trustServerCertificate ?? true,
        enableArithAbort: true,
        ...this.config.options,
      },
    };
  }

  /** Binds params via request.input(); unwraps DBTypedParam; coerces undefined → null (type inference throws on undefined). */
  private bindParams(request: sql.Request, params?: DBParams): void {
    for (const [name, raw] of Object.entries(params ?? {})) {
      if (raw !== null && typeof raw === 'object' && 'type' in raw && 'value' in raw) {
        const typed = raw as DBTypedParam;
        request.input(name, typed.type as sql.ISqlType, typed.value ?? null);
      } else {
        request.input(name, raw ?? null);
      }
    }
  }

  /** Best-effort reporting — must never throw, so it can never mask the operation's own outcome. */
  private async report(entry: DbQueryLog, attach: boolean): Promise<void> {
    try {
      if (this.shouldConsoleLog()) this.consoleLog(entry);

      if (!attach) return;
      if (entry.operation === 'QUERY') {
        await this.attachJson('Query details', {
          timestamp: entry.timestamp,
          db: entry.db,
          server: entry.server,
          database: entry.database,
          sql: entry.sql,
          params: entry.params,
        });
        if (entry.rowCount !== null) {
          await this.attachJson('Query results', {
            durationMs: entry.durationMs,
            rowCount: entry.rowCount,
            rowsAffected: entry.rowsAffected,
            recordsetCount: entry.recordsetCount,
            rows: entry.rows,
          });
        } else {
          await this.attachJson('Query error', {
            durationMs: entry.durationMs,
            phase: entry.error?.phase,
            error: entry.error,
          });
        }
      } else if (entry.operation === 'CONNECT') {
        if (!entry.error) {
          await this.attachJson('Connection details', {
            timestamp: entry.timestamp,
            server: entry.server,
            database: entry.database,
            user: this.config.user,
            durationMs: entry.durationMs,
          });
        } else {
          await this.attachJson('Connection error', { durationMs: entry.durationMs, error: entry.error });
        }
      } else {
        if (!entry.error) {
          await this.attachJson('Close details', { timestamp: entry.timestamp, durationMs: entry.durationMs });
        } else {
          await this.attachJson('Close error', { durationMs: entry.durationMs, error: entry.error });
        }
      }
    } catch (reportErr) {
      console.warn(`DBActions: reporting failed for ${entry.operation} on ${entry.db}:`, reportErr);
    }
  }

  /** Attaches a payload as pretty-printed JSON to the current step (text/plain when truncated). */
  private async attachJson(name: string, payload: unknown): Promise<void> {
    const { text, truncated } = this.clip(this.safeStringify(payload, 2));
    await test.info().attach(name, {
      body: text,
      contentType: truncated ? 'text/plain' : 'application/json',
    });
  }

  /** Masks credential-like param names with `***` and summarizes typed params as '<TypeName> value'. */
  private redactParams(params?: DBParams): Record<string, unknown> | undefined {
    if (!params) return undefined;
    return Object.fromEntries(
      Object.entries(params).map(([name, raw]) => {
        const value = raw !== null && typeof raw === 'object' && 'type' in raw && 'value' in raw
          ? (raw as DBTypedParam).value
          : raw;
        if (this.options.redact !== false && REDACTED_KEYS.has(name.toLowerCase())) return [name, '***'];
        return [name, this.redactDeep(value)];
      }),
    );
  }

  /** Recursively masks secret-like keys (password, token, ...) in plain objects/arrays, up to 6 levels deep. */
  private redactDeep(value: unknown, depth = 0): unknown {
    if (this.options.redact === false || value === null || typeof value !== 'object' || depth > 6) return value;
    if (Array.isArray(value)) return value.map(v => this.redactDeep(v, depth + 1));
    if (Object.getPrototypeOf(value) !== Object.prototype) return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) =>
        [k, REDACTED_KEYS.has(k.toLowerCase()) ? '***' : this.redactDeep(v, depth + 1)],
      ),
    );
  }

  /** JSON.stringify that never throws — handles circular references, BigInt, and Buffers. */
  private safeStringify(value: unknown, indent = 0): string {
    const seen = new WeakSet<object>();
    try {
      return JSON.stringify(value, (_key, val) => {
        if (typeof val === 'bigint') return val.toString();
        if (Buffer.isBuffer(val)) return `<Buffer ${val.length} bytes>`;
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '<circular>';
          seen.add(val);
        }
        return val;
      }, indent) ?? String(value);
    } catch (err) {
      return `<unserializable: ${err instanceof Error ? err.message : String(err)}>`;
    }
  }

  /** Caps a string at maxBodyLength, appending a note with how much was cut. */
  private clip(text: string): { text: string; truncated: boolean } {
    if (text.length <= this.maxBodyLength) return { text, truncated: false };
    return {
      text: `${text.slice(0, this.maxBodyLength)}\n…[truncated ${text.length - this.maxBodyLength} of ${text.length} chars]`,
      truncated: true,
    };
  }

  /** Resolves the console-echo flag: constructor option, then DB_CONSOLE_LOGS env var, then project metadata. */
  private shouldConsoleLog(): boolean {
    if (this.options.consoleLogs !== undefined) return this.options.consoleLogs;
    if (process.env.DB_CONSOLE_LOGS) return process.env.DB_CONSOLE_LOGS === 'true';
    return Boolean(this.currentTestInfo()?.project.metadata?.dbConsoleLogs);
  }

  /** Prints a compact, redacted summary of the operation to the console. */
  private consoleLog(entry: DbQueryLog): void {
    const outcome = entry.error
      ? `FAILED (${entry.error.message})`
      : entry.operation === 'QUERY' ? `${entry.rowCount} rows` : 'OK';
    const subject = entry.operation === 'QUERY' ? this.stepTitle(entry.sql ?? '') : `${entry.server}/${entry.database}`;
    console.log(`\n[DB] ${entry.operation} ${subject} → ${outcome} (${entry.durationMs}ms) [${entry.db}]`);
    if (entry.params !== undefined) console.log('→ Params:', this.safeStringify(entry.params));
    if (entry.rowsAffected !== undefined) console.log('← RowsAffected:', this.safeStringify(entry.rowsAffected));
    if (entry.rows !== undefined) console.log('← Rows:', this.clip(this.safeStringify(entry.rows)).text.slice(0, 500));
  }

  /** Common fields shared by every log entry. */
  private baseEntry(operation: DbQueryLog['operation'], timestamp: string, durationMs: number): DbQueryLog {
    return {
      timestamp,
      operation,
      db: this.label(),
      server: this.serverLabel(),
      database: this.config.database,
      rowCount: null,
      durationMs,
    };
  }

  private toErrorInfo(failure: unknown, phase: 'connect' | 'query' | 'close'): NonNullable<DbQueryLog['error']> {
    return {
      message: failure instanceof Error ? failure.message : String(failure),
      code: (failure as { code?: string })?.code,
      phase,
      stack: failure instanceof Error ? failure.stack : undefined,
    };
  }

  /** Display label for steps/console: config.name when set, otherwise 'server:port/database'. */
  private label(asPrefix = false): string {
    const label = this.config.name ?? `${this.serverLabel()}/${this.config.database}`;
    return asPrefix ? (this.config.name ? `[${this.config.name}] ` : '') : label;
  }

  private serverLabel(): string {
    return `${this.config.server}${this.config.port ? `:${this.config.port}` : ''}`;
  }

  /** Collapses whitespace and caps the query text for use in step titles. */
  private stepTitle(queryText: string): string {
    const collapsed = queryText.replace(/\s+/g, ' ').trim();
    return collapsed.length > 80 ? `${collapsed.slice(0, 80)}…` : collapsed;
  }

  /** Returns the active TestInfo, or undefined when not inside a running test (test.info() throws there). */
  private currentTestInfo(): TestInfo | undefined {
    try {
      return test.info();
    } catch {
      return undefined;
    }
  }
}
