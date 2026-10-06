import { type Page, type Locator } from '@playwright/test';
import { step } from 'allure-js-commons';
import { expectToHaveText } from '../utils/Expects.js';
import { applications } from '../config/applications.js';

export class ObservationPage {
  readonly page: Page;
  readonly url: string = applications.observation.url;

  // Locators
  private readonly observation_header: Locator;

  constructor(page: Page) {
    this.page = page;
    this.observation_header = page.locator('#observation');
  }

  ///// Actions

  async navigate() {
    await step('Open the observation page', async () => {
      await this.page.goto(this.url);
    });
  }

  ///// Validations

  async verifyObservation(expected: string) {
    await step(`Verify the observation is ${expected}`, async () => {
      await expectToHaveText('the observation heading', this.observation_header, expected);
    });
  }
}
