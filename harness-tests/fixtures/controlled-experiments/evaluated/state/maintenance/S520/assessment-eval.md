# CASE-520 maintenance assessment

The supplied contrasts strongly support a test-data ownership collision as the primary C0 failure mechanism. CASE-520 tries to create a new item using A's already-owned key. The later cleanup 500 is a separate failure whose cause remains unknown.

## Scope and retained history

Offline /maintain-test assessment of synthetic captures. Selected evidence: evidence.md, "Shared-resource/order observations — CASE-520", labels source/520-r2, data/520, diagnostics/520 and maintenance/520/M2; retained .harness/state/maintenance/S520/prior.md remains intact.

| Binding | Supplied value |
| --- | --- |
| Accepted source | S520 revision 2; create a new owned item and expected summary; creation must return 201 |
| Test/application/target | t20/b20/Chromium/qa/c2/f2 |
| Mutable dependency | A and CASE-520 use literal item key shared-520; this is not an accepted required scenario value |
| Controls | Same test/build/browser/environment/configuration/fixture, one worker, accepted assertions, no retries |
| Retained limits | C0-C2 are diagnostics 1-3; three-diagnostic/twelve-minute bound exhausted; repairs 1/3 |
| Unknown | Working-tree changes, parameters beyond key, elapsed time, durations/timestamps, CI/job/shard IDs, spec/service paths, generation stage/status and tracker mapping |

## Actual observations and contrasts

| Attempt | Changed factor and actual outcome | Interpretation |
| --- | --- | --- |
| C0 | A then CASE-520; shared key. A-create records A's creation. CASE-520 gets 409 naming A's owned key: primary FAIL. cleanup-C0 later returns 500. | Direct collision evidence before the summary can be accepted; cleanup did not cause the preceding 409. |
| C1 | Change only order to CASE-520 then A; same key/workers. CASE-520 gets 201 and PASS. A's later outcome is unselected. | Supports order sensitivity through prior resource state; does not show both cases pass together. |
| C2 | Retain C0 order A then CASE-520 and one worker; change only CASE-520's key to an unused owned key. Response 201 and PASS. | Isolates resource identity from order, supporting collision rather than order alone. |

These deliberate diagnostic contrasts are not a historical cohort. The supplied selected outcomes are one primary FAIL and two PASS observations in three diagnostic receipts, not a historical failure rate. Historical launch population/denominator is unavailable. There are no retries in this set, so no retry-recovery rate has an eligible denominator. Durations are unknown.

## Competing explanations

| Hypothesis | Support, contradiction and disconfirmation |
| --- | --- |
| Reused mutable identity causes the 409 | Strong support: A owns the exact key in C0; retaining order with an unused CASE-520-owned key passes in C2. The same collision 409 on a verified unused owned key would challenge sufficiency. |
| Order itself causes another hidden dependency | C1 is compatible, but C2 passes while A remains first, weakening order alone. Other order effects outside these captures remain unknown. |
| Parallel-worker race | Every receipt has one worker; concurrency is unnecessary for the observed collision. A worker-count change is not the smallest next check. |
| General creation/summary defect or transient availability | C1/C2 pass unchanged assertions; C0 identifies a specific existing foreign key. These captures do not exclude every product fault. |
| Cleanup caused the primary failure | Contradicted by ordering: 409 precedes cleanup 500. Cleanup can still be an additional defect affecting later state. |

Classification: supported automation/test-data isolation defect for C0; high confidence in the proximal collision mechanism under these conditions. A 409 for A's existing key does not establish a product defect. Cleanup-C0 remains separately unknown/needs-investigation; do not replace the primary failure or claim cleanup repaired.

## Impact and next action

Expected 201 and summary remain unchanged. The supported repair recommendation is a valid identity unique to CASE-520 and the run, owned by that case, instead of A's record. No repair was applied. The shared key dependency between A and CASE-520 is supplied; actual spec, JSON fields, seeding/cleanup methods and other callers are absent. Inspect those mappings before changing a shared helper. Future verification scope should cover CASE-520, the evidenced A/CASE-520 ordering interaction and relevant ownership/cleanup paths with unchanged accepted assertions; A's unselected outcome remains unknown.

Stop runtime diagnostics: the attempt bound is exhausted and C0/C2 already provide the useful ownership contrast. The maintenance/automation owner should use the supplied evidence for the supported isolation repair through the existing workflow when authorized. Keep S520 and cumulative repairs 1/3. A future registered repair consumes the existing allowance and requires independent framework review plus two fresh independent scoped green processes. C1/C2 are diagnostics, not generation greens.

| Blocker | Unblock condition and next owner/action |
| --- | --- |
| Exhausted investigation | Owner decision within the existing contract before further diagnostics; a new assessment/source ID cannot extend the limit |
| Cleanup/uncertain effects | Owning runtime reconciles CASE-520's attempted identity and A's separate ownership, verifies required cleanup and preserves foreign records |
| No candidate/review/verify receipts | Existing automation owner completes normal repair gates before completion |
| No configured runtime | Proposed execution needs an approved target and authority outside this assessment |

No code, application, tracker, candidate, bug or handoff was changed. Original C0 and cleanup failures remain separately retained. Diagnostic consumption remains 3/3 and repairs 1/3.
