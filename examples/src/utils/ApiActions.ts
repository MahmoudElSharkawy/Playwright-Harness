import { test, type APIRequestContext, type APIResponse, type TestInfo } from '@playwright/test';
import { loggingDefaults } from '../config/logging.js';
import { Logger } from './Logger.js';

type FetchOptions = NonNullable<Parameters<APIRequestContext['fetch']>[1]>;

/** Options accepted by the verb helpers (get/post/...). `method` is set by the helper itself. */
export type ApiRequestOptions = Omit<FetchOptions, 'method'>;

interface ApiRequestLog {
  /** ISO timestamp captured when the request started. */
  timestamp: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody?: unknown;
  /** null when the request failed before a response was received. */
  status: number | null;
  statusText?: string;
  responseHeaders: Record<string, string>;
  responseBody?: unknown;
  /** Time until response headers were received (body read time excluded). */
  durationMs: number;
  error?: { message: string; stack?: string };
}

export interface ApiActionsOptions {
  /** Override routine HTTP logging for this instance. */
  consoleLogs?: boolean;
  /** Max characters of any attached body before truncation. Default 50000. */
  maxBodyLength?: number;
  /** Set false to disable redaction of credential headers/body keys in report attachments. Default true. */
  redact?: boolean;
  /**
   * Replace the ENTIRE response body with '***' in attachments.
   * For endpoints whose raw body IS a secret (e.g. a token endpoint returning a bare
   * JWT) — key-based redaction cannot see inside a raw string. Default false.
   */
  redactResponseBody?: boolean;
  /**
   * Supplies the bearer token injected as the Authorization header on every call
   * (a call that sets its own Authorization header wins over the provider). The
   * token is fetched lazily on first use, cached for the facade's lifetime, and
   * refreshed exactly once when a response comes back 401 — the request is then
   * replayed with the fresh token, and any second 401 is the real outcome. The
   * provider must not route its own request through this instance (use a separate
   * ApiActions for the token endpoint, or it would recurse on a 401).
   */
  bearerTokenProvider?: () => Promise<string>;
}

const REDACTED_HEADERS = new Set([
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'api-key', 'x-auth-token',
]);
const REDACTED_BODY_KEYS = new Set([
  'password', 'token', 'access_token', 'refresh_token', 'client_secret', 'secret', 'apikey', 'api_key',
]);
const TEXTUAL_CONTENT = /json|text|xml|html|x-www-form-urlencoded|csv|javascript/i;

/**
 * Logging facade over APIRequestContext.
 *
 * Playwright (as of 1.62) only surfaces API request/response payloads in the
 * Trace Viewer — never in the HTML/Allure reports (microsoft/playwright#35980
 * was declined). This wrapper fills that gap: every call becomes a test step
 * with `Request details` / `Response details` / `Response body` attachments
 * nested inside it, visible in the Allure and HTML reports alike.
 *
 * Attachments must be created via `test.info().attach()` from inside the step
 * body — allure-playwright nests those in the step, whereas `step.attach()`
 * ends up outside the step in the Allure report.
 *
 * Reporting is strictly best-effort: no logging failure can alter the outcome
 * of the request itself, and everything works (minus attachments) outside a
 * running test, e.g. in global setup.
 *
 * Optional bearer auth: configure `bearerTokenProvider` and the facade owns the
 * token lifecycle — lazy single-flight fetch, per-instance cache, one refresh +
 * replay on 401 (see ApiActionsOptions.bearerTokenProvider).
 */
export class ApiActions {
  private readonly maxBodyLength: number;
  /**
   * The cached bearer-token fetch from `bearerTokenProvider` — the facade's only
   * auth state, analogous to DbActions' lazy pool: storing the in-flight promise
   * makes the first fetch single-flight, and clearing the field invalidates the
   * cache (done on a fetch failure and on a 401 refresh).
   */
  private bearerToken?: Promise<string>;

  constructor(private readonly request: APIRequestContext, private readonly options: ApiActionsOptions = {}) {
    this.maxBodyLength = options.maxBodyLength ?? 50_000;
  }

  /** Sends a GET request and logs it as a report step with attachments. */
  async get(url: string, options?: ApiRequestOptions): Promise<APIResponse> {
    return this.dispatch('GET', url, options);
  }

  /** Sends a POST request and logs it as a report step with attachments. */
  async post(url: string, options?: ApiRequestOptions): Promise<APIResponse> {
    return this.dispatch('POST', url, options);
  }

  /** Sends a PUT request and logs it as a report step with attachments. */
  async put(url: string, options?: ApiRequestOptions): Promise<APIResponse> {
    return this.dispatch('PUT', url, options);
  }

  /** Sends a PATCH request and logs it as a report step with attachments. */
  async patch(url: string, options?: ApiRequestOptions): Promise<APIResponse> {
    return this.dispatch('PATCH', url, options);
  }

  /** Sends a DELETE request and logs it as a report step with attachments. */
  async delete(url: string, options?: ApiRequestOptions): Promise<APIResponse> {
    return this.dispatch('DELETE', url, options);
  }

  /** Sends a HEAD request and logs it as a report step with attachments. */
  async head(url: string, options?: ApiRequestOptions): Promise<APIResponse> {
    return this.dispatch('HEAD', url, options);
  }

  /** Sends a request with an arbitrary method (defaults to GET, like APIRequestContext.fetch) and logs it. */
  async fetch(url: string, options?: FetchOptions): Promise<APIResponse> {
    return this.dispatch(options?.method?.toUpperCase() ?? 'GET', url, options);
  }

  /**
   * Routes a call through a named `test.step` when inside a test; runs it plainly
   * (no step/attachments) otherwise. With a `bearerTokenProvider` configured, the
   * cached token is injected first, and a 401 response triggers one token refresh
   * plus a replay as a sibling step — safe for every verb, since a 401 rejection
   * happens before the server processes the request.
   */
  private async dispatch(method: string, url: string, options?: FetchOptions): Promise<APIResponse> {
    const run = async (): Promise<APIResponse> => {
      const authedOptions = await this.withBearerToken(options);
      const inTest = this.currentTestInfo() !== undefined;
      if (!inTest) return this.execute(method, url, authedOptions, false);
      return test.step(`${method} ${url}`, () => this.execute(method, url, authedOptions, true));
    };

    let response = await run();
    if (response.status() === 401 && this.options.bearerTokenProvider && !this.hasExplicitAuthorization(options)) {
      Logger.warn('API', 'Refreshing bearer token after HTTP 401');
      this.bearerToken = undefined; // drop the stale token; the replay fetches a fresh one
      response = await run();
    }
    return response;
  }

  /**
   * Returns the options with the provider's bearer token merged into the headers.
   * The fetch is lazy and single-flight (concurrent first calls await the same
   * provider call); a failed fetch clears the cache so the next call can retry.
   * No-op without a provider, or when the call carries its own Authorization header.
   */
  private async withBearerToken(options?: FetchOptions): Promise<FetchOptions | undefined> {
    const provider = this.options.bearerTokenProvider;
    if (!provider || this.hasExplicitAuthorization(options)) return options;
    if (!this.bearerToken) {
      this.bearerToken = Promise.resolve().then(() => provider()).catch((err) => {
        this.bearerToken = undefined;
        Logger.error('API', 'Bearer token provider failed');
        throw err;
      });
    }
    const token = await this.bearerToken;
    return { ...options, headers: { ...options?.headers, authorization: `Bearer ${token}` } };
  }

  /** True when the caller set an Authorization header explicitly (any casing) — the provider then stays out of the call. */
  private hasExplicitAuthorization(options?: FetchOptions): boolean {
    return Object.keys(options?.headers ?? {}).some((key) => key.toLowerCase() === 'authorization');
  }

  /** Fires the request, measures duration, builds the log entry, reports it, then returns the response or rethrows the failure. */
  private async execute(method: string, url: string, options: FetchOptions | undefined, attach: boolean): Promise<APIResponse> {
    const timestamp = new Date().toISOString();
    const start = Date.now();
    let response: APIResponse | undefined;
    let failure: { cause: unknown } | undefined;

    try {
      response = await this.request.fetch(url, { ...options, method });
    } catch (err) {
      failure = { cause: err };
    }
    const durationMs = Date.now() - start;

    const entry: ApiRequestLog = {
      timestamp,
      method,
      url,
      requestHeaders: this.redactHeaders(options?.headers ?? {}),
      requestBody: this.redactDeep(this.extractRequestBody(options)),
      status: response ? response.status() : null,
      statusText: response?.statusText(),
      responseHeaders: response ? this.redactHeaders(response.headers()) : {},
      durationMs,
    };
    if (response) {
      entry.responseBody = this.options.redactResponseBody
        ? '***'
        : this.redactDeep(await this.readBodySafely(response));
    }
    if (failure) {
      const { cause } = failure;
      entry.error = {
        message: cause instanceof Error ? cause.message : String(cause),
        stack: cause instanceof Error ? cause.stack : undefined,
      };
    }

    await this.report(entry, attach);

    if (failure) throw failure.cause;
    if (!response) throw new Error(`${method} ${url} failed without a response`);
    return response;
  }

  /** Best-effort reporting — must never throw, so it can never mask the request's own outcome. */
  private async report(entry: ApiRequestLog, attach: boolean): Promise<void> {
    const target = `${entry.method} ${this.logPath(entry.url)}`;
    try {
      if (entry.status === null) {
        const message = entry.error?.message;
        const reason = typeof message === 'string' ? message.split(/[\r\n]/, 1)[0] : undefined;
        Logger.error('API', `${target} failed${reason ? `: ${reason}` : ''} (${entry.durationMs} ms)`);
      } else if (this.shouldConsoleLog()) {
        Logger.info('API', `${target} returned HTTP ${entry.status} (${entry.durationMs} ms)`);
      }

      if (!attach) return;
      await this.attachJson('Request details', {
        timestamp: entry.timestamp,
        method: entry.method,
        url: entry.url,
        headers: entry.requestHeaders,
        body: entry.requestBody,
      });
      if (entry.status !== null) {
        await this.attachJson('Response details', {
          status: entry.status,
          statusText: entry.statusText,
          durationMs: entry.durationMs,
          headers: entry.responseHeaders,
        });
        await this.attachJson('Response body', entry.responseBody ?? null);
      } else {
        await this.attachJson('Request error', {
          durationMs: entry.durationMs,
          error: entry.error,
        });
      }
    } catch {
      Logger.warn('API', `Could not attach ${target} details to the report`);
    }
  }

  /** Use the URL path as the request target, without the host or query string. */
  private logPath(url: string): string {
    try {
      return new URL(url, 'http://localhost').pathname;
    } catch {
      return '(invalid URL)';
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

  /**
   * Reads the body exactly once (each APIResponse body call re-transfers the
   * payload), skips clearly binary content, and never throws — a body-read
   * failure must not fail a request that already succeeded.
   */
  private async readBodySafely(response: APIResponse): Promise<unknown> {
    const contentType = response.headers()['content-type'] ?? '';
    if (contentType && !TEXTUAL_CONTENT.test(contentType)) {
      const length = response.headers()['content-length'];
      return `<binary body omitted: ${contentType}${length ? `, ${length} bytes` : ''}>`;
    }
    try {
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (err) {
      return `<body could not be read: ${err instanceof Error ? err.message : String(err)}>`;
    }
  }

  /** Picks the request body out of the options (`data`, `form`, or `multipart`), summarizing raw Buffers. */
  private extractRequestBody(options?: FetchOptions): unknown {
    const body = options?.data ?? options?.form ?? options?.multipart;
    if (Buffer.isBuffer(body)) return `<Buffer ${body.length} bytes>`;
    return body;
  }

  /** Masks credential headers (Authorization, Cookie, API keys, ...) with `***`. */
  private redactHeaders(headers: Record<string, string>): Record<string, string> {
    if (this.options.redact === false) return { ...headers };
    return Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k, REDACTED_HEADERS.has(k.toLowerCase()) ? '***' : v]),
    );
  }

  /** Recursively masks secret-like keys (password, token, ...) in plain objects/arrays, up to 6 levels deep. */
  private redactDeep(value: unknown, depth = 0): unknown {
    if (this.options.redact === false || value === null || typeof value !== 'object' || depth > 6) return value;
    if (Array.isArray(value)) return value.map(v => this.redactDeep(v, depth + 1));
    if (Object.getPrototypeOf(value) !== Object.prototype) return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) =>
        [k, REDACTED_BODY_KEYS.has(k.toLowerCase()) ? '***' : this.redactDeep(v, depth + 1)],
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

  /** The constructor option, environment and project metadata can override the file default, in that order. */
  private shouldConsoleLog(): boolean {
    if (this.options.consoleLogs !== undefined) return this.options.consoleLogs;
    if (process.env.API_CONSOLE_LOGS) return process.env.API_CONSOLE_LOGS === 'true';
    return Boolean(this.currentTestInfo()?.project.metadata?.apiConsoleLogs ?? loggingDefaults.api);
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
