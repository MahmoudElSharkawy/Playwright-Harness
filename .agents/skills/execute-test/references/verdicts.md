# Checks and observations

Use `check <key> --condition <index> --read "page|region eN|text eN|value eN|state eN|count eN <role>|url"`.
Expected values come from the frozen condition; `--value` and `--source` are
optional explicit cross-checks. `--exact` requests exact comparison; `--wait <ms>`
polls up to 120000 ms. Intermediate polling mismatches are not finalized FAILs.
Count reads support `button`, `textbox`, `link` and `checkbox` roles.

`text` reads displayed text; `value` reads a form value (for example a selected
option's internal code). Page/region text includes selected dropdown labels and
excludes hidden content, unselected options and editable-value echoes. Readers
visit open shadow roots and assigned slots once, and readable same-origin frames.
Unreadable/cross-origin frames leave coverage gaps: positive evidence can prove
presence or disprove absence, but incomplete coverage cannot prove absence, exact
equality or a count. Closed shadow roots are outside coverage. Scoped reads require
membership in the fresh snapshot; page-wide reads require a fresh document snapshot.
Evaluation runs in the page's JavaScript world; snapshot membership does not protect
against page scripts replacing DOM APIs.

Explicit `--value` follows the frozen expected type: `42` and `10.00` stay strings
when the expected value is a string; counts remain numeric. Polling stores decisive
evidence, agreeing absence observations and a bounded summary, not every interim read.

Each check reads now and registers its own snapshot and read output. Only a read
matching subject, predicate and expected value resolves the condition. Supporting
comparisons cannot decide its verdict. Presence/absence reject empty expected
text (page searches need at least three non-whitespace characters). Absence needs
two agreeing reads at least one second apart. Empty equality is valid.

`capture <name> --read ...` creates a typed output for later conditions or steps.
A same-subject browser capture is not its own oracle, even after hover or navigation.
Reading back a field typed in the same step is refused; a later frozen step may
check it. Missing or assumed expected data stays unresolved.

`observe <key> PASS|FAIL --condition <index> --evidence <id,id> --observed <facts>
--rationale <reason> --why-not-checked no-traceable-value|visual-only|not-readable|composite`
also requires `--actual <behavior>` for FAIL. Browser observations must cite a
registered snapshot from the observed state; visual judgments also cite a
screenshot. Name mandatory quoted/numeric/parameter literals.
Literals alone never produce a pass.

Verification-only/read steps need no action first. In other steps, final checks
follow the first action; preconditions precede it and remain historical.
Later agent changes stale final-state PASSes. Finalized FAILs remain historical.
`invalidate <seq> --reason wrong-target|misread-condition|premature-evidence`
caps the condition at INDETERMINATE; a later PASS cannot clear it.
Explicit indeterminate rulings also survive subsequent page changes.

Aggregation order: ambiguity/synthetic; invalidated FAIL; matching checked FAIL;
checked PASS plus observed FAIL → contradiction; observed FAIL; declared
indeterminate; matching/observed PASS; otherwise unresolved. Every condition must
pass for its source expectation to pass. Checked and grounded observed verdicts
are reliable and labeled; unresolved means NEEDS_REVIEW.

Use `indeterminate <key> --reason ambiguous-expected|missing-reference-data|insufficient-evidence|blocked-by-defect`.
Native failures poison new judgments. End-step preserves earlier FAILs and valid
preconditions. Never-captured required evidence means insufficient evidence;
changed/missing registered artifacts cause INTEGRITY FAILURE with no verdict.
Diagnostics are contextual observations and never alter test verdicts.

New browser assertions use `execute-assertion/2`: frozen conditions, comparisons,
read artifact IDs/digests and bounded excerpts. Reassessment verifies the same bytes
it parses and recomputes comparisons. Large reads are stored once, outside the
64 KiB assertion record. `/1` remains readable legacy evidence; its browser
occurrences cannot supply new Bugs or attachments, and cases depending on them
(including historical FAILs) cannot be published. Valid API/DB defects remain eligible.
