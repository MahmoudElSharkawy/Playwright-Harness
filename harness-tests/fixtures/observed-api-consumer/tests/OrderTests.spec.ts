import {test} from '@playwright/test';
import * as allure from 'allure-js-commons';
import {OrderPage} from '../src/pages/OrderPage';
import {ApisOrders} from '../src/apis/ApisOrders';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';

let orderPage: OrderPage;
let apisOrders: ApisOrders | undefined;
let testData: typeof import('../resources/testData/OrderTestJsonFile.json');
let orderToClean: {id: string; owner: string} | undefined;

test.describe('Orders', () => {
  test('Test Case 119: Submit a draft order', async () => {
    await allure.feature('Orders');
    await allure.testCaseId('119');
    orderToClean = {id: `${testData.tc119.idPrefix}${randomUUID()}`, owner: `${testData.tc119.ownerPrefix}${randomUUID()}`};
    const draft = await apisOrders!.createDraftOrder(orderToClean.id, orderToClean.owner, testData.tc119.label);
    await apisOrders!.verifyDraftCreated(draft, testData.tc119.createdHttpStatus, testData.tc119.draftStatus);
    const orderId = await apisOrders!.getOrderId(draft);
    await orderPage.navigate(orderId);
    await orderPage.verifyOrderIdentity(orderId);
    await orderPage.verifyOrderStatus(testData.tc119.draftStatus);
    await orderPage.submitOrder();
    await orderPage.verifyOrderStatus(testData.tc119.submittedStatus);
  });

  test.beforeAll(async () => {
    testData = JSON.parse(fs.readFileSync('./resources/testData/OrderTestJsonFile.json', 'utf8'));
  });

  test.beforeEach('Reset per-test state', () => {
    orderToClean = undefined;
    apisOrders = undefined;
  });

  test.beforeEach('Initialize services and page objects', async ({request, page}) => {
    apisOrders = new ApisOrders(request);
    orderPage = new OrderPage(page);
  });

  test.afterEach('Clean up owned order', async () => {
    await apisOrders?.cleanupOrderIfOwned(orderToClean);
  });
});
