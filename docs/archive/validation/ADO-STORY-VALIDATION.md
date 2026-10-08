> Historical record. Read the [current documentation](../../azure-devops.md) for present behavior. Statements and validation results below describe their original implementation period.

# ADO story retrieval follow-up

Status: validated on Windows against synthetic fixtures; independent re-review
approved. This is an M12 follow-up on top of the accepted M17 package. It is recorded
under the changelog's Unreleased section; the package version is unchanged.

`fetch-ado-story.mjs --story <id>` retrieves the test cases linked to a user story
without plan or suite IDs; see [story-scoped retrieval](../milestones/M12-ADO.md#story-scoped-retrieval).
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
publication, automation marking and an automate-suite story route are out of scope
for that retrieval milestone. The current [automate-test skill](../../../.agents/skills/automate-test/SKILL.md)
uses the same retrieval adapter for story input to the generation workflow.

## PR pipeline installation follow-up

The original [PR validation run](https://github.com/MahmoudElSharkawy/Playwright-Harness/actions/runs/36941254526)
failed on both Windows and Linux before package checks. npm re-resolved a compatible
transitive range outside the cleared shrinkwrap: a local reproduction with CI's
npm 11.19.0 installed `@types/node` 26.6.4 instead of the audited 26.6.3. The strict
provenance check correctly rejected it; the story-retrieval tests were not reached.

The fresh, private validation consumer now receives version constraints derived
from the existing cleared lock. Package dependencies, lock contents and notices
are unchanged. The distributed lock must equal the source lock, and the existing
identity, URL, integrity, physical metadata and containment checks still apply.
Conflicting versions in a future lock fail explicitly rather than collapsing into
one constraint. This affects CI installation only, not consumer application policy.

Separately, npm's JSON stdout is parsed without stderr notices; combined diagnostics
remain preserved and hashed. Three new CI regressions cover scoped/relocated lock
entries, invalid constraints and a real child process emitting JSON plus a notice.
The focused CI suite passes all 19 tests. The actual installed archive's 14 package
checks pass on Windows with npm 11.19.0, including 790 tests with zero failures,
skips or cancellations. Conventions cover 16 example files / 61 rule applications,
7 generation files / 40 applications and 2 workflow files / 2 applications.
These checks do not claim live ADO coverage or replace the hosted native gates.

Independent review of the original 21-file story diff found one nonblocking issue:
the new `examples/package.json` shortcut `fetch:story` points to a consumer-local
script that does not exist. Use the documented package-root command; remove or
correct that shortcut separately. No story implementation was changed by the CI
repair. Hosted Windows/Linux browser, database, parallel and timeout gates remain
required on the updated PR.

## Example shortcut correction

The nonblocking shortcut finding above is corrected: the bundled example's
`fetch:story` resolves `../scripts/fetch-ado-story.mjs` in the parent harness package.
From the package's `examples` directory, invoke:

```sh
npm run fetch:story -- --project-root <separate-consumer-path> --story 200
```

Resolve the consumer path from the example directory. The consumer must remain
outside the installed package; the bundled example is immutable package content.
When copying the example manifest into a consumer, adjust this shortcut to the
actual installed package location, as with the documented package-root command.
Adoption does not copy harness scripts into the consumer.

The actual npm shortcut was checked from the example directory using an external
consumer path containing spaces. Entrypoint resolution and argument forwarding
passed; deliberately absent ADO configuration failed before any remote request.
This startup check does not claim live ADO retrieval.

## Remaining example shortcuts

The bundled `fetch:suite`, `check:conventions`, `harness:metrics`, `publish:results`
and `tracker` shortcuts now also resolve scripts in the parent harness package.
The example's Playwright `test` command remains local to its test project.
From the harness repository root, select the example manifest explicitly:

```sh
npm --prefix examples run fetch:story -- --project-root <separate-consumer-path> --story 200
npm --prefix examples run check:conventions -- --root <separate-consumer-path>
npm --prefix examples run harness:metrics -- --project-root <separate-consumer-path> --json
```

npm runs these scripts from the example directory even when called from the
harness root. Use an absolute consumer path or resolve it from `examples`.
As above, copying the manifest into a consumer requires adjusting all six harness
paths to its actual installed package location; adoption does not copy scripts.

Six regression tests invoke the actual npm shortcuts from both directories
(12 invocations), forwarding a separate consumer path containing spaces.
The convention check scans nonzero scope, metrics read synthetic verified state,
and the tracker renders a report into the consumer. The three ADO shortcuts
reach configuration validation and refuse deliberately absent configuration
before dispatch or writes. These are startup and local-behavior checks, with no
live ADO retrieval or publication claim. Before correcting the remaining paths,
five of these tests failed with missing entrypoints; the story test passed.
