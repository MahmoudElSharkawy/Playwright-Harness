import {test} from '@playwright/test';
import * as allure from 'allure-js-commons';
import {OrderPage} from '../src/pages/OrderPage';
import {DbsOrders} from '../src/dbs/DbsOrders';
import {databases} from '../src/config/databases';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';

let orderPage: OrderPage;
let dbsOrders: DbsOrders | undefined;
let testData: typeof import('../resources/testData/OrderTestJsonFile.json');
let orderToClean: {id: string; owner: string} | undefined;

test.describe('Orders', () => {
  test('Test Case 134: Submit a draft order and verify persistence', async () => {
    await allure.feature('Orders');
    await allure.testCaseId('134');
    orderToClean = {id: `${testData.tc134.idPrefix}${randomUUID()}`, owner: `${testData.tc134.ownerPrefix}${randomUUID()}`};
    const orderId = await dbsOrders!.createDraftOrder(orderToClean.id, orderToClean.owner, testData.tc134.draftStatus);
    await dbsOrders!.verifyOrderState(orderId, orderToClean.owner, testData.tc134.draftStatus, testData.tc134.expectedCount);
    await orderPage.navigate(orderId);
    await orderPage.verifyOrderIdentity(orderId);
    await orderPage.verifyOrderStatus(testData.tc134.draftStatus);
    await orderPage.submitOrder();
    await orderPage.verifyOrderStatus(testData.tc134.submittedStatus);
    await dbsOrders!.verifyOrderState(orderId, orderToClean.owner, testData.tc134.submittedStatus, testData.tc134.expectedCount);
  });

  test.beforeAll('Load test data', async () => {
    testData = JSON.parse(fs.readFileSync('./resources/testData/OrderTestJsonFile.json', 'utf8'));
  });

  test.beforeAll('Initialize database service', async () => {
    dbsOrders = new DbsOrders(databases.orders);
  });

  test.beforeEach('Reset per-test state', () => {
    orderToClean = undefined;
  });

  test.beforeEach('Initialize page objects', async ({page}) => {
    orderPage = new OrderPage(page);
  });

  test.afterEach('Clean up owned order', async () => {
    await dbsOrders?.cleanupOrderIfOwned(orderToClean);
  });

  test.afterAll('Close database connection', async () => {
    await dbsOrders?.close();
  });
});
