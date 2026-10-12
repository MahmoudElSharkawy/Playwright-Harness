import {type Page, type Locator} from '@playwright/test';
import {step} from 'allure-js-commons';
import {expectToHaveCount, expectToHaveText} from '../utils/Expects.js';

export class OrdersPage {
  readonly page: Page;
  readonly url: string = '/orders';

  // Locators
  private readonly search_input: Locator;
  private readonly search_button: Locator;
  private readonly searchComplete_msg: Locator;
  private readonly orderRows_row: Locator;
  private readonly orderNumbers_cell: Locator;
  private readonly customers_cell: Locator;
  private readonly statuses_cell: Locator;
  private readonly nextOrders_button: Locator;
  private readonly pageNumber_txt: Locator;
  private readonly openedNumber_txt: Locator;
  private readonly openedCustomer_txt: Locator;

  constructor(page: Page) {
    this.page = page;
    this.search_input = page.locator('#order-search');
    this.search_button = page.locator('#search-orders');
    this.searchComplete_msg = page.locator('#search-complete');
    this.orderRows_row = page.locator('#orders-table tbody tr:visible');
    this.orderNumbers_cell = page.locator('[data-qa="order-number"]');
    this.customers_cell = page.locator('[data-qa="customer"]');
    this.statuses_cell = page.locator('[data-qa="status"]');
    this.nextOrders_button = page.locator('#next-orders');
    this.pageNumber_txt = page.locator('#page-number');
    this.openedNumber_txt = page.locator('#opened-number');
    this.openedCustomer_txt = page.locator('#opened-customer');
  }

  private order_row(orderNumber: string, customer: string): Locator {
    return this.orderRows_row
      .filter({has: this.orderNumbers_cell.filter({hasText: new RegExp(`^${RegExp.escape(orderNumber)}$`)})})
      .filter({has: this.customers_cell.filter({hasText: new RegExp(`^${RegExp.escape(customer)}$`)})});
  }

  private completedSearch_msg(query: string): Locator {
    return this.searchComplete_msg.filter({hasText: new RegExp(`^${RegExp.escape(query)}$`)});
  }

  private openOrder_button(orderNumber: string, customer: string): Locator {
    return this.order_row(orderNumber, customer).locator('[data-qa="open-order"]');
  }

  ///// Actions

  async navigate(): Promise<void> {
    await step('Navigate to orders', async () => {
      await this.page.goto(this.url);
    });
  }

  async searchOrders(query: string): Promise<void> {
    await step(`Search orders for ${query}`, async () => {
      await this.search_input.fill(query);
      await this.search_button.click();
      await this.completedSearch_msg(query).waitFor({state: 'visible'});
    });
  }

  async openOrder(orderNumber: string, customer: string): Promise<void> {
    await step(`Open order ${orderNumber} for customer ${customer}`, async () => {
      await this.openOrder_button(orderNumber, customer).click();
    });
  }

  async browseNextOrdersPage(): Promise<void> {
    await step('Browse the next orders page', async () => {
      await this.nextOrders_button.click();
    });
  }

  ///// Validations

  async verifyOrderResult(orderNumber: string, customer: string, expectedStatus: string, expectedMatches: number): Promise<void> {
    await step(`Verify order ${orderNumber} for customer ${customer} has status ${expectedStatus}`, async () => {
      const row = this.order_row(orderNumber, customer);
      await expectToHaveCount('the matching order identities', row, expectedMatches);
      await expectToHaveText('the matching order number', row.locator(this.orderNumbers_cell), orderNumber);
      await expectToHaveText('the matching customer identifier', row.locator(this.customers_cell), customer);
      await expectToHaveText('the matching order status', row.locator(this.statuses_cell), expectedStatus);
    });
  }

  async verifyMatchingOrderCount(orderNumber: string, customer: string, expectedMatches: number): Promise<void> {
    await step(`Verify ${expectedMatches} matching orders for ${orderNumber} and customer ${customer}`, async () => {
      await expectToHaveCount('the matching order identities', this.order_row(orderNumber, customer), expectedMatches);
    });
  }

  async verifyVisibleOrderCount(expectedCount: number): Promise<void> {
    await step(`Verify ${expectedCount} visible orders in the completed search`, async () => {
      await expectToHaveCount('the visible order results', this.orderRows_row, expectedCount);
    });
  }

  async verifyOrdersPage(expectedPage: string): Promise<void> {
    await step(`Verify orders page ${expectedPage}`, async () => {
      await expectToHaveText('the orders page number', this.pageNumber_txt, expectedPage);
    });
  }

  async verifyOpenedOrder(orderNumber: string, customer: string): Promise<void> {
    await step(`Verify opened order ${orderNumber} for customer ${customer}`, async () => {
      await expectToHaveText('the opened order number', this.openedNumber_txt, orderNumber);
      await expectToHaveText('the opened customer identifier', this.openedCustomer_txt, customer);
    });
  }
}
