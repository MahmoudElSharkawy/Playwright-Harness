# Live protocol

All commands use `npx --no pom-harness execute` in the consumer project.

```sh
execute next <exec>
execute do <exec> status
execute do <exec> begin-step s001
execute do <exec> look
execute do <exec> native goto https://app.example.test
execute do <exec> look
execute do <exec> native click e3
execute do <exec> check <source-key> --condition 1 --read "state e4"
execute do <exec> end-step --effect confirmed
execute report <exec>
```

`begin-step` must name the next frozen step. API/DB operations complete within
that command; browser steps stay live until `end-step`. Poll `do status` between
steps when needed. `finish-scenario` requires all steps finished. `stop <exec>`
interrupts the scenario; remaining work is recorded as blocked. `--foreground`
keeps the host attached to a terminal when detached processes are unavailable.

Put protocol options before the command: `do <exec> --request-id <uuid> <cmd>`
or `do <exec> --await <seq>`. A repeated UUID returns its stored reply.
`REPLY_PENDING` means await that sequence; never issue another mutation to retry
it. `COMMAND_UNCERTAIN` means the host ended without a durable receipt: preserve
the returned request ID, inspect the execution and reconcile before any new mutation.
`BUSY` means another request is in flight. `--run <id>` binds explicitly to
one host. A stale host cannot take another run's lock.

Native pure reads exposed to the agent: `find`, `tab-list`. Agent `native snapshot`
is refused before dispatch; `look` owns snapshot registration and ref freshness.
History commands are `go-back` and `go-forward`; `back`/`forward` are aliases.
`type <text>` requires a uniquely focused editable subject in the fresh snapshot;
use `fill <ref> <value>` for passwords. State changes include navigation,
reload, tab changes, resize, hover, mouse movement and dialog dismissal. Mutations
such as click, fill, type, press, select, check and drag require a mutation step.
Native JavaScript, routing, cookies/storage, HTTP, uploads and global session
commands are refused. Use `look` for registered snapshots and
`evidence screenshot|snapshot` for registered observation artifacts.

Refs such as `e12` or `f2e12` must be copied exactly from the latest snapshot after
any agent-caused state change. Quoted names and same-origin frame refs are supported.
A dead ref is an execution error. Take a fresh look; do not turn a command error
into an assertion failure. After poisoning, use `reconcile no-effect|effect|inconclusive
--evidence <ids>` before retrying or making new judgments. No-effect permits an
explicit contract-authorized retry at end-step; only declared reads automatically
retry, at most three attempts. Confirmed resource creation also requires its
captured identity. Identical reconciliations return the original acknowledgement;
contradictory replacements are refused. An incorrect accepted reconciliation needs
an explicit `indeterminate` ruling, NEEDS_REVIEW and a new execution. Confirmed
effect permits verification and settlement but no further mutations in that attempt.

`MODAL_PENDING` permits `dialog-accept` or `dialog-dismiss`, followed by a fresh
`look`. A modal read refusal does not erase prior failures. `not-executed` is valid
only before dispatch, capture or an evaluated assertion; a refused settlement leaves
the step open. Required screenshot or state-save failures prevent clean completion.

Replies are bounded private agent communications, never evidence. `SNAPSHOT_TOO_LARGE`
invalidates refs; `REPLY_OMITTED` retains dispatch facts and the request receipt.
Do not replay an action because its output was omitted. `HOST_STARTING_SLOW` means
reconnect to that host; `START_FAILED` leaves the scenario selectable. Reportable
observations go through `check`, `evidence`, `note` or `capture`.
`FINISH_REQUIRED` with `OBSERVATION_LIMIT` means the host is settling the scenario
before its evidence budget is exhausted. Stop sending live commands, await the
terminal status and inspect the report; do not replay the last action.
If mailbox persistence fails, the host settles runtime cleanup before releasing
ownership. Incomplete cleanup retains the ownership record for recovery.

Login steps expose the public username and configured password alias. Use
`fill eN HARNESS_PASSWORD_<HANDLE>` and `HARNESS_USERNAME_<HANDLE>`; the host
resolves username aliases. Only passwords are secrets; never put raw passwords
in a command. Conflicting aliases are refused.
After a fresh snapshot shows the login landmark, `save-login` stores protected
state. Later scenarios reuse it but must recheck the landmark before relying on
the session. For SSO/MFA use `login-state <exec> import <target> <user> <file>`.
Reporting or stopping deletes saved authentication unless `--keep-login` is used.

Use the returned `startUrl` for the scenario's initial navigation when applicable.
Honor the returned `checkpoint`: pause after the completed scenario before `next`.
`status` remains available during commands; `stop` uses an atomic out-of-band
request, with bounded in-flight work and one settlement response. Deadline settlement
uses already-observed evidence only, within the existing cleanup reserve; it cannot
launch screenshots, diagnostics or further actions.
