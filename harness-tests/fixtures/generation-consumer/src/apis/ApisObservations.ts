import { step } from 'allure-js-commons';
import { RuntimeActions } from '../utils/RuntimeActions.js';
import { expectToEqual } from '../utils/Expects.js';

export class ApisObservations {
  private readonly runtimeActions: RuntimeActions;
  private result: any;

  constructor() {
    this.runtimeActions = new RuntimeActions();
  }

  ///// Actions

  async observe(definition: any, description: string) {
    await step(`Read API observation: ${description}`, async () => {
      this.result = await this.runtimeActions.observe(definition, description);
    });
  }

  ///// Validations

  async verifyObservation(expected: string) {
    await step(`Verify API observation has assessed status ${expected}`, async () => {
      await expectToEqual('the assessed response', this.result.status, expected);
    });
  }
}
