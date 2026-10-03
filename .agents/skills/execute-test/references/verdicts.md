# Checks and observations

Use `check <key> --condition <index> --read "page|region eN|text eN|value eN|state eN|count eN <role>|url"`.
Expected values come from the frozen condition; `--value` and `--source` are
optional explicit cross-checks. `--exact` requests exact comparison; `--wait <ms>`
polls up to 120000 ms. Intermediate polling mismatches are not finalized FAILs.
Count reads support `button`, `textbox`, `link` and `checkbox` roles.

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
