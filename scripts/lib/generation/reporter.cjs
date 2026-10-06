// Verification receipt only: no HTML, Allure or verdict recomputation.
const {writeFileSync} = require('node:fs');
const {relative} = require('node:path');
// Public reporter steps prove case-level assertion execution, not source coverage.
function assertionEvidence(steps) {
  const assertions = {passed: 0, failed: 0};
  let skippedSteps = 0;
  const skips = nodes => {for (const step of nodes) {
    skippedSteps += (step.annotations ?? []).filter(annotation => annotation.type === 'skip').length;
    skips(step.steps ?? []);
  }};
  const visit = (nodes, lifecycle = false) => {for (const step of nodes) {
    const inLifecycle = lifecycle || ['hook', 'fixture'].includes(step.category);
    if (step.category !== 'expect') {visit(step.steps ?? [], inLifecycle); continue;}
    // An outer expect owns polling/toPass attempts: only its final outcome counts.
    // Ordinary helper containers do not hide caught assertion failures.
    const probe = /^Probe(?:\s|$)/.test(step.title) && /(?:^|\/)utils\//.test((step.location?.file ?? '').replaceAll('\\', '/'));
    if (step.duration < 0 || !Number.isFinite(step.duration) || probe) continue;
    if (step.error) assertions.failed++;
    else if (!inLifecycle) assertions.passed++;
  }};
  skips(steps); visit(steps);
  return {assertions, skippedSteps};
}
class GenerationReporter {
  constructor() {this.report = {version: 2, invocation: process.env.HARNESS_GENERATION_INVOCATION, tests: [], errors: 0};}
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
  onTestEnd(test, result) {
    const record = this.report.tests.find(item => item.id === test.id);
    if (!record) {this.report.errors++; return;}
    record.expectedStatus = test.expectedStatus;
    record.results.push({status: result.status, retry: result.retry, errors: result.errors.length, ...assertionEvidence(result.steps)});
  }
  onError() {this.report.errors++;}
  onEnd(result) {
    this.report.status = result.status;
    writeFileSync(process.env.HARNESS_GENERATION_RECEIPT, JSON.stringify(this.report), {flag: 'wx', mode: 0o600, flush: true});
  }
  printsToStdio() {return false;}
}
module.exports = GenerationReporter;
