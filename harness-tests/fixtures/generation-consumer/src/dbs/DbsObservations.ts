import { test } from '@playwright/test';
import { step } from 'allure-js-commons';
import { sourceExpectation } from 'playwright-pom-harness/scripts/lib/generation/assertion.mjs';
import { RuntimeActions } from '../utils/RuntimeActions.js';
import { expectToEqual } from '../utils/Expects.js';

export class DbsObservations {
  private readonly runtimeActions: RuntimeActions;
  private result: any;

  constructor() {
    this.runtimeActions = new RuntimeActions();
  }

  ///// Actions

  async observe(definition: any, description: string) {
    await step('Read the configured database observation', async () => {
      this.result = await this.runtimeActions.observe(definition, description);
    });
  }

  ///// Validations

  async verifyObservation(key: string, expected: string) {
    await step('Verify the row count and bound observation value', async () => {
      await sourceExpectation(test, key, async () => {
        await expectToEqual('the assessed database result', this.result.status, expected);
      });
    });
  }
}
