# Page: <slug>   <!-- copy this file to <slug>.md; delete guidance comments -->

## Identity
- URL pattern(s): `/<path>` <!-- one per line; parameterized segments as <id> -->
- Reached from: <page/action that navigates here>

## Elements
<!-- business name → BEST selector, chosen per element-locators order: id → name → data-qa → relative XPath → relative CSS.
     One row per element the tests interact with. Verified = seen working in a run (date). -->
| Element (business name) | Selector | Strategy | Verified |
|---|---|---|---|
| | | | |

## Login & session
- Requires login: yes/no — handle: `users.<handle>`
- Logged-in landmark (present): `<selector>`
- Logged-out landmark (absent): `<selector>`

## Rendered strings
<!-- EXACT strings the page renders, per locale — the authority for toHaveText expectations. -->
| Key (what it labels) | <locale-1> | <locale-2> |
|---|---|---|
| | | |

## Network
<!-- calls observed from this page: METHOD path → purpose → integration/ or Apis<Domain> candidate -->
| Call | Purpose | Candidate |
|---|---|---|
| | | |

## Gotchas
- <iframes, dialogs, timing quirks, captcha/OTP behavior, localization specifics (e.g. RTL)>

## Drift ledger
<!-- append-only: every selector repair lands here; three entries for one element = flag it in the next framework-review -->
| Date | Element | Old selector | New selector | Cause |
|---|---|---|---|---|
| | | | | |
