# Element Locators — Playbook

Numbered practices for finding, naming, and declaring locators in this
Playwright/TypeScript framework. Examples illustrate the convention; named page files are illustrative consumer paths.
Shared law: [design-conventions](../../../../.claude/skills/pom-architecture/references/design-conventions.md).

---

## 1. Name every locator `camelCaseName_typeSuffix`

The name describes the element *and* names its type via a lowercase postfix from the
§2 vocabulary (`button`, `input`, `link`, `header`, `txt`, `img`, `icon`, `checkbox`,
`radio`, `dropdown`, `list`, `table`, `row`, `cell`, `form`, `msg`, `tab`, `card`,
`modal`, `section`). A reviewer must know what the element is without opening the DOM.

✅ Canonical (`src/pages/HeaderPage.ts`, `src/pages/HomePage.ts`):

```ts
readonly cart_link: Locator;
readonly testCases_link: Locator;
readonly logo_img: Locator;
readonly fullFledged_txt: Locator;
```

❌ Legacy — capitalized suffixes and mixed casing (`src/pages/LoginPage.ts`):

```ts
readonly login_Button: Locator;        // canonical: login_button
readonly loginEmail_Input: Locator;    // canonical: loginEmail_input
readonly login_Error_Message: Locator; // canonical: loginError_msg
```

❌ The real failure modes (illustrative counterexample — `src/pages/ContactUsFormPage.ts`,
`src/pages/ProductQuantityPage.ts`):

```ts
readonly file: Locator;                  // → uploadFile_input — the name must survive without reading the selector
readonly submitButton: Locator;          // → submit_button — the type lives in the suffix, nowhere else
readonly viewProductBtn_button: Locator; // → viewProduct_button — the type is stated once
readonly hoverBtn_button: Locator;       // targets the quantity <input> → quantity_input — name the element, not the gesture performed on it
```

When migrating legacy suffixes, map them onto the §2 vocabulary — which is **closed**:
extending it is a design-conventions change, never a per-file invention.

| Legacy suffix | Canonical |
|---|---|
| `_Text` / `_Label` | `txt` — or `msg` when the element is a feedback message |
| `_Title` | `header` |
| `_CheckBox` | `checkbox` |
| `_radioButton` | `radio` |
| `_image` | `img` |
| `_TextArea` | `input` — the §2 `input` covers every fillable control, textarea included |

Per §2's legacy note: match the local style when editing an existing file; do not
mass-rename working code. New files use the lowercase suffix, always.

## 2. Declare locators `private readonly` — they never leave the page class

Encapsulation is iron law §4.2: specs and other classes interact only through action
and validation methods. `private` blocks the leak at compile time; `readonly` blocks
reassignment.

✅ Canonical for any **new** page class:

```ts
// Locators
private readonly acceptCookies_button: Locator;
```

The existing `readonly` (public) fields in `src/pages/LoginPage.ts`, `src/pages/HomePage.ts`,
and `src/pages/HeaderPage.ts` are legacy per §5 — tighten to `private readonly` only when
you are already editing that file for another reason.

❌ Never do this in a spec, whatever the visibility allows:

```ts
await loginPage.login_Button.click(); // spec reaching into a page class — push it into an action method
```

## 3. Choose the selector by the evaluation order

Work down this list and stop at the first strategy the element supports. Each step down
trades reliability or speed, so a jump must be justifiable in review.

| # | Strategy | Playwright form | Project example |
|---|---|---|---|
| 1 | Id | `page.locator('#slider-carousel h2')` | `fullFledged_txt` in `src/pages/HomePage.ts` |
| 2 | Name attribute | `page.locator('[name="email"]')` | (none in the app yet — use when present) |
| 3 | Stable test attribute | `page.locator('[data-qa="login-email"]')` | `loginEmail_Input` in `src/pages/LoginPage.ts` |
| 4 | Relative XPath (handcrafted) | `page.locator('//i[@class="fa fa-lock"]//parent::a')` | `signupLoginLogout_link` in `src/pages/HeaderPage.ts` |
| 5 | Relative CSS | `page.locator("ul.nav.navbar-nav a[href='/test_cases']")` | `testCases_link` in `src/pages/HeaderPage.ts` |

Notes:

- Tier-1 id selectors are written in CSS form — `page.locator('#address_delivery')`.
  Playwright's `id=` selector-engine prefix is banned: ❌ (illustrative counterexample,
  `src/pages/CheckoutPage.ts`) `page.locator('id=address_delivery')` — it is a third
  syntax in review and cannot take descendant/child parts. Convert legacy `id=`
  locators opportunistically.
- A dedicated test attribute like `data-qa` counts as tier-3 gold: it is owned by the
  team, not by styling. `src/pages/LoginPage.ts` models this for every form control:

  ```ts
  this.loginEmail_Input = page.locator('[data-qa="login-email"]');
  this.loginPassword_Input = page.locator('[data-qa="login-password"]');
  this.login_Button = page.locator('[data-qa="login-button"]');
  ```

- Relative CSS is slightly faster than XPath but plain CSS cannot select by text or
  index. In Playwright the gap is covered by chaining and the `{ hasText }` option
  (see practice 6) — prefer that over falling back to XPath text functions.
- Locator reliability is earned through experience and review — there is no formula.
  When two strategies both work, pick the one that survives the most likely DOM change.

## 4. Handcraft relative XPath — never copy from devtools, never absolute

A devtools-copied path encodes the entire accidental DOM ancestry and dies on the first
layout change. Handcrafted relative XPath anchors on something meaningful and navigates
minimally.

✅ Canonical — anchor on a stable feature, then one axis step (`src/pages/HeaderPage.ts`):

```ts
this.signupLoginLogout_link = page.locator('//i[@class="fa fa-lock"]//parent::a');
this.deleteAccount_link = page.locator('//i[contains(@class,"fa fa-trash-o")]//parent::a');
```

Note: CSS `:has()` is the CSS-tier twin of this parent-axis anchoring —
`page.locator('a:has(i.fa-user)')` (illustrative counterexample, `src/pages/SignupPage.ts`) resolves the
same element as `//i[contains(@class,"fa-user")]//parent::a` (`src/pages/HeaderPage.ts`);
both are acceptable at their tiers — pick **one** idiom per element. One element = one
locator field: the illustrative counterexample's `SignupPage` declares `accountCreated_Label` and
`accountCreated_title` on the same `[data-qa="account-created"]` selector — a second
field with the same selector under another name is a review reject.

❌ Anti-patterns (from the team locator SOP):

```ts
page.locator('/html/body/section/div/div[2]/div/ul/li[3]/a'); // absolute path — forbidden
page.locator('//*[@id="header"]/div/div/div/div[2]/div/ul/li[4]/a'); // devtools copy-paste — forbidden
page.locator('//div/div/ul/li/a/i/span'); // tree chaining > 4 tags — restructure the anchor
```

## 5. Prefer exact matches; use `contains()` only for a class token among many

`contains()` widens the match surface — every use is a chance to catch the wrong
element. It is justified exactly when you match one CSS class token inside a
multi-class attribute; when you know the full stable value, match it exactly.

✅ Justified `contains()` — `fa-user` is one token among several
(`src/pages/HeaderPage.ts`):

```ts
this.userProfile_link = page.locator('//i[contains(@class,"fa-user")]//parent::a');
```

✅ Exact match when the full value is stable (`src/pages/HeaderPage.ts`):

```ts
this.products_link = page.locator('//i[@class="material-icons card_travel"]//parent::a');
```

❌ Excessive `contains()` when a cleaner match exists — and note that in CSS, class
tokens have a native selector. `src/pages/HomePage.ts` shows the clean form:

```ts
this.logo_img = page.locator('.logo img'); // class-token selector — robust to added classes
```

When matching by class, match the minimal **semantic** token — never
styling-framework chains, which belong to the stylesheet, not the element:

```ts
✅ page.locator('button.cart');                // 'cart' is the element's own semantic class
❌ page.locator('.btn.btn-default.check_out'); // (illustrative counterexample) btn/btn-default are Bootstrap theme classes — a restyle kills the locator without the element changing
```

Legacy tolerance: `src/pages/LoginPage.ts` uses the exact-attribute form
`page.locator("div[class='login-form'] h2")`, which breaks if any class is added to the
element. Canonical CSS for class matching is the token selector (`.login-form h2`).
Fix opportunistically when already editing the file.

Hygiene: write attribute names lowercase and consistently. `src/pages/HeaderPage.ts` has a
legacy `//ul//i[@Class="fa fa-shopping-cart"]//parent::a` — the capitalized `@Class` is
non-portable across selector engines; new code writes `@class`.

## 6. Build dynamic locators as parameterized `Locator`-returning methods

When the target depends on runtime data (a product name, a row key), a constructor
field cannot express it. Write a method that returns a `Locator`, named exactly like a
locator field (`name_typeSuffix`), placed after the constructor per §3 anatomy.

✅ Illustrative example (`src/pages/HomePage.ts`) — note the legacy capitalized `_Button`
suffix (§2 legacy note): a new dynamic locator method is named `viewProduct_button`
(practice 1):

```ts
viewProduct_Button(productName: string): Locator {
  return this.page
    .locator("div.product-image-wrapper", { hasText: productName })
    .locator("a[href^='/product_details/']");
}
```

Action methods then consume it like any field:

```ts
async clickViewProduct(productName: string) {
  await step(`Click View Product for ${productName}`, async () => {
    await this.viewProduct_Button(productName).click();
  })
}
```

❌ Anti-pattern — string-interpolated XPath for the same job:

```ts
page.locator(`//div[contains(text(),'${productName}')]/../..//a`); // brittle text + blind ancestor hops
```

Clarification: interpolating the parameter into a stable **attribute value** is legal —
what stays forbidden is interpolating text content or structure (use `{ hasText }` +
chaining as above). Caveat: attribute interpolation assumes the parameter contains no
quotes. ✅ Sound (illustrative counterexample, `src/pages/ProductsPage.ts`):

```ts
return this.page.locator('a[href="/product_details/' + productId + '"]');
// new code writes it as a template literal: `a[href="/product_details/${productId}"]`
```

In new page classes declare these methods `private`, same as fields (practice 2).

## 7. Match on text only in the two allowed cases

Text is copy — it changes with wording, localization, and whitespace. The SOP allows
text matching in exactly two situations:

- **(a) Asserting an exact expected message.** The text belongs in the *assertion*, fed
  from test data — the locator itself stays structural. `src/pages/LoginPage.ts` models
  this: the locator is `//div[@class="login-form"]//p` and the expected text arrives as
  a parameter to `verifyErrorMessage(expectedMessage)`, asserted via `toHaveText`.
- **(b) Selecting a data row/card by its unique text.** Use Playwright's `{ hasText }`
  filter, as `viewProduct_Button` does above — scoped to a container, not the page.

❌ Anti-patterns:

```ts
page.locator('text=Logout');            // link-text navigation — forbidden (SOP: no link/partial-link text)
page.getByText('Signup / Login');       // same failure mode, different API
page.locator('//a[contains(text(),"Cart")]'); // partial text on navigation — forbidden
```

Navigation elements get structural locators — see `cart_link` and `testCases_link` in
`src/pages/HeaderPage.ts`.

## 8. Respect strict mode — make the selector unique, don't paper over it

Playwright locators are strict: acting on a locator that resolves to multiple elements
throws. That error is a design signal — the fix is a more specific selector, not a
reflexive `.first()`.

Indexing (`.first()`, `.nth(n)`, `//div[3]`) is allowed only **deliberately, on a
static structured collection**, where position *is* the identity. `src/pages/HomePage.ts`
does this on the carousel, whose slides are fixed markup:

```ts
await expect(this.fullFledged_txt.first()).toHaveText(expectedText);
```

❌ Anti-pattern — index as a bug-silencer:

```ts
page.locator('div.product-image-wrapper a').nth(3); // which product? unknowable in review
```

Sibling-combinator ladders and `:nth-child()`/`:nth-of-type()` on dynamic content are
the CSS twins of `//div[3]` — position as identity. ❌ (illustrative counterexample,
`src/pages/ProductDetailsPage.ts`):

```ts
this.productAvailability = page.locator('.product-information span + p');
this.productCondition = page.locator('.product-information span + p + p');
this.productBrand = page.locator('.product-information span + p + p + p');
```

If two fields differ only by one more positional hop, neither identifies its element —
anchor each on its own feature or escalate to a `data-qa` attribute.

If you reach for `.nth()` on dynamic data, you needed a parameterized locator method
(practice 6) instead.

## 9. Reserve class-only and tag-only selectors for collections

A bare class or tag selector (`page.locator('.product-image-wrapper')`,
`page.locator('tr')`) legitimately matches many elements — that is its job. Use it when
the action or validation genuinely targets the collection (counting rows, iterating
cards via a `utils/` helper), and pair it with a plural-reading name
(`productCards_list`, `userRows_row`). For a single element, a bare class/tag selector
is an under-specified locator — climb back up the evaluation order (practice 3).

## 10. End every locator on the interactive element

The element you act on is the `<a>`, `<button>`, or `<input>` — never anchor on or
terminate at a bare decoration tag (`u`, `b`, a styling `span`) inside or above it.
Terminating on decoration clicks the wrong element; routing through it adds only
fragility.

❌ Both from the illustrative counterexample:

```ts
page.locator("//p[@class='text-center']/a[@href='/view_cart']/u"); // the click targets the underline element (src/pages/ProductQuantityPage.ts)
page.locator('//u//parent::a[@href="/login"]');                    // ends on the <a>, but the <u> detour adds only fragility (src/pages/CartPage.ts)
```

Both collapse to a direct href match: `a[href="/view_cart"]`, `a[href="/login"]`.

## 11. File uploads target the raw `<input type="file">`

`setInputFiles()` operates on the `<input type="file">` itself, never the styled
button in front of it — Playwright can set files on a visually hidden input. Find it
by the normal evaluation order (id/name/data-qa first) and name it `<purpose>_input`
(e.g. `uploadFile_input`).

❌ (illustrative counterexample, `src/pages/ContactUsFormPage.ts`) — XPath on a form whose sibling
controls all carry `data-qa`; even the same match belongs at the CSS tier
(`input[type="file"]`), and only after checking the higher tiers:

```ts
this.file = page.locator('//input[@type="file"]');
```

## 12. Full anti-pattern list (team SOP + this playbook — all forbidden)

- Link text / partial link text matching for navigation (any API form: `text=`,
  `getByText`, XPath `text()`), outside the two practice-7 exceptions.
- Selectors copy-pasted from browser devtools.
- Absolute paths starting `/html/body/...`.
- Playwright's `id=` selector-engine prefix — id selectors use the CSS `#` form
  (practice 3).
- Styling-framework class chains like `.btn.btn-default.check_out` — match the
  minimal semantic token (practice 5).
- Over-indexing (`//div[3]`, casual `.nth()`, sibling-combinator ladders,
  `:nth-child()`/`:nth-of-type()` on dynamic content) except deliberately on static
  structured collections (practice 8).
- Locators that terminate on or route through decoration tags (`u`, `b`, styling
  `span`) (practice 10).
- Locator trees chaining more than 4 tags.
- Excessive `contains()` when a cleaner exact or token match exists (practice 5).

---

## Boundaries

This skill does **not** cover:

- Where locator fields and dynamic locator methods sit in the class file, the
  `// Locators` banner, or constructor wiring → [page-classes](../../../../.claude/skills/page-classes/SKILL.md)
- Action-method bodies, Allure step titles, or what to do after locating
  → [action-methods](../../../../.claude/skills/action-methods/SKILL.md)
- Web-first assertions run against located elements
  → [validation-methods](../../../../.claude/skills/validation-methods/SKILL.md)
- `<op>_serviceName` / `<op>_query` string fields in `apis/`/`dbs/` classes (same
  postfix convention, different layer) → [service-classes](../../../../.claude/skills/service-classes/SKILL.md)
- Where expected texts and inputs live → [test-data](../../../../.claude/skills/test-data/SKILL.md)

## Review checklist — locators

- [ ] Every locator named `camelCaseName_typeSuffix` with a lowercase suffix from the closed §2 vocabulary (legacy suffixes mapped per practice 1); the name states the type once and describes the element, not the gesture
- [ ] New page classes declare locators (and dynamic locator methods) `private readonly` / `private`; no locator or `Locator` value escapes the page class
- [ ] Each selector sits as high as possible on the evaluation order (id → name → data-qa → relative XPath → relative CSS); any jump down is justifiable; id selectors use the CSS `#` form, never the `id=` prefix
- [ ] No devtools-copied selectors, no absolute `/html/body/...` paths, no chains longer than 4 tags
- [ ] XPath is relative and handcrafted; `contains()` used only for a class token among many; attribute names lowercase
- [ ] Class matching uses the minimal semantic token — no styling-framework chains (`.btn.btn-default...`)
- [ ] Text matching appears only as an exact-message assertion (text from test data) or a `{ hasText }` row/card selection scoped to a container
- [ ] No `.first()`/`.nth()`/`[n]`, sibling-combinator ladder, or `:nth-child()` masking a non-unique selector; deliberate indexes only on static structured collections
- [ ] Every locator ends on the interactive element — no decoration-tag (`u`, `b`, styling `span`) targets or detours
- [ ] File uploads call `setInputFiles()` on the raw `<input type="file">`, named `<purpose>_input`
- [ ] Bare class/tag selectors used only for genuine collections, named as plurals
- [ ] One element = one locator field — no second field with the same selector under another name
- [ ] Runtime-dependent targets use parameterized `Locator`-returning methods; interpolation only into stable attribute values (quote-free parameters), never into text or structure
