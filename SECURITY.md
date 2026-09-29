# Security and private data

Do not submit credentials, private system details, raw traces, authentication state or
customer data in public issues, pull requests or examples. Use synthetic reproductions.

If a credential appears in source or historical prose, remove it and arrange immediate
revocation/rotation if it could still work. Do not test it by logging in. Record status
without reproducing the value. Removing a file does not revoke a credential.

Private recovery material needs restricted access and protected/encrypted storage;
being outside Git is not sufficient. Never publish a recovery archive or private
identifier list. The M1 local recovery uses Windows machine-bound protection: preserve
the authorized recovery environment and verify restoration before removing other copies.

Run the package privacy, secret, provenance and publication checks together. Their
diagnostics intentionally omit matching text. They are useful automated checks, not
proof that every possible private fact was detected. Review release contents manually.

The current Claude hooks are advisory and fail open. The example API/DB utilities
are not a security sandbox or the planned future executors. Review their capture and
retry behavior before using real systems. Reporters and native browser traces may
include values that are not present in step titles.

Use environment references for credentials. Keep private manual sources, populated
consumer knowledge and all runtime evidence out of the public package. Public research
uses repository-relative paths, never local account, machine or temporary paths.
