import GenerationReporter from '../generation/reporter.cjs';
import HarnessAllureReporter from './allure-reporter.mjs';

/** M13's mandatory evidence collector stays separate from optional Allure delivery. */
export default class VerificationReporter {
  constructor() {this.verification = new GenerationReporter(); this.allure = new HarnessAllureReporter();}
  version() {return 'v2';}
  onConfigure(config) {this.config = config; this.allure.onConfigure(config);}
  onBegin(suite) {this.verification.onBegin(this.config, suite); this.allure.onBegin(suite);}
  onTestBegin(test, result) {this.allure.onTestBegin(test, result);}
  onStepBegin(test, result, step) {this.allure.onStepBegin(test, result, step);}
  onStepEnd(test, result, step) {this.verification.onStepEnd(test, result, step); this.allure.onStepEnd(test, result, step);}
  async onTestEnd(test, result) {this.verification.onTestEnd(test, result); await this.allure.onTestEnd(test, result);}
  onError(error) {this.verification.onError(error); this.allure.onError(error);}
  async onEnd(result) {this.verification.onEnd(result); await this.allure.onEnd(result);}
  printsToStdio() {return false;}
}
