// Example — ships with the harness package; copy to tests/LoginTests.spec.ts (drop the examples/ prefix).
import { test } from '@playwright/test';
import * as allure from 'allure-js-commons';
import { LoginPage } from '../src/pages/LoginPage';
import { ApisUserManagement } from '../src/apis/ApisUserManagement';
import * as fs from 'fs';

let loginPage: LoginPage;
let apisUserManagement: ApisUserManagement;
let userToClean: string | undefined;

const timestamp = new Date().toISOString().replace(/[-T:.]/g, '').slice(0, 17);

let testData: typeof import('../resources/testData/LoginTestJsonFile.json');

test.describe('Login', () => {

  test('Test Case 12345: Login with valid email and password shows the welcome message', { tag: ['@smoke'] }, async () => {
    await allure.feature('Login');
    await allure.tms('12345');

    const email = testData.tc12345.email + timestamp + '@example.test';
    userToClean = email;
    const createResponse = await apisUserManagement.createUser(testData.tc12345.username, email, testData.tc12345.password);
    await apisUserManagement.verifyUserCreatedSuccessfully(createResponse, testData.userCreatedResponse.status, testData.userCreatedResponse.message);

    await loginPage.navigate();
    await loginPage.login(email, testData.tc12345.password);
    await loginPage.verifyLoginSuccessful(testData.confirmationMessages.welcomeMsg);
  });

  test('Test Case 12346: Login with a wrong password shows an error message', { tag: ['@regression'] }, async () => {
    await allure.feature('Login');
    await allure.tms('12346');

    const email = testData.tc12346.email + timestamp + '@example.test';
    userToClean = email;
    const createResponse = await apisUserManagement.createUser(testData.tc12346.username, email, testData.tc12346.password);
    await apisUserManagement.verifyUserCreatedSuccessfully(createResponse, testData.userCreatedResponse.status, testData.userCreatedResponse.message);

    await loginPage.navigate();
    await loginPage.login(email, testData.tc12346.wrongPassword);
    await loginPage.verifyLoginErrorMessage(testData.errorMessages.wrongPasswordMsg);
  });

  test.beforeAll(async () => {
    testData = JSON.parse(fs.readFileSync('./resources/testData/LoginTestJsonFile.json', 'utf8'));
  });

  test.beforeEach(() => {
    userToClean = undefined;
  });

  test.beforeEach(({ request, page }) => {
    apisUserManagement = new ApisUserManagement(request);
    loginPage = new LoginPage(page);
  });

  test.afterEach('Clean up the test user', async () => {
    await apisUserManagement?.cleanupUserIfOwned(userToClean);
  });

});
