// Example — ships with the harness package; copy to pages/LoginPage.ts (drop the examples/ prefix).
import { type Page, type Locator } from '@playwright/test';
import { step } from 'allure-js-commons';
import { applications } from '../config/applications';
import { expectToBeVisible, expectToHaveText } from '../utils/Expects';

export class LoginPage {
  readonly page: Page;
  readonly url: string = `${applications.app.url}/login`;

  // Locators
  private readonly loginUsername_input: Locator;
  private readonly loginPassword_input: Locator;
  private readonly login_button: Locator;
  private readonly loginError_msg: Locator;
  private readonly welcome_txt: Locator;

  constructor(page: Page) {
    this.page = page;
    this.loginUsername_input = page.locator('[data-qa="login-username"]');
    this.loginPassword_input = page.locator('[data-qa="login-password"]');
    this.login_button = page.locator('[data-qa="login-button"]');
    this.loginError_msg = page.locator('[data-qa="login-error"]');
    this.welcome_txt = page.locator('#welcome-message');
  }

  ///// Actions

  async navigate() {
    await step(`Navigate to Login Page`, async () => {
      await this.page.goto(this.url);
    });
  }

  async login(username: string, password: string) {
    await step('Log in with configured credentials', async () => {
      await this.loginUsername_input.fill(username);
      await this.loginPassword_input.fill(password);
      await this.login_button.click();
    });
  }

  ///// Validations

  async verifyLoginSuccessful(expectedWelcomeMessage: string) {
    await step(`Verify login succeeded with welcome message: ${expectedWelcomeMessage}`, async () => {
      await expectToBeVisible('the welcome message', this.welcome_txt);
      await expectToHaveText('the welcome message', this.welcome_txt, expectedWelcomeMessage);
    });
  }

  async verifyLoginErrorMessage(expectedMessage: string) {
    await step(`Verify login error message: ${expectedMessage}`, async () => {
      await expectToHaveText('the login error message', this.loginError_msg, expectedMessage);
    });
  }
}
