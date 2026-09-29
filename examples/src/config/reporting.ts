import * as os from 'node:os';

/**
 * Single source for the Allure report plumbing — consumed by `playwright.config.ts`
 * (reporter wiring) and the root lifecycle scripts `global-setup.ts` /
 * `global-teardown.ts`, so no script carries a second hardcoded copy of a path.
 *
 * Report output contract (design-conventions): the human-readable copies of these
 * paths — the runbook's report table and the CI artifact steps — cannot read this
 * file; update them in lockstep with any change here.
 */
export const allureConfig = {
  /** Raw results dir — allure-playwright v3's fixed default (its `outputFolder` key is dead). */
  resultsDir: 'allure-results',
  /** Where the latest single-file report is generated each run. */
  reportDir: 'allure-report',
  /** Per-run archive root: each run's report is copied to `<historyDir>/<timestamp>/index.html`. */
  historyDir: 'reports/allure-history',
  /**
   * Master switch for archiving a timestamped copy of every generated report.
   * Set to false to disable archiving entirely; a single run can opt out with
   * ALLURE_HISTORY=false (same documented opt-out convention as AUTO_ALLURE_OPEN).
   */
  keepHistory: true,
} as const;

/**
 * Environment table shown in the Allure report's Environment widget.
 *
 * Two consumers on purpose: `playwright.config.ts` hands it to allure-playwright,
 * which writes `allure-results/environment.properties` in its reporter `onEnd` hook —
 * but Playwright runs globalTeardown BEFORE reporters' `onEnd`, so that write lands
 * only after `global-teardown.ts` has already generated the report. The teardown
 * therefore writes the same pairs itself right before `allure generate`; the
 * reporter's later identical write keeps `allure-results/` self-consistent for
 * manual re-generation.
 */
export const allureEnvironmentInfo: Record<string, string> = {
  os_platform: os.platform(),
  os_release: os.release(),
  os_version: os.version(),
  node_version: process.version,
};
