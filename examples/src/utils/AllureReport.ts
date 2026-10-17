import type { TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import AllureReporter from 'allure-playwright';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { allureConfig } from '../config/reporting';

/** Records locator-bearing Allure steps and generates HTML after every reporter has flushed. */
export default class AllureReport extends AllureReporter {
  private readonly stepViews = new WeakMap<TestStep, TestStep>();
  private reportJob?: Promise<void>;

  /** Keeps stable step identities and parents for Allure without changing native events. */
  private allureStep(step: TestStep): TestStep {
    let view = this.stepViews.get(step);
    if (!view) {
      view = { ...step };
      this.stepViews.set(step, view);
    }
    const locator = step.params?.locator;
    const appendLocator = ['pw:api', 'expect'].includes(step.category)
      && typeof locator === 'string' && locator.length > 0 && !step.title.endsWith(` ${locator}`);
    Object.assign(view, step, {
      title: appendLocator ? `${step.title} ${locator}` : step.title,
      parent: step.parent ? this.allureStep(step.parent) : undefined,
    });
    return view;
  }

  /** Preserves native events while supplying locator-bearing titles to the official reporter. */
  onStepBegin(test: TestCase, result: TestResult, step: TestStep): void {
    super.onStepBegin(test, result, this.allureStep(step));
  }

  /** Refreshes completed metadata on the same Allure view, including errors and attachments. */
  onStepEnd(test: TestCase, result: TestResult, step: TestStep): void {
    super.onStepEnd(test, result, this.allureStep(step));
  }

  /** Native onExit runs after all onEnd hooks, including Allure's environment output. */
  async onExit(): Promise<void> {
    this.reportJob ??= this.finishReport();
    await this.reportJob;
  }

  /** One canonical history report; reporting errors never replace native test outcomes. */
  private async finishReport(): Promise<void> {
    try {
      await super.onExit();
      const helper = await import(pathToFileURL(require.resolve('playwright-pom-harness/scripts/lib/reporting/allure.mjs')).href);
      const roots = {projectRoot: process.cwd()};
      const run = helper.reserveAllureReport(roots, {historyRoot: process.env.HARNESS_ALLURE_HISTORY ?? allureConfig.historyDir});
      helper.captureAllureResults(roots, run.directory, this.options.resultsDir ?? allureConfig.resultsDir);
      const receipt = await helper.generateAllure(roots, run.directory, {configuration: allureConfig.generatorConfig});
      if (receipt.status !== 'GENERATED') throw new Error('Allure report generation failed.');
      if (receipt.latest?.status === 'FAILED') console.warn(receipt.latest.reason);
      if (process.env.AUTO_ALLURE_OPEN !== 'false' && !process.env.CI) {
        const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        const reportFile = path.resolve(roots.projectRoot, receipt.artifact.path);
        const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', pathToFileURL(reportFile).href] : [reportFile];
        execFileSync(command, args, { stdio: 'ignore', windowsHide: true, timeout: 15000 });
      }
    } catch {
      console.warn('Allure report generation or opening failed; test outcomes are unchanged.');
    }
  }
}
