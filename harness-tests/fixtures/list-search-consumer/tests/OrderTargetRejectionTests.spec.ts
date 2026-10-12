import {test} from '@playwright/test';
import * as allure from 'allure-js-commons';
import {OrdersPage} from '../src/pages/OrdersPage.js';
import {readFileSync} from 'node:fs';

let ordersPage: OrdersPage;
let testData: typeof import('../resources/testData/OrderTargetRejectionTestJsonFile.json');

// Technical rejection probes: the outer node:test suite requires these attempts to fail.
test.describe('Order target rejection', () => {
  test('An absent identity cannot open a row', async () => {
    await allure.feature('Order target rejection');
    await allure.testCaseId('reject-absent');
    await ordersPage.navigate();
    await ordersPage.searchOrders(testData.tcAbsent.query);
    await ordersPage.openOrder(testData.tcAbsent.number, testData.tcAbsent.customer);
  });

  test('An ambiguous identity cannot open the first row', async () => {
    await allure.feature('Order target rejection');
    await allure.testCaseId('reject-ambiguous');
    await ordersPage.navigate();
    await ordersPage.searchOrders(testData.tcAmbiguous.query);
    await ordersPage.openOrder(testData.tcAmbiguous.number, testData.tcAmbiguous.customer);
  });

  test('A current-page filter cannot establish an off-page order', async () => {
    await allure.feature('Order target rejection');
    await allure.testCaseId('reject-limited');
    await ordersPage.navigate();
    await ordersPage.searchOrders(testData.tcLimited.query);
    await ordersPage.verifyOrderResult(testData.tcLimited.number, testData.tcLimited.customer, testData.tcLimited.status, testData.tcLimited.matches);
  });

  test.beforeAll(() => {
    testData = JSON.parse(readFileSync('./resources/testData/OrderTargetRejectionTestJsonFile.json', 'utf8'));
  });

  test.beforeEach(({page}) => {
    ordersPage = new OrdersPage(page);
  });
});
