# ADO story retrieval follow-up

Status: validated on Windows against synthetic fixtures; independent re-review
approved. This is an M12 follow-up on top of the accepted M17 package. It is recorded
under the changelog's Unreleased section; the package version is unchanged.

`fetch-ado-story.mjs --story <id>` retrieves the test cases linked to a user story
without plan or suite IDs; see [story-scoped retrieval](M12-ADO.md#story-scoped-retrieval).
It is read-only. Publication, linking and delivery adapters are unchanged. The suite
fetch now shares its case reader and consumer write flow with story retrieval; a
characterization test committed before that refactor pins the suite requests, source
fingerprint, manifest and case key order, rendered spec text and neutral source.

## Windows checks

Node 24.15.0, package version 3.0.17 with unreleased changes. All tests use synthetic
fixtures. Focused counts are subsets of the full suite, not additional coverage claims.

| Command | Actual outcome |
|---|---|
| `check:syntax` | PASS: 154 JavaScript files |
| `check:json` | PASS: 23 files, 22 parsed records; not schema validation |
| `check:links` | PASS: 109 Markdown files, 430 local links; anchors/remote links unperformed |
| `check:conventions` | PASS: 16 example files, 61 rule applications, zero findings |
| `check:generation-conventions` | PASS: 7 files, 40 rule applications, zero findings |
| `check:workflow-conventions` | PASS: 2 files, 2 rule applications, zero findings |
| `check:contracts` | PASS: 3 package contracts, 3 profiles, 2 sources, 26 scenarios |
| `typecheck:examples` | PASS: configured example TypeScript project |
| `test:integrations` | PASS: 120 tests, 27 new (1 suite characterization, 26 story) |
| `test:conventions` | PASS: 65 tests, 2 new story-folder scope tests |
| `test:adoption` | PASS: 18 tests, 3 new story-folder and overlap tests |
| `test` | PASS: 787 tests; zero failed, skipped or cancelled |
| `test:fetch` | PASS: 15 retained parser/renderer checks |
| `check:privacy` / `check:secrets` | PASS: 328 candidate files each |
| `check:provenance` | PASS: 370 dependency records; no new dependency |
| `check:publication` | PASS: 328 candidate / 326 packed files; offline inspection only |
| `check:ci` | PASS: all 14 fixed checks, including 787 tests in every package test file; zero failed, skipped or cancelled |

## Coverage

The transport maps a synthetic HTTPS collection to a real local HTTP fixture, whose
work-item batch returns only the requested fields. Story tests cover default Tested
By selection across collection, project-name and project-ID URL forms with
deduplication; the exact discovery and content field lists; canonical `--links`
order; child and related exclusions reported by ID with no content read; exactly
1000 links and 500 cases; localized category type names; and refusal of a test-case
ID, no selected links, only excluded links, foreign or alias hosts, another project's
path, a story in another project, a missing linked item, incomplete or wrong
categories, unclassified items, ownership changing between reads, 501 cases and 1001
links. Input is validated before any request. Story and suite retrieval produce
identical case objects, including nested shared steps. Neutral conversion, explicit
suite and story source loading, relink URL-matching parity and spec rendering are
covered.

CLI tests cover the story folder and neutral source, refinement preservation and
`--force`, a fingerprint that is stable under new exclusions and changes with the
story title, and refused manifests (destination, project, suite or story), previews,
unconvertible sources and unsupported options with nothing written. Convention,
metrics and tracker tests cover story folders, ignore look-alike folder names
(including the Git `--changed` scope), count a case shared with a suite folder once,
skip disagreeing results, ignore folders that have not verified a case yet and use
the newest verification.

## Review and boundaries

Base: `56e23da0be2a8af79a35f5cddcb64d1881e91e16`, the user's main branch.

The first independent review returned **APPROVE WITH NITS**. It reproduced the suite
path as byte-identical by running the pre-refactor tests against the pre-refactor
modules, and probed 20 edge URLs against the link matcher. Its findings were fixed:

| Finding | Correction |
|---|---|
| A case in a suite and a story folder was double-counted in metrics totals, and tracker sync kept whichever folder the filesystem listed last | Metrics count each case once; tracker sync reads folders in sorted order and skips disagreeing results with a warning instead of appending them to history |
| "Excluded content is never read" was not pinned; the fixture returned every field | The fixture batch returns only requested fields; tests pin exact discovery and content field lists |
| The tracker look-alike folder check could not fail | The registry includes the look-alike folder's case, so scanning it would change the event |
| Limits and two branches were untested at their edges | Exactly 1000 links / 500 cases succeed; project-mismatch manifest and suite source loading are tested |
| The linked validation record was not committed | Committed with final counts |
| Link-limit wording, the plan-tracker sync description and another project's link message | "1000 distinct linked work items"; the skill line names story folders; the message names the collection or project |

The re-review returned **APPROVE** and confirmed that metrics and tracker output is
unchanged when folders do not overlap, by comparing the previous and current scripts
on the same consumer. Its remaining low finding (a folder that has not verified a case
yet counted as disagreeing in metrics) and nit (metrics and tracker chose different
copies of an agreeing case) were corrected: unverified folders no longer disagree,
and both use the newest verification. Regression tests cover both.

Not changed by design: metrics and tracker accept any `ado-suite-`/`ado-story-`
folder suffix while convention checks require digits, as before for suites;
discovery keeps the client's fixed `errorPolicy: 'fail'`, so one unreadable linked
item fails the fetch; and whether a project-scoped batch returns other-project items
is unverified live (if it does not, the fetch fails rather than reading them).

Live tenant reads, permissions, process rules, the link URL forms a real organization
returns and ADO Server variants: **UNPERFORMED**. No tenant credentials were used and
no ADO work item, test result or pull request was created or changed. Story-scoped
publication, automation marking and an automate-suite story route are out of scope.
