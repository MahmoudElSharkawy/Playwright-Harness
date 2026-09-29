import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { allureConfig, allureEnvironmentInfo } from './src/config/reporting';

/**
 * Run-end report plumbing, in order:
 *
 *  1. Writes `allure-results/environment.properties` from the shared
 *     `allureEnvironmentInfo`. Playwright runs globalTeardown BEFORE reporters'
 *     `onEnd`, and allure-playwright only writes this file in its `onEnd` hook —
 *     so without this write the report generated below would always be missing
 *     the Environment widget data.
 *  2. Generates the latest single-file Allure report (`allure-report/index.html`).
 *  3. Archives a timestamped copy to `reports/allure-history/<timestamp>/index.html`
 *     so past runs' reports survive the next generation. Disable via
 *     `keepHistory: false` in `src/config/reporting.ts`, or per run with
 *     ALLURE_HISTORY=false (documented opt-out, like AUTO_ALLURE_OPEN).
 *  4. Opens the latest report in the default browser (opt-out AUTO_ALLURE_OPEN=false;
 *     desktop behavior is always off on CI runners).
 *
 * Report generation/opening is a non-fatal convenience: on failure the teardown
 * warns and returns, so the run keeps the test results' own exit code — the tests
 * alone decide it, never report plumbing. (Pipelines that treat the report as a
 * mandatory artifact are guarded by their own publish step, which fails when the
 * file is missing — no exit-code coupling needed here.)
 */
module.exports = async () => {

  // --- Configuration (paths single-sourced in src/config/reporting.ts) ---
  const GENERATE_CMD = `npx allure generate ${allureConfig.resultsDir} --single-file --clean -o ${allureConfig.reportDir}`;
  const RESULTS_DIR = path.join(process.cwd(), allureConfig.resultsDir);
  const REPORT_DIR = path.join(process.cwd(), allureConfig.reportDir);
  const REPORT_FILE = path.join(REPORT_DIR, 'index.html');

  // Command to open the report file, tailored by OS
  let OPEN_CMD: string;
  switch (process.platform) {
    case 'darwin': // macOS
      OPEN_CMD = `open ${REPORT_FILE}`;
      break;
    case 'win32': // Windows
      // 'start' command needs the path in quotes
      OPEN_CMD = `start "" "${REPORT_FILE}"`;
      break;
    default: // Linux and others
      OPEN_CMD = `xdg-open ${REPORT_FILE}`;
      break;
  }

  /** Serializes the environment pairs in .properties format (backslashes and line breaks escaped). */
  const toProperties = (info: Record<string, string>): string =>
    Object.entries(info)
      .map(([key, value]) => `${key}=${String(value).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n')}`)
      .join('\n');

  /** Filesystem-safe local timestamp for the per-run archive directory name. */
  const runTimestamp = (): string => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  };

  try {
    // 1. Environment widget data — must exist before `allure generate` runs (see JSDoc)
    fs.writeFileSync(path.join(RESULTS_DIR, 'environment.properties'), toProperties(allureEnvironmentInfo) + '\n');
    console.log('\n🧾 environment.properties written to allure-results.');

    // 2. Execute Allure generate command (Synchronous)
    console.log(`🔄 Generating Allure Report single HTML file...`);
    execSync(GENERATE_CMD, { stdio: 'pipe' });
    console.log('✅ Allure report generation complete.');

    // 3. Use 'fs' and 'path' to verify the file was created
    if (!fs.existsSync(REPORT_FILE)) {
      throw new Error(`Report file not found after generation: ${REPORT_FILE}`);
    }

    // 4. Archive this run's report — its own try/catch: an archive failure must not
    //    block opening the latest report (report plumbing never fails the run)
    const keepHistory = allureConfig.keepHistory && process.env.ALLURE_HISTORY !== 'false';
    if (keepHistory) {
      try {
        const archiveDir = path.join(process.cwd(), allureConfig.historyDir, runTimestamp());
        fs.mkdirSync(archiveDir, { recursive: true });
        fs.copyFileSync(REPORT_FILE, path.join(archiveDir, 'index.html'));
        console.log(`🗂️ Report archived: ${path.relative(process.cwd(), archiveDir)}${path.sep}index.html`);
      } catch (archiveError) {
        console.warn('⚠️ Could not archive the report copy (latest report is unaffected):', archiveError);
      }
    }

    // 5. Execute command to open the HTML file (Synchronous)
    // Documented opt-out toggle; desktop behavior is additionally off on CI runners
    const autoOpenAllureReport = process.env.AUTO_ALLURE_OPEN !== 'false' && !process.env.CI; // use ($env:AUTO_ALLURE_OPEN="false") command to set it to false when needed
    if (autoOpenAllureReport) {    // Check if report should be opened (default: true)
      console.log(`\n🔄 Opening Allure Report...`);
      execSync(OPEN_CMD, { stdio: 'inherit' });
      console.log('🚀 Allure report opened in default browser.');
    }

  } catch (error) {
    console.error('\n❌ An error occurred during command execution.');
    if (error instanceof Error && 'stderr' in error) {
      console.error(`Error details: \n${(error as any).stderr.toString().trim()}`);
    } else {
      console.error(error);
    }

    // The report is a convenience — never fail the run over report plumbing.
    // Most common cause: Java missing ('allure generate' needs a JRE on the machine).
    console.warn('\n⚠️ Allure report generation failed — likely because Java is not installed (the Allure CLI requires it).');
    console.warn('⚠️ Test outcomes are unaffected; the run exits with the test results\' own status.');
    return;
  }
};
