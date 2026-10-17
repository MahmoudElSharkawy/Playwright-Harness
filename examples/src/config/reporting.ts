import * as os from 'node:os';

/**
 * Single source for the Allure report plumbing — consumed by `playwright.config.ts`
 * (reporter wiring), `global-setup.ts` and `utils/AllureReport.ts` (after flush).
 *
 * Report output contract (design-conventions): the human-readable copies of these
 * paths — the runbook's report table and the CI artifact steps — cannot read this
 * file; update them in lockstep with any change here.
 */
export const allureConfig = {
  /** Raw results dir, explicitly passed through allure-playwright's resultsDir option. */
  resultsDir: 'allure-results',
  /** Explicit Allure 3 config; no Java, remote publishing or verdict overrides. */
  generatorConfig: 'allurerc.json',
  /** One native report per run: `<historyDir>/<UTC timestamp>/index.html`; latest.html links to it. */
  historyDir: 'reports/allure-history',
} as const;

/**
 * Environment table shown in the Allure report's Environment widget.
 *
 * allure-playwright writes these pairs during onEnd. AllureReport generates the
 * HTML during onExit, after that flush, without duplicating environment files.
 */
export const allureEnvironmentInfo: Record<string, string> = {
  os_platform: os.platform(),
  os_release: os.release(),
  os_version: os.version(),
  node_version: process.version,
};
