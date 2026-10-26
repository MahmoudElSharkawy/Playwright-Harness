import {type Page, type Locator} from '@playwright/test';
import {step} from 'allure-js-commons';
import {expectToHaveText} from '../utils/Expects';

export class OrderPage {
  readonly page: Page;
  readonly url = '/orders';

  // Locators
  private readonly submit_button: Locator;
  private readonly status_txt: Locator;
  private readonly identifier_txt: Locator;

  constructor(page: Page) {
    this.page = page;
    this.submit_button = page.locator('#submit');
    this.status_txt = page.locator('#status');
    this.identifier_txt = page.locator('#order-id');
  }

  ///// Actions

  async navigate(orderId: string): Promise<void> {
    await step(`Navigate to order: ${orderId}`, async () => {
      await this.page.goto(`${this.url}/${encodeURIComponent(orderId)}`);
    });
  }

  async submitOrder(): Promise<void> {
    await step('Submit the draft order', async () => {
      await this.submit_button.click();
    });
  }

  ///// Validations

  async verifyOrderIdentity(expectedOrderId: string): Promise<void> {
    await step(`Verify order identity: ${expectedOrderId}`, async () => {
      await expectToHaveText('the displayed order identifier', this.identifier_txt, expectedOrderId);
    });
  }

  async verifyOrderStatus(expectedStatus: string): Promise<void> {
    await step(`Verify order status: ${expectedStatus}`, async () => {
      await expectToHaveText('the displayed order status', this.status_txt, expectedStatus);
    });
  }
}
