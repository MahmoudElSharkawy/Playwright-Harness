import {existsSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {consumerRoots} from '../consumer-paths.mjs';
import {reserveAllureReport, readAllureRun} from './history.mjs';
import {installedAllure, allureInventory} from './allure.mjs';
import {validateAllureLinks} from '../convention-source.mjs';

/** Concrete optional adapter for the installed official Allure reporter, not a verdict engine. */
export default class HarnessAllureReporter {
  constructor(options = {}) {
    this.failed = false; this.tests = 0; this.stepViews = new WeakMap();
    try {
      this.roots = consumerRoots(); this.attachVideo = options.attachVideo ?? process.env.ALLURE_ATTACH_VIDEO === 'true';
      const reserved = process.env.HARNESS_ALLURE_DIRECTORY;
      const run = reserved ? readAllureRun(this.roots, reserved, process.env.HARNESS_GENERATION_INVOCATION)
        : reserveAllureReport(this.roots, {directory: options.directory, historyRoot: options.historyRoot});
      this.path = run.path; this.directory = run.directory;
      mkdirSync(join(this.path, 'allure-results'), {mode: 0o700});
      const installed = installedAllure(this.roots, 'allure-playwright');
      if (installed.version !== '3.13.0') throw new Error('Unsupported Allure reporter.');
      this.reporter = installed.version;
      let Reporter = installed.require(installed.entry).default;
      // Reuse the consumer's maintained reporter; scoped forwarding never calls its onExit.
      const consumerReporter = join(this.roots.projectRoot, 'src/utils/AllureReport.ts');
      if (existsSync(consumerReporter)) {
        const configuredReporter = installed.require(consumerReporter).default;
        if (typeof configuredReporter.prototype.version === 'function') Reporter = configuredReporter;
      }
      const linkInput = options.links ?? (process.env.HARNESS_ALLURE_LINKS ? JSON.parse(process.env.HARNESS_ALLURE_LINKS) : undefined);
      const links = linkInput === undefined ? undefined : validateAllureLinks(linkInput);
      this.delegate = new Reporter({resultsDir: join(this.path, 'allure-results'), detail: true, suiteTitle: true,
        attachVideo: this.attachVideo,
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
      const pending = this.delegate?.[method]?.(...args);
      if (pending?.then) return new Promise(resolve => {
        const timer = setTimeout(() => {this.failed = true; resolve();}, 5000);
        Promise.resolve(pending).then(() => {clearTimeout(timer); resolve();}, () => {clearTimeout(timer); this.failed = true; resolve();});
      });
    } catch {this.failed = true;}
  }
  onConfigure(config) {this.forward('onConfigure', [config]);}
  attachments(view) {
    return this.attachVideo || !view?.attachments ? view : {...view, attachments: view.attachments.filter(item => !item.contentType.startsWith('video/'))};
  }
  stepView(step) {
    let view = this.stepViews.get(step);
    if (!view) {view = {...step}; this.stepViews.set(step, view);}
    Object.assign(view, this.attachments(step), {parent: step.parent ? this.stepView(step.parent) : undefined});
    return view;
  }
  onBegin(suite) {this.forward('onBegin', [suite]);}
  onTestBegin(test, result) {this.forward('onTestBegin', [test, result]);}
  onStepBegin(test, result, step) {this.forward('onStepBegin', [test, result, this.stepView(step)]);}
  onStepEnd(test, result, step) {this.forward('onStepEnd', [test, result, this.stepView(step)]);}
  async onTestEnd(test, result) {this.tests++; await this.forward('onTestEnd', [test, this.attachments(result)]);}
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
