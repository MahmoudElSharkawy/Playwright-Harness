import type { Reporter } from '@playwright/test/reporter';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { allureConfig } from '../config/reporting';

/** Generates Allure 3 after every reporter has flushed. Reporting never changes test outcomes. */
export default class AllureReport implements Reporter {
  /** Native onExit runs after all onEnd hooks, including Allure's environment output. */
  async onExit(): Promise<void> {
    try {
      const projectRoot = fs.realpathSync(process.cwd());
      const resultsDir = path.resolve(projectRoot, allureConfig.resultsDir);
      const reportDir = path.resolve(projectRoot, allureConfig.reportDir);
      const reportFile = path.join(reportDir, 'index.html');
      const relativeOutput = path.relative(projectRoot, reportDir);
      if (!relativeOutput || relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) {
        throw new Error('Report output must stay inside the consumer.');
      }
      // Validate the exact owned output before clearing a previous generated report.
      if (fs.existsSync(reportDir)) {
        if (fs.realpathSync(reportDir) !== reportDir || fs.lstatSync(reportDir).isSymbolicLink()) {
          throw new Error('Report output must not redirect.');
        }
        fs.rmSync(reportDir, { recursive: true });
      }
      const installation = path.dirname(path.dirname(require.resolve('allure')));
      const metadata = JSON.parse(fs.readFileSync(path.join(installation, 'package.json'), 'utf8'));
      if (metadata.version !== '3.19.1') throw new Error('Use the validated Allure 3 version.');
      execFileSync(process.execPath, [path.join(installation, 'cli.js'), 'generate', '.',
        '--config', path.resolve(projectRoot, allureConfig.generatorConfig), '--output', reportDir],
      { cwd: resultsDir, stdio: 'pipe', windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
      const html = fs.readFileSync(reportFile, 'utf8');
      if (!html.includes('<head>')) throw new Error('Allure generated no HTML report.');
      // The pinned Awesome template embeds analytics. Keep the single-file report offline.
      const csp = "default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; connect-src data: blob:; media-src data: blob:; frame-src data: blob:; base-uri 'self'; form-action 'none'";
      fs.writeFileSync(reportFile, html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`));

      if (allureConfig.keepHistory && process.env.ALLURE_HISTORY !== 'false') {
        try {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const archiveDir = path.resolve(projectRoot, allureConfig.historyDir, stamp);
          fs.mkdirSync(archiveDir, { recursive: true });
          fs.copyFileSync(reportFile, path.join(archiveDir, 'index.html'), fs.constants.COPYFILE_EXCL);
        } catch {
          console.warn('Could not archive the report copy; the latest report is unaffected.');
        }
      }
      if (process.env.AUTO_ALLURE_OPEN !== 'false' && !process.env.CI) {
        const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', pathToFileURL(reportFile).href] : [reportFile];
        execFileSync(command, args, { stdio: 'ignore', windowsHide: true, timeout: 15000 });
      }
    } catch {
      console.warn('Allure report generation or opening failed; test outcomes are unchanged.');
    }
  }
}
