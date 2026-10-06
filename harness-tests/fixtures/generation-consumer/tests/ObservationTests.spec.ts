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
    await allure.feature('Observations');
    await allure.testCaseId('ui');
    await observationPage.navigate();
    await observationPage.verifyObservation(testData.ui.expected);
  });

  test('A catalog request returns the expected observation', async () => {
    await allure.feature('Observations');
    await allure.testCaseId('apiCatalog');
    await apisObservations.observe(testData.apiCatalog.definition, testData.apiCatalog.description);
    await apisObservations.verifyObservation(testData.apiCatalog.expected);
  });

  test('A helper request returns the expected observation', async () => {
    await allure.feature('Observations');
    await allure.testCaseId('apiHelper');
    await apisObservations.observe(testData.apiHelper.definition, testData.apiHelper.description);
    await apisObservations.verifyObservation(testData.apiHelper.expected);
  });

  test('An inline request returns the expected observation', async () => {
    await allure.feature('Observations');
    await allure.testCaseId('apiInline');
    await apisObservations.observe(testData.apiInline.definition, testData.apiInline.description);
    await apisObservations.verifyObservation(testData.apiInline.expected);
  });

  test('A catalog SQL Server query returns the bound observation', async () => {
    await allure.feature('Observations');
    await allure.testCaseId('sqlserverCatalog');
    await dbsObservations.observe(testData.sqlserverCatalog.definition, testData.sqlserverCatalog.description);
    await dbsObservations.verifyObservation(testData.sqlserverCatalog.expected);
  });

  test('A helper SQL Server query returns the bound observation', async () => {
    await allure.feature('Observations');
    await allure.testCaseId('sqlserverHelper');
    await dbsObservations.observe(testData.sqlserverHelper.definition, testData.sqlserverHelper.description);
    await dbsObservations.verifyObservation(testData.sqlserverHelper.expected);
  });

  test('An inline SQL Server query returns the bound observation', async () => {
    await allure.feature('Observations');
    await allure.testCaseId('sqlserverInline');
    await dbsObservations.observe(testData.sqlserverInline.definition, testData.sqlserverInline.description);
    await dbsObservations.verifyObservation(testData.sqlserverInline.expected);
  });

  test('A catalog PostgreSQL query returns the bound observation', async () => {
    await allure.feature('Observations');
    await allure.testCaseId('postgresqlCatalog');
    await dbsObservations.observe(testData.postgresqlCatalog.definition, testData.postgresqlCatalog.description);
    await dbsObservations.verifyObservation(testData.postgresqlCatalog.expected);
  });

  test('A helper PostgreSQL query returns the bound observation', async () => {
    await allure.feature('Observations');
    await allure.testCaseId('postgresqlHelper');
    await dbsObservations.observe(testData.postgresqlHelper.definition, testData.postgresqlHelper.description);
    await dbsObservations.verifyObservation(testData.postgresqlHelper.expected);
  });

  test('An inline PostgreSQL query returns the bound observation', async () => {
    await allure.feature('Observations');
    await allure.testCaseId('postgresqlInline');
    await dbsObservations.observe(testData.postgresqlInline.definition, testData.postgresqlInline.description);
    await dbsObservations.verifyObservation(testData.postgresqlInline.expected);
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
