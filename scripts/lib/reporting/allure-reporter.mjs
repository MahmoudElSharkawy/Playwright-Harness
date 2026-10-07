import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {consumerRoots} from '../consumer-paths.mjs';
import {reportDirectory} from './index.mjs';
import {installedAllure, allureInventory} from './allure.mjs';
import {validateAllureLinks} from '../convention-source.mjs';
import {createAllureStepView} from '../../../examples/src/utils/allure-step-titles.cjs';

/** Concrete optional adapter for the installed official Allure reporter, not a verdict engine. */
export default class HarnessAllureReporter {
  allureStep = createAllureStepView();
  constructor(options = {}) {
    this.failed = false; this.tests = 0;
    try {
      this.roots = consumerRoots();
      this.path = reportDirectory(this.roots, options.directory ?? process.env.HARNESS_ALLURE_DIRECTORY ?? `reports/allure/${randomUUID()}`);
      const installed = installedAllure(this.roots, 'allure-playwright');
      if (installed.version !== '3.13.0') throw new Error('Unsupported Allure reporter.');
      this.reporter = installed.version;
      const Reporter = installed.require(installed.entry).default;
      const linkInput = options.links ?? (process.env.HARNESS_ALLURE_LINKS ? JSON.parse(process.env.HARNESS_ALLURE_LINKS) : undefined);
      const links = linkInput === undefined ? undefined : validateAllureLinks(linkInput);
      this.delegate = new Reporter({resultsDir: join(this.path, 'allure-results'), detail: true, suiteTitle: true,
        ...(links === undefined ? {} : {links}),
        environmentInfo: {node_version: process.version, result_source: 'Native Playwright Test; harness execution verdicts are attached separately'}});
      if (this.delegate.version() !== 'v2') throw new Error('Unsupported native reporter interface.');
    } catch {this.failed = true;}
  }
  version() {return 'v2';}
  // Do not delegate preprocessing/test-plan filters: a reporter cannot change selected scope.
  forward(method, args) {
    if (this.failed) return;
    try {
      if (method === 'onStepBegin' || method === 'onStepEnd') args = [args[0], args[1], this.allureStep(args[2])];
      const pending = this.delegate?.[method]?.(...args);
      if (pending?.then) return new Promise(resolve => {
        const timer = setTimeout(() => {this.failed = true; resolve();}, 5000);
        Promise.resolve(pending).then(() => {clearTimeout(timer); resolve();}, () => {clearTimeout(timer); this.failed = true; resolve();});
      });
    } catch {this.failed = true;}
  }
  onConfigure(config) {this.forward('onConfigure', [config]);}
  onBegin(suite) {this.forward('onBegin', [suite]);}
  onTestBegin(test, result) {this.forward('onTestBegin', [test, result]);}
  onStepBegin(test, result, step) {this.forward('onStepBegin', [test, result, step]);}
  onStepEnd(test, result, step) {this.forward('onStepEnd', [test, result, step]);}
  async onTestEnd(test, result) {this.tests++; await this.forward('onTestEnd', [test, result]);}
  onError(error) {this.forward('onError', [error]);}
  async onEnd(result) {
    await this.forward('onEnd', [result]);
    try {
      const artifacts = this.failed ? [] : allureInventory(join(this.path, 'allure-results'));
      const tests = artifacts.filter(item => item.path.endsWith('-result.json')).length;
      if (!this.tests || tests !== this.tests) this.failed = true;
      writeFileSync(join(this.path, 'capture.json'), JSON.stringify({version: 1, source: 'playwright-native', status: this.failed ? 'FAILED' : 'CAPTURED',
        nativeStatus: result.status, tests: this.tests, reporter: this.reporter ?? 'unavailable', artifacts}, null, 2), {flag: 'wx', mode: 0o600, flush: true});
    } catch {this.failed = true;}
    if (this.failed) console.warn('Harness Allure capture unavailable; native test outcomes are unchanged.');
  }
  printsToStdio() {return false;}
}
