# Scenario prerequisite dictionary

This is an empty consumer template. Record only the structural information needed
to prepare a scenario. Keep credentials in the local secret store and runtime values
in ignored execution artifacts. Public examples must be synthetic.

| Scenario intent | Required state | Existing API/DB helper or operation | Inputs by reference | Lifecycle intent | Verification |
|---|---|---|---|---|---|

Lifecycle intent follows the scenario: temporary owned fixtures normally clean up;
existing state is restored when required; intentionally persistent outcomes may remain.
Capture previous values only when needed for a defined restoration requirement.

Before adding a prerequisite, inventory existing services and imported team resources.
Imported source documents are immutable; derive reusable helpers or operations without
copying their sample identities or secret values. Missing project information must be
resolved from the configured environment rather than guessed.
