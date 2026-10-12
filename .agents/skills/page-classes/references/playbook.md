# Page Classes — Playbook

Numbered practices for building and reviewing page classes in `pages/`. Every rule traces
to [design-conventions](../../pom-architecture/references/design-conventions.md) (cited as §N)
or to the project files quoted below.

## 1. One class per HTML page — and one per skeleton area

Model each HTML page under test as exactly one class in `pages/`, named `<Name>Page` (§2).
Skeleton areas that repeat across pages — header, footer, side menu — get their **own**
page class instead of being duplicated into every page (§1). That is the project's
"common/shared pages" mechanism: `src/pages/HeaderPage.ts` owns the navigation bar once, and
every flow that needs it composes it in the spec:

```ts
// tests/LoginTests.spec.ts
await homePage.navigate();
await headerPage.clickOnSignupLoginLink();
await loginPage.login(email, testData.password);
```

❌ Copying `cart_link` / `signupLoginLogout_link` locators into `HomePage`, `LoginPage`,
and every future page — one DOM change then costs N edits.

✅ (illustrative counterexample) `FooterPage` is the proven second skeleton-area class: routeless, no
`navigate()`, reached through whichever page renders it — and a skeleton class may own a
real form service (`subscribeWithEmail(email)`), not only link clicks. Fix its two
defects when adopting it: the step-less `scrollToFooter()` and the suffix-less
`successMessage` field.

**Ownership follows the rendering page, never the flow.** Every locator belongs to the
class of the page that renders its element. Litmus: a class named after a flow, feature,
or test case is wrong — a multi-page journey is orchestrated in the spec across several
page objects. ❌ (illustrative counterexample) `ProductQuantityPage` collects locators from the product
grid, the product-details page (`id=quantity`), and the cart (`cart_quantity`) while
`ProductDetailsPage` and `CartPage` model the same DOM; ❌ (illustrative counterexample) `SignupPage`
owning `[data-qa="account-created"]`, `[data-qa="account-deleted"]`, and the header's
logged-in-user element while dedicated classes exist for all three.

## 2. Follow the fixed member order and section banners

Every page class reads top-to-bottom in the §3 order, with an empty line between methods (§4.12):

```ts
import { type Page, type Locator, expect } from '@playwright/test';
import { step } from 'allure-js-commons';

export class ExamplePage {
  readonly page: Page;                    // 1. page handle
  readonly url: string = '/example';      // 2. route (only if the page owns one)

  // Locators                             // 3. locator fields under this comment
  private readonly submit_button: Locator;

  constructor(page: Page) { /* wire + init */ }   // 4. constructor

  // (dynamic locator methods go here)    // 5. parameterized Locator methods

  ///// Actions                           // 6. action methods

  ///// Validations                       // 7. validation methods — always last
}
```

The banners are exactly `///// Actions` and `///// Validations`, as in all three existing
pages (`src/pages/LoginPage.ts`, `src/pages/HomePage.ts`, `src/pages/HeaderPage.ts`). A stray
`/////////Assertions` banner is legacy — fold its methods under `///// Validations` when
you next touch that file (§3). The variant catalog to fold on touch is wider than that:
the illustrative counterexample alone has `//Actions`, `//Assertions`, `////Actions`, `//// Validations`,
`/*methods*/`, `/*assertion*/`, `/////////////validations////////////`, and bannerless
files. A banner is a claim about what follows — review its **contents**, not its
presence: ❌ (illustrative counterexample) `ProductsPage` files `clickOnBrand()`, an action, under its
`//// Validations` banner.

## 3. Every directly routable page exposes `navigate()`

Classify the page from the supported application entry points: directly routable,
parameterized, or routeless/flow-only. Every page with a supported direct URL exposes
one **public async `navigate()`** action, including pages the current scenario reaches
through a link. Implicit TypeScript public visibility is valid. Reuse an existing
navigation action and preserve its custom behavior; reconcile a nonstandard name and
its callers during review rather than adding a duplicate entry action.

A fixed route is declared once as `readonly url`, immediately after `page` (§3).
Environment coordinates come from the existing application configuration. The shipped
example uses an absolute URL because its runner has no `baseURL`:

```ts
// src/pages/LoginPage.ts
readonly page: Page;
readonly url: string = `${applications.app.url}/login`;
...
async navigate(): Promise<void> {
  await step(`Navigate to Login Page`, async () => {
    await this.page.goto(this.url);
  });
}
```

Keep the project's existing URL style. If the runner configures `baseURL` for the
owning application, a relative `url` is valid; root routes may use `''` or `'/'` under
that configuration. Without `baseURL`, a root page uses the configured application URL
itself. For multiple applications, select the owning application's config entry; never
silently resolve a second application's route against the first application's base.
Do not introduce a routing service or change application configuration for this rule.

A parameterized route receives required identifiers explicitly with useful types.
Keep route construction in one owning place, normally `navigate()`; use an existing
route builder when one already owns it. Do not read an identifier from another test,
global mutable state or hidden default. For an observed `/records/:recordId` route:

```ts
readonly page: Page;
readonly url: string = `${applications.app.url}/records`;
...
async navigate(recordId: string): Promise<void> {
  await step(`Navigate to record ${recordId}`, async () => {
    await this.page.goto(`${this.url}/${encodeURIComponent(recordId)}`);
  });
}
```

Ordinary action return rules apply (practice 7); do not return `this`, another page,
or an unused navigation response. Navigation owns exactly one business-readable Allure
step. Constructors only initialize (practice 4); arrival, redirects and missing/deleted
record outcomes are checked separately in `verify*` methods. A supported route that
requires authentication is still directly routable: preserve authentication/data
prerequisites and existing page/context ownership before calling `navigate()`.

`page.goto()` belongs only inside the owning navigation action, never in a spec,
hook, constructor, another action, or validation. A direct-entry step calls that page's
`navigate()` with its route inputs. A step testing a link, menu, redirect or multi-page
journey keeps the original business interaction and checkpoints; do not bypass it by
calling the destination's navigation action.

**Explicit exceptions:** shared skeleton areas (header/footer/menu) have no independent
route and are reached through the page that renders them. Flow-only screens requiring
transient state with no supported direct entry are reached through their owning journey.
Document the reason on the class; never invent a route or an empty `navigate()`.
A flow-only screen may own a `url` used solely by an arrival validation. If the checker
reports that detectable route, use its existing reviewed line exemption:

```ts
// Flow-only confirmation: reached after checkout, with no supported direct entry.
readonly page: Page;
readonly url: string = '/confirmation'; // conventions-ok: Transient checkout state is required; arrival validation only.
```

The checker reports conventional `url` fields without public async navigation,
misordered fields or fixed `goto` literals, and direct `page.goto` outside navigation
or in specs/hooks. These are advisory warnings; `--fail-on-warn` remains opt-in.
Unusual/computed/arrow members, aliased page handles, dynamic route typing, supported
entry and Allure semantics require independent review. A URL or `<Name>Page` name
alone does not establish that direct entry is supported. Keep any live URL/record
evidence private. An unread `url` remains dead code (practice 13).

## 4. Constructor wires and initializes — nothing else

The constructor takes a single `Page`, stores it, and initializes every locator field.
Constructors cannot be `async`, so they must never navigate, wait, or branch — readiness
is proven by validation methods, not by construction:

```ts
// src/pages/LoginPage.ts
constructor(page: Page) {
  this.page = page;
  this.loginEmail_Input = page.locator('[data-qa="login-email"]');
  this.loginPassword_Input = page.locator('[data-qa="login-password"]');
  this.login_Button = page.locator('[data-qa="login-button"]');
  ...
}
```

❌ `constructor(page: Page) { this.page = page; page.goto('/login'); }` — hidden
navigation makes the class unusable for flows that arrive at the page another way.

Which selector to write inside `page.locator(...)` is
[element-locators](../../element-locators/SKILL.md) territory.

## 5. Use dynamic locator methods for parameterized elements

When an element can only be identified with runtime data (a product name, a row key),
expose a synchronous method that returns a `Locator`. It is named like a locator field
(camelCase + element-type suffix), sits between the constructor and `///// Actions`
(§3 item 3), and stays inside the class — actions consume it:

```ts
// src/pages/HomePage.ts
viewProduct_Button(productName: string): Locator {
  return this.page
    .locator("div.product-image-wrapper", { hasText: productName })
    .locator("a[href^='/product_details/']");
}
...
async clickViewProduct(productName: string) {
  await step(`Click View Product for ${productName}`, async () => {
    await this.viewProduct_Button(productName).click();
  })
}
```

Note: the `_Button` suffix casing in this legacy file is §2-legacy; new dynamic locator
methods use the lowercase suffix (`viewProduct_button`) — naming rules in
[element-locators](../../element-locators/SKILL.md).

Make dynamic locator methods `private` in new classes — same encapsulation rule as
locator fields (§4.2). ❌ An `async` dynamic locator, or a public one a spec calls
directly: locators never leave their page class.

For list-record targeting, the rendering page owns the observed search action,
row/card locator and identity validations under [§4b](../../pom-architecture/references/design-conventions.md#4b-record-targeting-on-list-pages). Reuse existing methods; a new generic list/base class is unnecessary. Keep the exact identity and any known disambiguating fields in one container, with mechanics hidden from the spec.

## 6. No base classes — compose, don't inherit

Never create a `BasePage` or `extends` between page classes (§1). Each class declares its
own `readonly page: Page`; shared UI becomes a skeleton page class (practice 1); shared
technical behavior goes to `utils/`.

```ts
// ❌ Selenium-era reflex — banned here
export class LoginPage extends BasePage { ... }

// ✅ src/pages/HeaderPage.ts — standalone class, composed in the spec next to LoginPage
export class HeaderPage {
  readonly page: Page;
  ...
}
```

## 7. Methods return `Promise<void>` — never `this`, never another page object

Decorative fluent chaining fights `async`/`await`; fluency lives in step titles and
Playwright's chainable locators (§5). A page action also never constructs the "next"
page — the spec instantiates every page it needs in `beforeEach`
(see [test-classes](../../test-classes/SKILL.md)):

```ts
// ❌ Java-fluent-POM habit
async login(user: string, pass: string): Promise<HomePage> {
  ...
  return new HomePage(this.page);
}
```

Return a value only when the caller genuinely consumes it (§5) — rare in page classes.

## 8. No exception handling, no complexity

`try`/`catch` is banned in `pages/` — it exists only in `utils/` (§4.3). Let failures
fail: Playwright's error, the trace, and the Allure step tell the story. Keep logic
minimal: no loops or conditionals — prefer splitting into smaller intent-named methods or
optional parameters over branching (§4.4). If a page method needs a retry, a poll, or a
data transformation, that concern belongs in `utils/`
([utility-classes](../../utility-classes/SKILL.md)).

## 9. Expose business services, not element micro-wrappers

The class surface models what the user accomplishes on that page, not every element it
contains: `LoginPage.login(username, password)` is one service that fills two inputs and
clicks — not a public `enterEmail()` / `enterPassword()` / `clickLoginButton()` trio the
spec must choreograph. Skeleton classes are the calibration point: in
`src/pages/HeaderPage.ts` each `clickOnCartLink()`-style method **is** the business service,
because navigating via one link is all a header does. Method granularity and step-title
rules are detailed in [action-methods](../../action-methods/SKILL.md).

## 10. Create a new page class only when a current test justifies it

Build only what the test in front of you needs (§4.11):

- **Yes:** the test drives an HTML page that has no class yet; or a skeleton area
  (footer, side menu) is about to be duplicated into a second page class.
- **No:** speculative pages "we'll surely need", methods no current test calls, or
  extracting a component with a single consumer — one test does not justify a new
  abstraction.
- **Also yes:** you catch a spec or another class reaching for `page.locator()` on a page
  that lacks a class — that markup needs a home; specs orchestrate, never implement (§1).

Start a new class by copying the shape of the closest sibling in `pages/`, then apply the
canonical forms below.

Once a directly routable page is justified, its `navigate()` is part of the required
page contract even when the current scenario arrives through a link (practice 3).

## 11. Small pages, full anatomy

A one-message-one-button confirmation page (`/account_created`, `/account_deleted`) still
gets its own class — a two-member class is correct granularity, not over-engineering. But
smallness exempts nothing: same §3 member order, `// Locators` comment, `///// Actions`
and `///// Validations` banners, step-wrapped methods. ❌ (illustrative counterexample) the 16-line
`CreatedAccountPage`: no `step` import, a bare `//Actions` comment, and a step-less
`clickOnContinueButton()`.

Direct entry still depends on the supported application contract: a transient
confirmation without direct entry documents the practice-3 exception.

## 12. One exported class per file — file name equals class name

Every file in `pages/` exports exactly one class, and the file name matches the class
name exactly. ❌ (illustrative counterexample) `TestCasesPage.ts` exports `TestCasePage` — grep for the
class and you miss the file.

## 13. No dead members

The agile rule (§4.11) cuts both ways: don't add ahead of need, don't keep behind need.
Unused locator fields, unread `url` fields, and commented-out methods are deleted — git
history remembers. ❌ (illustrative counterexample) `ProductQuantityPage` ships two unused locators
(`viewProductBtn_button`, `errorMessage_label`) and a commented-out validation method.

## 14. Know the legacy status of the existing pages — refine, don't rewrite

The three existing page files predate parts of the canon. When editing them, match the
file's local style and tighten only what you are already touching (§2 legacy note, §4.10);
never mass-rename working code. In **new** classes, use the canonical form:

| In `pages/` today | Status | Canonical form (new code) |
|---|---|---|
| `readonly loginEmail_Input: Locator` (public) | Legacy (§5) | `private readonly` locator fields |
| `login_Button`, `login_Error_Message` (capitalized/mixed suffix) | Legacy (§2) | Lowercase suffix: `login_button`, `loginError_msg` — see [element-locators](../../element-locators/SKILL.md) |
| `HomePage.viewProduct_Button(...)` (capitalized suffix on a dynamic locator method) | Legacy (§2) | Lowercase suffix: `viewProduct_button(...)` |
| `HeaderPage.assertUserLoggedinSuccessfully()` | Legacy alias (§5) | `verify*` prefix — see [validation-methods](../../validation-methods/SKILL.md) |
| `LoginPage.login()` interpolates the password into its step title | Known violation (§4.7) | Never put secrets in step titles — see [action-methods](../../action-methods/SKILL.md) |
| `HomePage` inline `page.goto('')`, no `url` field | Minor drift (§3) | Declare `readonly url` and use it in `navigate()` |

Report-facing behavior (step nesting, titles, attachment names) is preserved unless the
change is deliberate and verified in Allure (§4.10).

## Boundaries

This playbook does **not** cover:

- Selector strategy, locator naming vocabulary, strict-mode, collections →
  [element-locators](../../element-locators/SKILL.md)
- Action method internals: Allure step titles, parameter interpolation, granularity →
  [action-methods](../../action-methods/SKILL.md)
- Validation method internals: `verify*`, web-first assertions, expected-value params →
  [validation-methods](../../validation-methods/SKILL.md)
- Spec skeleton and page-object instantiation in hooks →
  [test-classes](../../test-classes/SKILL.md)
- `Apis<Domain>` / `Dbs<Domain>` service classes →
  [service-classes](../../service-classes/SKILL.md)
- Technical plumbing (retries, attachments, redaction) →
  [utility-classes](../../utility-classes/SKILL.md)

## Review checklist — page classes

- [ ] Class lives in `pages/`, named `<Name>Page`, models exactly one HTML page or one skeleton area — every locator owned by the page that renders it, no flow-named classes
- [ ] File exports exactly one class and the file name equals the class name
- [ ] Member order per §3: `page` → `url` (if routed) → `// Locators` fields → constructor → dynamic locator methods → `///// Actions` → `///// Validations`
- [ ] No `extends`, no `BasePage` — shared UI extracted into a skeleton page class, not inherited
- [ ] Constructor only stores `page` and initializes locators — no navigation, waits, or logic
- [ ] Each supported direct route has public async `navigate()`; fixed `url` follows `page`, route parameters are explicit and typed, construction is centralized, and the correct configured application/base URL is used
- [ ] `goto` occurs only in the owning navigation action, wrapped in one Allure step with ordinary return policy; arrival checks are separate `verify*` methods
- [ ] Routeless/shared and unsupported transient-entry exceptions state their reason; no fabricated URL or no-op navigation; direct-entry steps preserve prerequisites/context and link/menu/redirect scenarios retain their journeys
- [ ] New locator fields and dynamic locator methods are `private readonly` / `private`; nothing locator-shaped escapes the class
- [ ] Dynamic locator methods are synchronous, return `Locator`, use the type-suffix naming, and sit before `///// Actions`
- [ ] No `try`/`catch`, loops, or conditionals anywhere in the class
- [ ] No method returns `this` or another page object
- [ ] Validations sit last; banner contents match their claim (no actions under `///// Validations`); any legacy banner variant encountered was folded into the canonical banners
- [ ] Only what the current test needs was added — no speculative pages or methods
- [ ] No dead members — unused locator fields, unread `url` fields, and commented-out methods deleted
