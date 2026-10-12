# Search-first order targeting example

Run from the harness root:

```text
node --test harness-tests/list-search-targeting.test.mjs
```

The runner copies this consumer to a temporary project, reuses the installed example
dependencies and maintained `Expects.ts` facade, and starts the synthetic
[orders application](../list-search-app.mjs). No external application is contacted.
The browser and TypeScript dependencies must already be installed in `examples/`.

The fixture's observed Search control matches literal substrings of order numbers
across all accessible records. Searching resets the page and returns all matching
rows. Without search, two orders are rendered per page; `ORD-300` starts on page two,
while `ORD-3000` is a partial-match neighbour. Search refresh is asynchronous and keeps
stale rows until it finishes. `#search-complete` is hidden while pending and publishes
the submitted term only after the rows have been replaced. The page method waits for
that observed signal instead of a sleep or an empty-row snapshot.

The ordinary spec verifies exact order-number and customer cells in the same row
before opening it. Literal regex escaping protects quotes, brackets and metacharacters.
Duplicate order labels need a known customer identifier; two rows with the same
complete identity remain ambiguous. No method chooses `.first()` or `.nth()`.
An absent search yields zero results only within this fixture's all-accessible search
scope; that claim says nothing about records hidden by permissions in another app.
All data here is synthetic and public. Confidential terms/identifiers in a consumer
must follow the existing title, assertion and artifact protection rules.

The regression suite runs six ordinary scenarios in two separate Playwright processes
with unchanged assertions. The request audit proves that record targeting searches
without pagination, while the pagination scenario retains both page checkpoints and
its next-page action. It also checks native Allure steps, types and conventions.
`OrderTargetRejectionTests.spec.ts` contains technical failure probes excluded from
ordinary runs: the outer suite requires missing/ambiguous opens to fail without any
open request. These deliberate failures never earn verification greens.

The same application can switch to a first-page-only filter for a rejection probe.
The off-page identity check then fails despite zero visible matches. In a real
current-page filter or a list with no suitable search, record the limitation and use
only a fallback supported by observations and scenario intent: a supported direct
record route for arrangement, an approved API/DB lookup at the correct layer, or
documented bounded browsing through existing page methods. Clear incompatible filters
and establish the required sort/page state first. Never infer global absence, invent a
route, silently loop over pages, or replace pagination/sorting/browsing assertions.

The canonical rule is
[record targeting on list pages](../../../.agents/skills/pom-architecture/references/design-conventions.md#4b-record-targeting-on-list-pages).
