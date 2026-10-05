// Example — ships with the harness package; copy to tests/User Management/DbUserManagementTests.spec.ts
// (drop the examples/ prefix). Nested one folder deep to demonstrate the suite/initiative
// grouping convention (design-conventions.md, spec-folder ruling) — quote the path in
// shell commands because the folder name contains a space.
import { test } from '@playwright/test';
import * as allure from 'allure-js-commons';
import { ApisUserManagement } from '../../src/apis/ApisUserManagement';
import { DbsUserManagement } from '../../src/dbs/DbsUserManagement';
import { databases } from '../../src/config/databases';
import * as fs from 'fs';

let apisUserManagement: ApisUserManagement;
let dbsUserManagement: DbsUserManagement;

let testData: typeof import('../../resources/testData/DbUserManagementTestJsonFile.json');

const timestamp = new Date().toISOString().replace(/[-T:.]/g, "").slice(0, 17);

// EXAMPLE: remove `.skip` once src/config/databases.ts points at a real,
// reachable SQL Server — until then the queries would fail to connect.
test.describe.skip('User Management DB Test Cases', () => {

  test('Test Case 12347: User created through the API is persisted in the database', { tag: ['@regression'] }, async () => {
    allure.epic('User Management');
    allure.feature('User Management DB Test Cases');
    allure.tms('12347');
    // allure.issue('#link');

    const email = testData.tc12347.email + timestamp + '@example.test';
    const createResponse = await apisUserManagement.createUser(testData.tc12347.username, email, testData.tc12347.password);
    await apisUserManagement.verifyUserCreatedSuccessfully(createResponse, testData.userCreatedResponse.status, testData.userCreatedResponse.message);

    await dbsUserManagement.verifyUserExistsInDb(email);

    await apisUserManagement.deleteUser(email);
  });

  test.beforeAll(async () => {
    testData = JSON.parse(fs.readFileSync('./resources/testData/DbUserManagementTestJsonFile.json', 'utf8'));
    dbsUserManagement = new DbsUserManagement(databases.appDb);
  });

  test.beforeEach(async ({ request }) => {
    apisUserManagement = new ApisUserManagement(request);
  });

  test.afterAll(async () => {
    await dbsUserManagement.close();
  });

});
