# Reporting 3.7.1 acceptance

Owner-approved scope: publish the latest completed Allure single-file report at
`reports/allure-report/index.html`; retain older HTML only in
`reports/allure-history/<timestamp>[-NNN].html`; stage ordinary raw results at
`reports/allure-results/`. Consumer CI uploads only the current Allure HTML and
current Playwright HTML folder. Harness validation/release workflows are unchanged.

Allure video attachments default off and can be enabled independently of
Playwright recording. Screenshots, other attachments, test outcomes and verification
associations remain intact. Publication failures preserve the prior current report;
failed tests still produce reports. Archived filenames must not overwrite prior
runs, concurrent publication must remain coherent, and reopening old evidence must
not replace current HTML.

Keep immutable capture/generation evidence under `.harness/runs/allure/`, separate
from the user-facing report inventory. Existing 3.7.0 captures remain readable.
Copying the completed HTML to its published location preserves existing immutable
receipt paths and hashes without relocating verification evidence.

Retrieval: skipped (Python entrypoint unavailable on this Windows host); verified
the reporting implementation and callers directly.

## Validation

- The new layout acceptance test failed against 3.7.0's relative latest link before
  implementation, then passed against the new direct HTML publication.
- Publication/history and video regression checks: 21 passing tests, including
  concurrent completion, delivery retry without rerendering, occupied archive names,
  default/explicit video policy, `.env` import ordering and both scoped reporters.
- Native generation verification and locator checks: 30 passing tests; independent
  native invocations, failure/readiness gates, attachment nesting and link templates
  are preserved.
- Example TypeScript and framework conventions pass (19 files, 146 rules, no new
  failures or warnings). Independent read-only framework/adversarial review: APPROVE.
- Clean temporary source publication inventory passes: 446 classified files, 444
  packaged files, no findings. This checkout's ignored ChaosEngine overlay is excluded
  from that clean-source proof; no packaging rules or harness CI were changed.
- Harness validation/release workflow diff is empty. Remote PR, main and release
  candidate checks gate merging and publication.
