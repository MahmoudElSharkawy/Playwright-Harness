import { AsyncLocalStorage } from 'node:async_hooks';
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { infoEnabled, loggingDefaults } from '../config/logging.js';
import { Logger } from './Logger.js';

const retryScope = new AsyncLocalStorage<boolean>();

/** Performs Playwright UI actions on caller-owned locators and logs their outcomes. */
export class UiActions {
  /** Clicks a locator with the optional Playwright click settings. */
  click(locator: Locator, ...args: Parameters<Locator['click']>): ReturnType<Locator['click']> {
    return this.perform('Click',() => locator.click(...args));
  }

  /** Fills a locator and keeps the field value out of the action log. */
  fill(locator: Locator, ...args: Parameters<Locator['fill']>): ReturnType<Locator['fill']> {
    return this.perform('Fill',() => locator.fill(...args));
  }

  /** Types text as individual key events and keeps the text out of the action log. */
  pressSequentially(locator: Locator, ...args: Parameters<Locator['pressSequentially']>): ReturnType<Locator['pressSequentially']> {
    return this.perform('Press sequentially',() => locator.pressSequentially(...args));
  }

  /** Sends a key or key combination to a locator. */
  press(locator: Locator, ...args: Parameters<Locator['press']>): ReturnType<Locator['press']> {
    return this.perform('Press',() => locator.press(...args));
  }

  /** Checks a checkbox or radio button using Playwright's check behavior. */
  check(locator: Locator, ...args: Parameters<Locator['check']>): ReturnType<Locator['check']> {
    return this.perform('Check',() => locator.check(...args));
  }

  /** Selects options in a native select element and returns their values. */
  selectOption(locator: Locator, ...args: Parameters<Locator['selectOption']>): ReturnType<Locator['selectOption']> {
    return this.perform('Select option',() => locator.selectOption(...args));
  }

  /**
   * Navigates and returns once the page is safely interactable. Gating a bare goto on
   * 'load' dies when third-party trackers stall the event past the navigation budget;
   * gating on 'domcontentloaded' alone returns BEFORE the app's own hydration, so the
   * first fill/click is silently swallowed. This waits for domcontentloaded, then gives
   * the load event — which hydration rides on — a bounded slice and proceeds either way:
   * the app bundle finishes well inside it, and only stalled trackers ever exhaust it.
   */
  async gotoInteractive(page: Page, url: string): Promise<void> {
    await this.perform('Navigate',async () => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
    });
  }

  /**
   * Selects a value in a react-select combobox by typing it and pressing Enter. The
   * widget initializes asynchronously and can WIPE values typed before it settles — an
   * empty search input is therefore NOT a settle signal; the caller supplies the display
   * text the widget renders once the option is really chosen (e.g. the chosen value, or
   * a formatted variant of it), and the helper re-keys until that text renders, bounded.
   * Warns on exhaustion, then the caller's next step-gate validation reports a terminal
   * failure.
   */
  async selectReactOption(page: Page, optionSearch_input: Locator, value: string, settledDisplayText: string): Promise<void> {
    await this.perform('Select React option',async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        await optionSearch_input.click();
        await optionSearch_input.fill(value);
        await optionSearch_input.press('Enter');
        const settled = await page.getByText(settledDisplayText).first()
          .waitFor({ state: 'visible', timeout: 2_000 })
          .then(() => true)
          .catch(() => false);
        if (settled) {
          return true;
        }
      }
      return false;
    });
  }

  /**
   * Selects a JS-driven styled radio (hidden/overlaid native input) whose screen wires
   * its handlers asynchronously — a selection clicked before the widget settles is lost.
   * Re-selects until the gate button the selection unlocks becomes enabled, bounded.
   * Warns on exhaustion so the caller's click on the gate can report the still-disabled
   * state with full context.
   */
  async selectCustomRadioUntilEnabled(radio_input: Locator, gate_button: Locator): Promise<void> {
    await this.perform('Select custom radio until enabled',async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        await radio_input.check({ force: true, timeout: 3_000 }).catch(async () => {
          await radio_input.click({ force: true });
        });
        const unlocked = await expect(gate_button, 'Probe whether the gate button becomes enabled (non-asserting) →')
          .toBeEnabled({ timeout: 3_000 })
          .then(() => true)
          .catch(() => false);
        if (unlocked) {
          return true;
        }
      }
      return false;
    });
  }

  /**
   * Types a value with REAL key events until the gate button it unlocks becomes enabled.
   * Some screens validate on key events after async init — a fill() sets the value
   * without any key event (submit stays disabled forever), and a value typed exactly once
   * can be wiped before the widget settles. Bounded; warns on exhaustion, then the caller's
   * click then reports the still-disabled button with full context.
   */
  async typeUntilEnabled(field: Locator, value: string, gate_button: Locator): Promise<void> {
    await this.perform('Type until enabled',async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        await field.fill('');
        await field.pressSequentially(value, { delay: 50 });
        const enabled = await expect(gate_button, 'Probe whether the gated control becomes enabled (non-asserting) →').toBeEnabled({ timeout: 4_000 })
          .then(() => true)
          .catch(() => false);
        if (enabled) {
          return true;
        }
      }
      return false;
    });
  }

  /**
   * Clicks a toggle whose handler attaches asynchronously until the element it reveals
   * becomes visible. Bounded; warns on exhaustion, then the caller's next interaction
   * reports the terminal state.
   */
  async clickUntilRevealed(toggle_button: Locator, revealed_target: Locator): Promise<void> {
    await this.perform('Click until revealed',async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        await toggle_button.click();
        const shown = await expect(revealed_target, 'Probe whether the revealed control shows (non-asserting) →').toBeVisible({ timeout: 3_000 })
          .then(() => true)
          .catch(() => false);
        if (shown) {
          return true;
        }
      }
      return false;
    });
  }

  /**
   * Keys a fixed-length OTP into a per-digit box group until the verify button unlocks
   * (a per-digit OTP widget where a later box is DISABLED during async init — that
   * disable is the init signal to wait out; digits typed before it settles are dropped
   * and the verify stays disabled). Waits the init, then re-keys the first box with real
   * key events until verify enables, bounded. Warns on exhaustion, then the caller's verify
   * click then reports the still-disabled button with full context.
   */
  async keyOtpUntilVerifyEnabled(firstDigit_input: Locator, initGateDigit_input: Locator, otp: string, verify_button: Locator): Promise<void> {
    await this.perform('Key OTP until verify enabled',async () => {
      await expect(initGateDigit_input, 'Probe the OTP widget init (second box disabled) →').toBeDisabled({ timeout: 10_000 }).catch(() => undefined);
      for (let attempt = 0; attempt < 5; attempt++) {
        await firstDigit_input.pressSequentially(otp, { delay: 150 });
        const enabled = await expect(verify_button, 'Probe whether Verify becomes enabled (non-asserting) →').toBeEnabled({ timeout: 4_000 })
          .then(() => true)
          .catch(() => false);
        if (enabled) {
          return true;
        }
        await firstDigit_input.fill('');
      }
      return false;
    });
  }

  /**
   * Keys a value into a keystroke-FORMATTED input (a masked/prefixed field that REJECTS
   * fill() — e.g. a phone field with a fixed country-code prefix) until the gate button
   * it unlocks becomes enabled. Moves the caret past the fixed prefix (End) — the field's
   * inline handler re-anchors the prefix and strips non-digits — then types the
   * significant digits. Warns on exhaustion, then the caller's submit then reports the
   * still-disabled gate with full context.
   */
  async keyFormattedUntilEnabled(field: Locator, value: string, gate_button: Locator): Promise<void> {
    await this.perform('Key formatted value until enabled',async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        await field.click();
        await field.press('End'); // caret past the fixed prefix; the inline handler re-anchors it and strips non-digits
        await field.pressSequentially(value, { delay: 60 });
        const enabled = await expect(gate_button, 'Probe whether the gated control becomes enabled (non-asserting) →').toBeEnabled({ timeout: 4_000 })
          .then(() => true)
          .catch(() => false);
        if (enabled) {
          return true;
        }
      }
      return false;
    });
  }

  /**
   * Runs a trigger action and checks a non-asserting success probe; if the probe is
   * false, re-runs the trigger, bounded. For flows fronted by a flaky external surface
   * that a re-trigger recovers — e.g. a gate hosted in an iframe that intermittently
   * loads a browser-error page; a fresh navigate + re-open clears it. If every attempt
   * fails, warns and returns so the caller's assertion can report the terminal state.
   * Nested UiActions calls share this helper's single outcome log.
   */
  async retryUntilSucceeded(trigger: () => Promise<void>, succeeded: () => Promise<boolean>, attempts = 3): Promise<void> {
    await this.perform('Retry',() => retryScope.run(true, async () => {
      for (let attempt = 0; attempt < attempts; attempt++) {
        await trigger();
        if (await succeeded()) {
          return true;
        }
      }
      return false;
    }));
  }

  /**
   * Submits a field-hosted form by focusing the field and pressing Enter, retrying until
   * a post-submit target appears. Some third-party payment/card widgets' own submit
   * button no-ops under a synthetic click, and their Enter-submit path can drop a
   * keystroke fired before the widget finishes validating the typed input — so a single
   * Enter races the widget. Re-keys Enter until the target (the connector's next step)
   * shows, bounded; the click/press are caught because a successful submit detaches the
   * field mid-navigation. Warns on exhaustion, then the caller's next wait reports the
   * terminal state with full context.
   */
  async pressEnterUntilRevealed(field: Locator, revealed_target: Locator): Promise<void> {
    await this.perform('Press Enter until revealed',async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        await field.click().catch(() => undefined);
        await field.press('Enter').catch(() => undefined);
        const shown = await expect(revealed_target, 'Probe whether the post-submit target shows (non-asserting) →').toBeVisible({ timeout: 3_000 })
          .then(() => true)
          .catch(() => false);
        if (shown) {
          return true;
        }
      }
      return false;
    });
  }

  /**
   * Types a value into an async-initializing FORMATTER field until the typed digits stick.
   * Some masked fields (e.g. a card-expiry "MM / YY") wipe a value typed during widget
   * init (reverting to an invalid/empty value) — and an empty submit can wedge the whole
   * widget instance. The probe compares the field's DIGITS against the expected digits, so
   * mask characters never false-fail it. Bounded; warns on exhaustion, then the caller's
   * submit then reports the terminal state with full context.
   */
  async typeUntilValueSticks(field: Locator, value: string): Promise<void> {
    await this.perform('Type until value sticks',async () => {
      const expectedDigits = value.replace(/\D/g, '');
      for (let attempt = 0; attempt < 4; attempt++) {
        await field.click();
        await field.pressSequentially(value, { delay: 60 });
        const settled = await field.page().waitForTimeout(500).then(async () => (await field.inputValue()).replace(/\D/g, '') === expectedDigits).catch(() => false);
        if (settled) {
          return true;
        }
        await field.fill('').catch(() => undefined);
      }
      return false;
    });
  }

  /**
   * Clicks a control that opens a NEW TAB until that tab actually opens, and returns it.
   * A success screen's "open in new tab" handler can attach asynchronously — a click
   * landed before hydration is silently swallowed and no popup ever opens. Each attempt
   * arms the page-event listener BEFORE clicking; the final attempt waits unguarded so an
   * exhausted ladder reports the terminal timeout loudly with full context. A late popup
   * from a swallowed-looking click is harmless: the first captured tab is used and
   * context teardown closes any stray twin.
   */
  async clickUntilPageOpens(context: BrowserContext, trigger_button: Locator): Promise<Page> {
    return this.perform('Click until page opens',async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const opened = context.waitForEvent('page', { timeout: 6_000 }).catch(() => undefined);
        await trigger_button.click();
        const newPage = await opened;
        if (newPage) {
          return newPage;
        }
      }
      const finalOpened = context.waitForEvent('page', { timeout: 10_000 });
      // If the click throws, the pending event can still reject later.
      void finalOpened.catch(() => undefined);
      await trigger_button.click();
      return await finalOpened;
    });
  }

  /** Logs the outer action outcome under a readable `action` name. Retry helpers return false on exhaustion. */
  private async perform<T>(action: string, run: () => Promise<T>): Promise<T> {
    if (retryScope.getStore()) {
      return run();
    }
    try {
      const result = await run();
      if (result === false) {
        Logger.warn('UI', `${action} exhausted its attempts`);
      } else if (infoEnabled(process.env.UI_CONSOLE_LOGS, loggingDefaults.ui)) {
        Logger.info('UI', `${action} succeeded`);
      }
      return result;
    } catch (error) {
      Logger.error('UI', `${action} failed`);
      throw error;
    }
  }
}
