# resources/Queries/ — the team DB-query knowledge library

The markdown files in this folder are the QA team's curated SQL knowledge for the
application under test's databases, exported from the team's Notion workspace: the
tables that matter, the join paths between them, status-code semantics, and proven
verify/seed recipes. They are the DB counterpart of `.agentex/page-map/` — durable
application knowledge the harness consults instead of rediscovering. Governed by the
2026-08-24 "Team DB-query library" ruling (design-conventions, Decision records).

## Ownership & lifecycle

- **The exported query files are team-owned.** Sessions never edit, rename, or delete
  them; corrections happen in the team's source and arrive by re-export. Filenames
  carry Notion export suffixes and may change on re-export — reference a file by its
  H1 title, never by its hex-suffixed filename.
- **This README and its index are harness-maintained.** When the team adds or removes
  files, the session that notices updates the index table below (a mechanical courtesy
  edit — the sanctioned exception to "never edit this folder").

## How the harness consumes the library — derive-only

The library is **read, understood, and derived from — never executed as-is**. Its
snippets are working notes: multi-statement, seeded with hardcoded point-in-time sample
values, sometimes prose-annotated. Consumption paths:

| Consumer | When | What it derives |
|---|---|---|
| automate-suite REFINE | converting verification/seed intents to `db:` steps | proposed `integration/*_db.json` catalog entries (user-confirmed before EXPLORE) |
| automate-suite GENERATE / service-classes | authoring `Dbs<Domain>` classes | `readonly <operation>_query` fields (`@param`-parameterized) — service-classes practice 3 |
| test-data reusability ladder (step 2) | a rerun fails on consumed/stale data | the seed/reset/cleanup SQL that makes the case re-runnable |
| AgenTeX execution (`db:` steps) | running refined specs | only ever cataloged `integration/*_db.json` entries — the executor never reads this folder or runs its own SQL |

## Adaptation rules (library snippet → executable query)

1. **One statement per derived query.** Workflow snippets chaining several SELECTs (or
   `DECLARE @Id` blocks) are recipes — derive one query per statement and
   let the test pass values between them.
2. **Parameterize every value.** Hardcoded sample values become parameters: `@param`
   placeholders for `Dbs<Domain>` `_query` fields (bound via `DBActions.query`),
   `{param}` placeholders for `integration/*_db.json` catalog entries (sqlcmd).
3. **Sample literals never leave the library.** Identity numbers, record ids, reference
   numbers, IBANs, and GUIDs in the snippets are point-in-time examples from someone's
   debugging session — never test data, never expected values, never defaults.
4. **Clean Notion export artifacts.** Auto-linkification corrupts some SQL —
   `[a.Id](https://column-name.invalid/)` is really `a.Id`. Code fences may carry the wrong language
   label (e.g. ```` ```jsx ```` fences that are really SQL) — read the content, not
   the label.
5. **Mutating queries are seed/cleanup material, with care.** INSERT/UPDATE/DELETE
   recipes are sanctioned for API/DB data preparation through `Dbs<Domain>` classes
   when no API path exists — iron law 8's precedence still applies, and the
   automate-suite triage still gates anything hard-to-reverse. DDL (DROP/TRUNCATE/ALTER)
   is never derived; the AgenTeX executor refuses it even if cataloged.
6. **Connection details are environment data, not query data.** Server/database
   coordinates appearing in snippets (e.g. `db-host\INSTANCE,1433`, database
   `AppDbQC`) belong in the named catalog `src/config/databases.ts` —
   the single connection-coordinate truth (2026-08-26 ruling); passwords only ever
   via `process.env` / `.env`.

## Index

| File (H1 title) | Domain | Contents |
|---|---|---|
| Order Queries (`3f2a…`) *(example — replace with your team's exported docs)* | Orders | Verify: order → order-item → status chain by reference number. Seed: INSERT pending test order |

Domain semantics the snippets teach (read the inline comments — they carry status-code
meaning): numeric status columns (e.g. `Status IN (2, 3)`) map to business states the
comments name. Verify such codes against the live schema before relying on them — the
library records what the team observed, not a frozen contract.
