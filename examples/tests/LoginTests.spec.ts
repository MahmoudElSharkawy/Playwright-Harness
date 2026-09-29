// Example — ships with the harness package; copy to tests/LoginTests.spec.ts (drop the examples/ prefix).
import { test, Page, BrowserContext } from '@playwright/test';
import * as allure from 'allure-js-commons';
import { LoginPage } from '../src/pages/LoginPage';
import { ApisUserManagement } from '../src/apis/ApisUserManagement';
import * as fs from 'fs';

let context: BrowserContext;
let page: Page;

let loginPage: LoginPage;
let apisUserManagement: ApisUserManagement;

let testData: any;

const timestamp = new Date().toISOString().replace(/[-T:.]/g, "").slice(0, 17);

test.describe('Login', () => {

  test('Test Case 12345: Login with valid email and password shows the welcome message', { tag: ['@smoke'] }, async () => {
    allure.feature('Login');
    allure.tms('12345');
    // allure.issue('#link');

    const email = testData.tc12345.email + timestamp + '@example.test';
    await apisUserManagement.createUser(testData.tc12345.username, email, testData.tc12345.password);

    await loginPage.navigate();
    await loginPage.login(email, testData.tc12345.password);
    await loginPage.verifyLoginSuccessful(testData.confirmationMessages.welcomeMsg);

    await apisUserManagement.deleteUser(email);
  });

  test('Test Case 12346: Login with a wrong password shows an error message', { tag: ['@regression'] }, async () => {
    allure.feature('Login');
    allure.tms('12346');
    // allure.issue('#link');

    const email = testData.tc12346.email + timestamp + '@example.test';
    await apisUserManagement.createUser(testData.tc12346.username, email, testData.tc12346.password);

    await loginPage.navigate();
    await loginPage.login(email, testData.tc12346.wrongPassword);
    await loginPage.verifyLoginErrorMessage(testData.errorMessages.wrongPasswordMsg);

    await apisUserManagement.deleteUser(email);
  });

  test.beforeAll(async () => {
    testData = JSON.parse(fs.readFileSync('./resources/testData/LoginTestJsonFile.json', 'utf8'));
  });

  test.beforeEach(async ({ request, browser }) => {
    apisUserManagement = new ApisUserManagement(request);

    context = await browser.newContext();
    page = await context.newPage();
    loginPage = new LoginPage(page);
  });

  test.afterEach(async () => {
    await context.close();
  });

});
