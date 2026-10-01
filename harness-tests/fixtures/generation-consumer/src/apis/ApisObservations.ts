import { test } from '@playwright/test';
import { step } from 'allure-js-commons';
import { sourceExpectation } from 'playwright-pom-harness/scripts/lib/generation/assertion.mjs';
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
    await step('Read the configured observation', async () => {
      this.result = await this.runtimeActions.observe(definition, description);
    });
  }

  ///// Validations

  async verifyObservation(key: string, expected: string) {
    await step('Verify the response status and observation value', async () => {
      await sourceExpectation(test, key, async () => {
        await expectToEqual('the assessed response', this.result.status, expected);
      });
    });
  }
}
