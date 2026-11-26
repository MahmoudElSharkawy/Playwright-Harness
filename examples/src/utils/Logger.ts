import { styleText } from 'node:util';

/** Writes one best-effort console line with a colored severity label. */
export class Logger {
  static info(source: string, message: string): void {
    this.write('info', 'cyan', source, message);
  }

  static warn(source: string, message: string): void {
    this.write('warn', 'yellow', source, message);
  }

  static error(source: string, message: string): void {
    this.write('error', 'red', source, message);
  }

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
