import { test } from '@playwright/test';
import * as allure from 'allure-js-commons';
import { ObservationPage } from '../src/pages/ObservationPage.js';
import { ApisObservations } from '../src/apis/ApisObservations.js';
import { DbsObservations } from '../src/dbs/DbsObservations.js';
import * as fs from 'node:fs';

let observationPage: ObservationPage;
let apisObservations: ApisObservations;
let dbsObservations: DbsObservations;
let testData: any;

test.describe('Observations', () => {
  test('The page displays the expected observation', async () => {
    allure.feature('Observations');
    allure.testCaseId('ui');
    await observationPage.navigate();
    await observationPage.verifyObservation(testData.ui.key, testData.ui.expected);
  });

  test('A catalog request returns the expected observation', async () => {
    allure.feature('Observations');
    allure.testCaseId('apiCatalog');
    await apisObservations.observe(testData.apiCatalog.definition, testData.apiCatalog.description);
    await apisObservations.verifyObservation(testData.apiCatalog.key, testData.apiCatalog.expected);
  });

  test('A helper request returns the expected observation', async () => {
    allure.feature('Observations');
    allure.testCaseId('apiHelper');
    await apisObservations.observe(testData.apiHelper.definition, testData.apiHelper.description);
    await apisObservations.verifyObservation(testData.apiHelper.key, testData.apiHelper.expected);
  });

  test('An inline request returns the expected observation', async () => {
    allure.feature('Observations');
    allure.testCaseId('apiInline');
    await apisObservations.observe(testData.apiInline.definition, testData.apiInline.description);
    await apisObservations.verifyObservation(testData.apiInline.key, testData.apiInline.expected);
  });

  test('A catalog SQL Server query returns the bound observation', async () => {
    allure.feature('Observations');
    allure.testCaseId('sqlserverCatalog');
    await dbsObservations.observe(testData.sqlserverCatalog.definition, testData.sqlserverCatalog.description);
    await dbsObservations.verifyObservation(testData.sqlserverCatalog.key, testData.sqlserverCatalog.expected);
  });

  test('A helper SQL Server query returns the bound observation', async () => {
    allure.feature('Observations');
    allure.testCaseId('sqlserverHelper');
    await dbsObservations.observe(testData.sqlserverHelper.definition, testData.sqlserverHelper.description);
    await dbsObservations.verifyObservation(testData.sqlserverHelper.key, testData.sqlserverHelper.expected);
  });

  test('An inline SQL Server query returns the bound observation', async () => {
    allure.feature('Observations');
    allure.testCaseId('sqlserverInline');
    await dbsObservations.observe(testData.sqlserverInline.definition, testData.sqlserverInline.description);
    await dbsObservations.verifyObservation(testData.sqlserverInline.key, testData.sqlserverInline.expected);
  });

  test('A catalog PostgreSQL query returns the bound observation', async () => {
    allure.feature('Observations');
    allure.testCaseId('postgresqlCatalog');
    await dbsObservations.observe(testData.postgresqlCatalog.definition, testData.postgresqlCatalog.description);
    await dbsObservations.verifyObservation(testData.postgresqlCatalog.key, testData.postgresqlCatalog.expected);
  });

  test('A helper PostgreSQL query returns the bound observation', async () => {
    allure.feature('Observations');
    allure.testCaseId('postgresqlHelper');
    await dbsObservations.observe(testData.postgresqlHelper.definition, testData.postgresqlHelper.description);
    await dbsObservations.verifyObservation(testData.postgresqlHelper.key, testData.postgresqlHelper.expected);
  });

  test('An inline PostgreSQL query returns the bound observation', async () => {
    allure.feature('Observations');
    allure.testCaseId('postgresqlInline');
    await dbsObservations.observe(testData.postgresqlInline.definition, testData.postgresqlInline.description);
    await dbsObservations.verifyObservation(testData.postgresqlInline.key, testData.postgresqlInline.expected);
  });

  test.beforeAll(async () => {
    testData = JSON.parse(fs.readFileSync('./resources/testData/ObservationTestJsonFile.json', 'utf8'));
  });

  test.beforeEach(async ({ page }) => {
    observationPage = new ObservationPage(page);
    apisObservations = new ApisObservations();
    dbsObservations = new DbsObservations();
  });
});
