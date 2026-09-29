/**
 * The suite's timing tiers — single source (2026-09-08 Timeout policy ruling;
 * same single-source pattern as reporting.ts, utility-classes practice 17).
 * `playwright.config.ts` imports the four defaults; page classes import the
 * slow-surface tier. The linter's EXPECT_DEFAULT_MS in check-conventions.mjs
 * mirrors EXPECT_DEFAULT_MS here in lockstep (a .mjs script cannot import TS).
 *
 *  1. Defaults (consumed by playwright.config.ts) — govern every call with NO
 *     inline timeout.
 *  2. SLOW_SURFACE_MS — the documented slow-QC-surface tier for waits that
 *     measurably exceed the assertion default (first-card renders after
 *     navigation, post-approval redirects, the requests-list fetch, document
 *     downloads). One place to tune the whole tier.
 *  3. `expect.poll` pipeline budgets in `src/dbs` — measured per-flow application
 *     facts (issuance 150s, weekly batch 180s, …), welded to their failure
 *     messages; always pinned inline, never named here.
 * Utils retry-ladder budgets (below the defaults) are mechanism, not tier —
 * they stay inline where the ladder lives.
 */

/** Whole-test budget (config `timeout`) — external registry wizard journeys exceed Playwright's 30s default; long pipeline journeys raise it per-test via `test.setTimeout`. */
export const TEST_DEFAULT_MS = 60_000;
/** Assertion budget (expect.timeout) — the de-facto QC tier. */
export const EXPECT_DEFAULT_MS = 30_000;
/** Action budget (use.actionTimeout) — a hung click/fill/waitFor fails as itself. */
export const ACTION_DEFAULT_MS = 30_000;
/** Navigation budget (use.navigationTimeout) — sized to the measured QC gotos. */
export const NAVIGATION_DEFAULT_MS = 60_000;
/** The slow-surface tier — inline on waits that measurably exceed the assertion default. */
export const SLOW_SURFACE_MS = 60_000;
