/** Project defaults for routine console output. Warnings and errors always log. */
export const loggingDefaults = {
  ui: false,
  expects: false,
  api: false,
  db: false,
};

/** A run can explicitly enable or disable routine output with its environment flag. */
export function infoEnabled(override: string | undefined, fallback: boolean): boolean {
  return override === undefined ? fallback : override === 'true';
}
