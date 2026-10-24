# Impact analysis: ambiguous-id

## Change

Request: "Analyze bug 456"; **project not selected**. Two supplied synthetic captures identify different bugs. Their shared numeric ID does not bind a single source.

| Candidate identity | Located capture evidence | What it supports |
| --- | --- | --- |
| Cedar / Bug 456 / revision 5 / Resolved | capture/cedar-456.json#/item, labelled URL https://dev.azure.com/example-org/Cedar/_workitems/edit/456 | A reported checkout symptom: old total after quantity changes. The capture names proposed F456 and supplies no deployment/passing-retest receipt. |
| Birch / Bug 456 / revision 2 / status unknown | capture/birch-456.json#/item | A different reported symptom: profile avatar not displayed. It is unrelated to Cedar cart. |

All citations are labels in the supplied evidence.md, not authenticated live tracker responses. No project-specific change baseline can be selected from the request.

## Impact map

| Potential area | Support | Disposition |
| --- | --- | --- |
| Cedar checkout quantity/total behavior | Cedar capture's reported symptom | Supported only as that candidate's reported behavior area. Technical change, callers and regression scope are not established for this unbound request. |
| Birch profile avatar behavior | Birch capture's reported symptom | Supported only as that candidate's reported behavior area. Technical change, callers and regression scope are unknown. |
| A single "Bug 456" dependency or case set | No project selection binds either capture | **Uncertain/unsupported.** Combining the captures would manufacture a source identity. |

A proposed-change name inside the Cedar capture does not select F456's separate diff or its caller/contract catalogue. Other fixture sections are not added just because they share an ID or topic. No Cedar cart case or Birch case is nominated as the regression scope.

## Findings

Confirmed: there are two distinct project/item identities and two distinct reported symptoms. Project identity is essential to decide which source the requested analysis concerns.

Unknown: selected project, baseline, authoritative delta, relevant current callers/cases and regression scope. The Cedar Resolved status does not prove a fix, merge, deployment or successful retest. Birch's item status and any fix evidence are absent. Neither symptom establishes a root cause or failure diagnosis.

## Recommendations

**Required source selection:** choose **Cedar Bug 456 revision 5** or **Birch Bug 456 revision 2** (or provide the intended project-specific identity if neither). This is the only essential clarification before a project-bound assessment can proceed.

After selection, the impact-analysis owner can bind the selected change/baseline and supplied current caller/case evidence. If a fix or baseline remains absent, provide a partial behavior assessment and request only the missing evidence needed for deeper technical impact. Do not route to maintenance merely because the source is a bug ID; the requested outcome is impact analysis.

## Limits and handoff

This is a partial report, not a completed dependency/regression assessment. No live item read, new capture, execution, diagnostics, repair, source/case edit, tracker update or handoff occurred. No maintenance history, failure or repair budget is changed or reassigned across projects. The next action is the user's project selection, then continued source-bound impact analysis.