import {test} from '@playwright/test';
import * as allure from 'allure-js-commons';
import {OrdersPage} from '../src/pages/OrdersPage.js';
import {readFileSync} from 'node:fs';

let ordersPage: OrdersPage;
let testData: typeof import('../resources/testData/OrderLookupTestJsonFile.json');

test.describe('Order lookup', () => {
  test('Find an off-page order through search and open its exact row', async () => {
    await allure.feature('Order lookup');
    await allure.testCaseId('off-page');
    await ordersPage.navigate();
    await ordersPage.verifyOrdersPage(testData.tcOffPage.firstPage);
    await ordersPage.searchOrders(testData.tcOffPage.query);
    await ordersPage.verifyOrderResult(testData.tcOffPage.number, testData.tcOffPage.customer, testData.tcOffPage.status, testData.tcOffPage.matches);
    await ordersPage.openOrder(testData.tcOffPage.number, testData.tcOffPage.customer);
    await ordersPage.verifyOpenedOrder(testData.tcOffPage.number, testData.tcOffPage.customer);
  });

  test('Report no matches within the observed all-accessible search scope', async () => {
    await allure.feature('Order lookup');
    await allure.testCaseId('absent');
    await ordersPage.navigate();
    await ordersPage.searchOrders(testData.tcAbsent.query);
    await ordersPage.verifyVisibleOrderCount(testData.tcAbsent.matches);
  });

  test('Report multiple matching identities without choosing a row', async () => {
    await allure.feature('Order lookup');
    await allure.testCaseId('ambiguous');
    await ordersPage.navigate();
    await ordersPage.searchOrders(testData.tcAmbiguous.query);
    await ordersPage.verifyMatchingOrderCount(testData.tcAmbiguous.number, testData.tcAmbiguous.customer, testData.tcAmbiguous.matches);
  });

  test('Distinguish duplicate order labels with a known customer identifier', async () => {
    await allure.feature('Order lookup');
    await allure.testCaseId('disambiguated');
    await ordersPage.navigate();
    await ordersPage.searchOrders(testData.tcDisambiguated.query);
    await ordersPage.verifyOrderResult(testData.tcDisambiguated.number, testData.tcDisambiguated.customer, testData.tcDisambiguated.status, testData.tcDisambiguated.matches);
    await ordersPage.openOrder(testData.tcDisambiguated.number, testData.tcDisambiguated.customer);
    await ordersPage.verifyOpenedOrder(testData.tcDisambiguated.number, testData.tcDisambiguated.customer);
  });

  test('Search literal special characters after replacing a stale filter', async () => {
    await allure.feature('Order lookup');
    await allure.testCaseId('special');
    await ordersPage.navigate();
    await ordersPage.searchOrders(testData.tcSpecial.staleQuery);
    await ordersPage.searchOrders(testData.tcSpecial.query);
    await ordersPage.verifyOrderResult(testData.tcSpecial.number, testData.tcSpecial.customer, testData.tcSpecial.status, testData.tcSpecial.matches);
  });

  test('Preserve the original pagination journey and its checkpoints', async () => {
    await allure.feature('Order lookup');
    await allure.testCaseId('pagination');
    await ordersPage.navigate();
    await ordersPage.verifyOrdersPage(testData.tcPagination.firstPage);
    await ordersPage.browseNextOrdersPage();
    await ordersPage.verifyOrdersPage(testData.tcPagination.nextPage);
    await ordersPage.verifyOrderResult(testData.tcPagination.number, testData.tcPagination.customer, testData.tcPagination.status, testData.tcPagination.matches);
  });

  test.beforeAll(() => {
    testData = JSON.parse(readFileSync('./resources/testData/OrderLookupTestJsonFile.json', 'utf8'));
  });

  test.beforeEach(({page}) => {
    ordersPage = new OrdersPage(page);
  });
});
