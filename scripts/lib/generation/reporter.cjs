// Verification receipt only: no HTML, Allure or verdict recomputation.
const {writeFileSync} = require('node:fs');
const {relative} = require('node:path');
const PREFIX = 'harness:expectation:';
class GenerationReporter {
  constructor() {this.report = {version: 1, invocation: process.env.HARNESS_GENERATION_INVOCATION, tests: [], errors: 0}; this.results = new WeakMap();}
  onBegin(config, suite) {
    this.report.workers = config.workers;
    this.report.forbidOnly = config.forbidOnly;
    this.report.tests = suite.allTests().map(test => {
      const titlePath = []; let parent = test.parent;
      while (parent) {if (parent.type === 'describe') titlePath.unshift(parent.title); parent = parent.parent;}
      titlePath.push(test.title);
      return {id: test.id, spec: relative(process.cwd(), test.location.file).replaceAll('\\', '/'),
        nativeFile: relative(config.rootDir, test.location.file).replaceAll('\\', '/'), project: test.parent.project().name,
        titlePath, expectedStatus: test.expectedStatus, retries: test.retries, repeatEachIndex: test.repeatEachIndex, results: []};
    });
  }
  onStepEnd(test, result, step) {
    if (!step.title.startsWith(PREFIX)) return;
    // A native expect.poll/web-first expectation owns its internal observations;
    // its terminal outcome decides that assertion. User helper/step boundaries do
    // not: recurse through them so catching a failed assertion cannot erase it.
    const count = node => node.category === 'expect' ? 1 : node.steps.reduce((total, child) => total + count(child), 0);
    const assertionFailed = node => node.category === 'expect' ? !!node.error : node.steps.some(assertionFailed);
    const rows = this.results.get(result) ?? []; rows.push({key: step.title.slice(PREFIX.length), assertions: count(step), failed: !!step.error || assertionFailed(step)}); this.results.set(result, rows);
  }
  onTestEnd(test, result) {
    const record = this.report.tests.find(item => item.id === test.id);
    if (!record) {this.report.errors++; return;}
    record.expectedStatus = test.expectedStatus;
    record.results.push({status: result.status, retry: result.retry, errors: result.errors.length, expectations: this.results.get(result) ?? []});
  }
  onError() {this.report.errors++;}
  onEnd(result) {
    this.report.status = result.status;
    writeFileSync(process.env.HARNESS_GENERATION_RECEIPT, JSON.stringify(this.report), {flag: 'wx', mode: 0o600, flush: true});
  }
  printsToStdio() {return false;}
}
module.exports = GenerationReporter;
