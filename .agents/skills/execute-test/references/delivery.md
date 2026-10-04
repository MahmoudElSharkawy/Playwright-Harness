# ADO delivery

Run `file-bugs <exec>` or `publish-results <exec>` to preview. All runs are
reassessed and source revisions checked only at this boundary. An integrity
failure blocks delivery until an explicit valid rerun replaces it; its old
audit record remains. Earlier valid FAILs still dominate.
One delivery operation owns an execution at a time; another receives `BUSY`.
After it completes, retries resume the persisted delivery identities and receipts.

Bug previews validate the process's Bug category, fields, required defaults,
picklists, area/iteration paths, duplicate tags and validateOnly request.
`.harness/integrations.json` can configure `ado.bugs` defaults. Use `--drafts <json>`
to edit title, severity, priority and notes, keyed by defect fingerprint. Set
`file: false` to exclude a specific defect. Default candidates are reliable matching
FAILs; `--include needs-review,diagnostics` explicitly includes those other categories.
Generated titles are bounded to ADO's limit; invalid edited titles identify the
fingerprint before any filing writes. Legacy eligibility is checked per occurrence.
ReproSteps and verified evidence remain source-derived.

An open fingerprint duplicate is skipped. A closed one gets a new bug with a
Related link. Filing IDs and fingerprint tags support recovery. A create whose
identity is unknown is reconciled by its filing tag before any new create.
No match means UNCERTAIN; use `--recreate <fingerprint>` only with authorization
to create another bug. Attachment acknowledgement identities survive interrupted
delivery, matched by operation and exact request fingerprint. An uncertain upload
does not block unrelated defects. After investigation, `--recreate <fingerprint>:<sha256>`
authorizes recreation of that specific attachment; it never replays other uploads.

Suite results group all parameter iterations: FAIL, else NEEDS_REVIEW, else
BLOCKED, else all-SKIPPED, else PASS. Review maps to ADO Blocked. No-verdict,
changed-revision and no-test-point cases are omitted and listed. Use
`--include-changed` to report captured revisions despite remote changes and
`--point-map <json>` for ambiguous points. Story scope does not publish outcomes.

Publication IDs are persisted before dispatch. Lost responses are reconciled by
paged List Runs with planId and exact client-side run-name matching. Repeated
commands resume that run. UNCERTAIN requires reconciliation or explicit `--new-run`.
New publications have distinct names; no automatic create retries occur.
Resume reassesses the saved run selection and reuses the persisted comments, point
mapping and publication identity, even if Bugs were filed afterward. Use `--new-run`
only for a deliberately new publication scope.

Only add `--execute` when the user authorizes that delivery. Preview validates
without external writes; execution revalidates with an invocation-local cache.
The core verdict stays independent of delivery status. This route has no
two-green automation requirement and never marks a case automated.
