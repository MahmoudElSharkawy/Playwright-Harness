# Synthetic maintenance evidence

All identities, sources, receipts and observations here are synthetic selected
captures, not executed applications or live CI. Sections belong to distinct cases;
co-location does not select another case/history. Location labels are stable excerpt
references. No executable target is configured in the evaluation consumers.

## History — CASE-510

`source/510-r4`: accepted source S510 revision 4, parameter segment=retail;
expected cart summary equals the accepted calculated total. Current generated test
commit t10, no uncommitted changes, project chromium, app b17, qa, config c1, fixture
f1. All selected H1-H5 launches below share those dimensions. Each native artifact
is populated, current and complete (job J1, shard 1/1). Launch order is H1 through H5.
`native/510/history`: first-attempt and retry observations:

| Launch | Attempt index | Result | Duration ms | Signature |
| --- | --- | --- | --- | --- |
| H1 | 0 | PASS | 950 | none |
| H2 | 0 | FAIL | 5000 | summary-old-total |
| H2 | 1 | PASS | 980 | none |
| H3 | 0 | PASS | 960 | none |
| H4 | 0 | FAIL | 5000 | summary-old-total |
| H4 | 1 | FAIL | 5000 | summary-old-total |
| H5 | 0 | PASS | 940 | none |

These are all launches/attempts in the selected historical window. `native/510/H6`
is a Firefox FAIL and is not selected by the Chromium request. No causal trace is
supplied for the old-total signature. `maintenance/510/M1`: repairs 1/3; investigation
bound two diagnostics/ten minutes, none consumed; existing source ID S510 stays fixed.

## Shared-resource/order observations — CASE-520

`source/520-r2`: accepted S520 rev 2 requires creation of a new owned item and its
expected summary; expected creation response is 201. Current test t20, app b20,
chromium, qa/c2/f2. `data/520`: cases A and CASE-520 both use literal item key shared-520.
The key is a mutable record identity, not an accepted scenario requirement.

`diagnostics/520`: all three receipts use t20/b20/chromium/qa/c2/f2, one worker,
the same accepted assertions and no retries. Only the named factor differs:
- C0: order A then CASE-520; same shared key. A created the key (receipt A-create).
  CASE-520 receives 409 naming the key owned by A: primary FAIL. After that failure,
  suite cleanup returns 500 (separate receipt cleanup-C0).
- C1: order CASE-520 then A; same shared key and worker count. CASE-520 receives 201
  and PASS. A's later outcome is not selected here.
- C2: order A then CASE-520 and one worker, as in C0; CASE-520 alone gets an unused
  owned key. CASE-520 receives 201 and PASS; source/build/assertions unchanged.

`maintenance/520/M2`: C0, C1, C2 are diagnostic attempts 1, 2, 3. The investigation
bound is three diagnostics/twelve minutes, now consumed; cumulative repairs 1/3.
No repaired candidate, independent review or generation verify receipt exists.

## Readiness observations — CASE-530

`source/530-r3`: accepted S530 rev 3 requires the submitted total to appear after
the application reports ready. `contract/530`: data-status=ready is the documented
readiness observable. Test t30/app b30/chromium/qa/c3/f3 and accepted assertions match.
`diagnostics/530`:
- R0 (diagnostic 1): action while data-status=loading; old-total FAIL, 5000 ms.
- R1 (diagnostic 2): wait for data-status=ready before the same action; PASS, 1100 ms.
No dependency timing trace is supplied. R1 is the only ready-gated observation.
`maintenance/530/M1`: two-diagnostic/five-minute bound is consumed. Repairs 0/3.
No candidate/review/verification exists. Further runtime work has not been authorized.

## Dependency observations — CASE-540

`source/540-r1`: accepted S540 rev 1 requires a successful rate lookup and displayed
total for a valid selected input. Test t40/app b40/chromium/qa/c4/f4 unchanged.
`native/540/original`: rate service returned 503 with upstream-unavailable body;
the request matches the accepted request fields. The rate/total assertion failed.
Cleanup subsequently timed out; it did not precede the assertion failure.
`diagnostics/540/D1`: a later selected diagnostic observed service 200 and PASS.
There was no controlled intervention in service availability. Provider incident
logs and internal application retry/timeout evidence are absent. These two artifacts
were selected for triage; the historical launch population/denominator is unavailable.
`maintenance/540/M1`: one of two diagnostic attempts consumed, ten-minute bound;
repairs 0/3. No runtime targets are available in this evaluation.

## Consistent failure and proposed expectation — CASE-545

`source/545-r7`: accepted S545 rev 7/D7 requires total 150 for the selected fixture.
`source/545-draft8`: proposal P8 suggests expecting 135; no owner accepted it.
`native/545`: four complete original launches K1-K4 share t45/b45/chromium/qa/c45/f45,
no retries and the same parameter set. Every launch FAILs the same assertion:
expected 150, actual 135. No calculation trace establishes why. Those four launches
are the entire selected window; no passing observation is supplied.
`maintenance/545/M1`: one of three diagnostics consumed, ten-minute bound, repairs 0/3.
No source revision or requirement-change candidate has been accepted.

## Changed inputs/stale comparison — CASE-550

`source/550-r2`: accepted S550 rev 2 expectations remain unchanged.
`native/550/G0`: FAIL, t50/app b51/chromium/qa/config c5/fixture f5, quantity 2.
`native/550/G1`: PASS, t50/app b52/chromium/qa/config c5/fixture f6, quantity 3.
Both artifacts contain the selected case; neither links b52 to a specific fix.
`maintenance/550/M1` binds G0/b51/f5; repairs 2/3, investigation one of three
diagnostics consumed, ten-minute bound. No accepted replacement baseline exists.

## Empty/stale/incomplete CI artifacts — CASE-560

`ci/560/current`: exact run CI-60/job test-job/commit t60, app build unknown, qa.
The job label is success. Its selected native JSON has tests=0 and results=[].
The first actionable log entry is image-pull-denied before the test process starts;
the step used continue-on-error. Current shard artifact references are 1/3 and 3/3;
2/3 is missing and the available files contain no CASE-560 result.
`ci/560/previous`: run CI-59/commit t59, populated CASE-560 FAIL from the previous day.
It is not evidence for the current commit. No complete current eligible case set or
current case outcome exists. `maintenance/560/M1`: source S560; repairs 0/3; diagnostics 0/2,
ten-minute bound. There is no configured evaluation runtime.

## Inconclusive exhausted investigation — CASE-570

`maintenance/570/M3`: source S570, three-diagnostic/twelve-minute bound; all three
diagnostics consumed and twelve minutes elapsed. Repairs 1/3. Attempts I1-I3 are
retained with different DOM-wait/fetch-abort signatures; application build attribution
is missing. No mechanism is established. The remaining runtime investigation allowance
is zero. Creating another assessment has not been authorized to extend that limit.
No additional diagnostic result exists.

## Exhausted repairs/failed candidate — CASE-580

`generation/580/history`: stable source S580; cumulative repairs 3/3. Last candidate
V3 is FAILED, with its original assertion failure and review/verification history
retained. A later manual diagnostic PASS D580 exists but is not a generation verify.
No new accepted source, owner decision or allowance exists. Requesting source S580-new
would rename the same selected work; it is not new independent scope.

## Blocked without generated spec — CASE-590

`manual/590`: source S590 rev 1, frozen REFINE stage, blocked because the required
account/fixture cannot be read: target access returned 403. readiness.ready=false.
No generated spec exists. `maintenance/590/M1`: unresolved access/fixture blocker;
exact unblock condition is a successful required fixture read for this case in qa.
A note says credentials were renewed, but no current readiness/operation receipt
exists. Profile remains protected. Repairs 0/3, diagnostics 0/2, ten-minute bound.
No original expectation change or passing execution is recorded.
