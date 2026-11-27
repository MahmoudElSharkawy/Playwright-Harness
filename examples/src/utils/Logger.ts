import { styleText } from 'node:util';

/** Writes one best-effort console line with a colored severity label. */
export class Logger {
  /** Writes an informational line to stdout with a cyan label when color is enabled. */
  static info(source: string, message: string): void {
    this.write('info', 'cyan', source, message);
  }

  /** Writes a warning line to stderr with a yellow label when color is enabled. */
  static warn(source: string, message: string): void {
    this.write('warn', 'yellow', source, message);
  }

  /** Writes an error line to stderr with a red label when color is enabled. */
  static error(source: string, message: string): void {
    this.write('error', 'red', source, message);
  }

  /** Writes a single line, respects NO_COLOR and absorbs logging failures. */
  private static write(
    level: 'info' | 'warn' | 'error',
    color: 'cyan' | 'yellow' | 'red',
    source: string,
    message: string,
  ): void {
    try {
      const stream = level === 'info' ? process.stdout : process.stderr;
      const label = `[${level.toUpperCase()}]`;
      const prefix = process.env.NO_COLOR === undefined ? styleText(color, label, { stream }) : label;
      console[level](`${prefix} [${source}] ${message}`.replace(/[\r\n\u2028\u2029]+/g, ' '));
    } catch {
      // Logging must never replace the operation's outcome.
    }
  }
}
