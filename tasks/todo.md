# Capital Lab task tracker

The authoritative design and acceptance criteria are in `IMPLEMENTATION_PLAN.md`.

## PR #21 third activation-readiness remediation (2026-08-11)

Safety status: repository hardening only. No Hosted migration/history repair,
extension/Vault/Cron mutation, scheduler request, Production deployment, provider,
model, Canary, broker, or trading execution is authorized.

### Preflight and migration baseline

- [x] Derive the exact local and Draft-PR head (`e705f67db819be13c99f759e07186c63f114b831`), preserve the 21 unrelated shared-worktree edits, and create a clean detached worktree at that commit.
- [x] Read the governing repository instructions, current Supabase/Vercel documentation and changelog, and verify read-only that Hosted still has 32 applied migrations while both PR migrations remain unapplied.
- [ ] Prove a one-to-one repository/Hosted migration-name mapping and schema-equivalence evidence for every same-name/different-version discrepancy; stop rather than guessing on ambiguity.

### Executable remediation

- [x] Add append-only `auth_disabled` and `no_ai_runtime_enabled` deployment bindings, a mandatory `runtime_deployment_verified` gate, exact route/runtime identity checks, and two-deployment end-to-end coverage.
- [x] Add a checksummed non-secret project identity contract and fixture-driven read-only Vercel deployment/alias proof before any request-capable phase.
- [x] Make missing- and invalid-Bearer 401 probes durable, mandatory one-shots with exact evidence and no state-machine bypass.
- [x] Split versioned pre- and post-activation backup contracts, cover every classified application relation, expand schema fingerprints, and bind verification to an externally retained manifest hash. The two seed-free restores remain an exact-head Docker CI gate.
- [x] Add a deterministic handoff checksum generator/verifier based on status-aware merge-base changes and canonical Git bytes; final manifest generation remains after the implementation commit.
- [x] Add the standalone dirty-tree-tolerant DB-first break-glass runner, complete relation classification, paid-Canary terminal prerequisite, and retry-safe terminal operation identities.
- [x] Pin Node 24 consistently, enforce real credential-history depth, and harden all Windows subprocess/destructive local-database paths with fault-injection coverage.

### Verification and publication

- [ ] Run focused unit/SQL contracts, then all mandatory application, browser, Supabase, pgTAP, rollback, pre/post restore, checksum, credential-history, Windows, hostile-endpoint, state-machine, side-effect, Canary, and break-glass gates on one exact clean Node 24 head.
- [ ] Regenerate final-byte phase/migration/handoff checksums, update the post-build report with honest implementation/handoff SHAs and non-execution evidence, commit only scoped files, push the existing branch, and keep PR #21 Draft and unmerged.

Local pre-commit evidence on Node `v24.14.0`: phase contract 18 files / SHA-256
`19577027ceab91fef3ac510e6dd92d63772931767980fc07924ad462ef5b673d`;
backup contracts 82 pre-migration and 105 post-migration relations; Prettier exit
0; ESLint exit 0 with zero warnings; strict TypeScript exit 0; Vitest 87 files /
634 tests; PAPER-only scan exit 0; redacted credential scan exit 0 across the
working tree and 100 commits; Next.js 16.3 production build exit 0; Playwright
4/4 mock-only flows with fail-on-flaky exit 0; Supabase CLI `2.113.0` verified.
This workstation has no Docker executable, so Supabase start/reset, pgTAP,
rollback rehearsal, and the two seed-free export/restore contracts are not
claimed locally and remain mandatory on the exact committed CI head.

Exact-head CI run `31478991594` passed Windows subprocess and all four browser
flows, then failed closed before application gates because phase hashes had
captured Windows CRLF checkout bytes. The database job independently compiled
and applied all migrations to its ephemeral stack, then stopped because the
runner image had a `psql` wrapper but no versioned PostgreSQL client package.
Repository-derived text contracts now hash canonical UTF-8/LF bytes with
cross-platform tests; external evidence remains raw-byte exact. CI now installs
and verifies PostgreSQL 17 client tools before any rehearsal. A fresh exact-head
run remains mandatory; neither failure authorized or caused Hosted mutation.

Exact-head CI run `31480224272` proved the canonical phase, backup, and handoff
contracts on Linux and again passed Windows subprocess plus 4/4 browser jobs.
The application suite then found that the simulated Windows resolver test still
consulted the Linux execute bit even though the real Windows job passed; the
resolver now consistently uses the explicitly selected platform, and the
focused Linux test passes. The database job stopped before Supabase because
Ubuntu Noble does not ship PostgreSQL 17 in its default repository. CI now adds
the official PGDG HTTPS repository only after validating its full signing-key
fingerprint, installs client 17, and asserts the major version. A fresh exact-head
run is mandatory; no failing result is counted as evidence of completion.

Exact-head CI run `31480867586` passed the complete application, Windows, and
browser jobs. PGDG key validation and PostgreSQL 17 installation also passed.
Rollback rehearsal then failed because the Node resolver found Ubuntu's generic
`/usr/bin/psql` wrapper rather than PGDG's installed native binary. CI now
asserts `/usr/lib/postgresql/17/bin/psql` is executable, verifies its major
version directly, and prepends that exact native directory through
`GITHUB_PATH` for subsequent `shell:false` resolution. Reset, pgTAP, and restore
were correctly skipped; a fresh exact-head database run remains mandatory.

Exact-head CI run `31481331885` passed the complete application, Windows, and
4/4 browser jobs. Its database job passed the fingerprint-bound PGDG install,
the rollback-only rehearsal, and a fresh seed-free reset before pgTAP failed
closed. The database output exposed three root causes: deployment-proof retries
checked the durable identity before recomputing the proof hash, a local
`probe_kind` variable collided with the evidence column, and the newly added
terminal-operation trigger helper retained PostgreSQL's default `PUBLIC`
execute privilege. The proof check is now ordered before retry reconciliation,
the variable is unambiguous, and the helper is included in the explicit revoke
set. The post-migration backup contract was regenerated from the resulting
migration bytes. The two restores remained correctly skipped; the replacement
exact-head CI run is mandatory.

Exact-head CI run `31483832916` passed the complete application, Windows, and
4/4 browser jobs, then passed Supabase start, both rollback rehearsals, and the
fresh reset. The three earlier pgTAP root causes were resolved: the 401 sequence
and privilege contract advanced cleanly. The next first failure showed the
test's synthetic market-calendar/session setup mutating forbidden relations
after `runtime_deployment_verified`; the production guard correctly performed
the DB-first stop. The deterministic fixture and experiment pause now occur
before Campaign preparation, while the later adversarial mutation assertions
remain in the protected states. Restores were correctly skipped after pgTAP;
the replacement exact-head run remains mandatory.

Exact-head CI run `31484467384` again passed application, Windows, browser,
Supabase start, rollback rehearsal, and reset. pgTAP then executed the complete
52-slot/104-event path and reached the positive post-terminal Canary claim; only
that claim aborted because its final insert named a nonexistent `metadata`
column on `private.paid_canary_runs`. The immutable prerequisite payload now
uses the table's existing `result` evidence column, and pgTAP explicitly checks
that all three globally locked model rows bind to the passed Activation Campaign.
The post-migration backup contract was regenerated. Both restores remained
correctly skipped after pgTAP; a replacement exact-head run is mandatory.

Exact-head CI run `31485089511` passed application, Windows, browser, Supabase
start, rollback rehearsal, and reset. All 135 Activation assertions executed;
the only failure was the existing phase-two assertion that required durable
`auto_stopped` transition evidence. Review showed the later retry-safe
phase-two implementation had replaced the earlier transition-writing body
without carrying that evidence forward. Phase two now inserts and immediately
verifies the exact append-only transition, and a completed retry revalidates
both its operation evidence and transition operation/correlation identity
before returning. Both restores remained correctly skipped after pgTAP; a
replacement exact-head run is mandatory.

Exact-head CI run `31485769952` passed application, Windows, browser, Supabase
start, both rollback rehearsals, reset, and every pgTAP assertion. The restore
step created and exported the 82-relation pre-activation backup, then failed
closed while preparing its disposable `template0` target because the script
requested `supabase_vault WITH SCHEMA vault` before creating the target schema.
The local-only target path now creates `vault` under `supabase_admin` before the
extension, with a unit assertion for that ordering. No Hosted extension or Vault
state was read or changed. The post restore did not run after the pre-target
failure; a replacement exact-head run is mandatory.

Exact-head CI run `31486465529` again passed application, Windows, browser,
Supabase start, rollback rehearsal, reset, and pgTAP. Pre-activation export and
the seed-free Supabase platform target then succeeded. App-schema restore failed
closed because a `template0` database starts with an empty `public` schema while
the verified schema dump contains its own `CREATE SCHEMA public`. The target
preparer now drops only that empty schema in the already validated loopback-only
`capital_lab_restore` database, inside the existing `try/finally`, before any
platform/app restore. Unit coverage freezes this ordering. Post restore did not
run after the pre-restore failure; a replacement exact-head run is mandatory.

Exact-head CI run `31487163698` passed application (87 files / 634 tests),
Windows (4 files / 14 tests), browser (4/4), Supabase start, both rollback
rehearsals, reset, and all 14 pgTAP files / 1927 assertions. The pre-activation
export created all 82 relation artifacts and the seed-free target preparation
completed; application-schema restore then failed closed because the disposable
`template0` target had not installed the existing baseline `pgcrypto`, `citext`,
and `vector` extensions before restoring columns typed as `extensions.vector`.
The target preparer now installs exactly those unversioned historical baseline
extensions in the already validated loopback-only database before application
schema restore, and the ordering contract is frozen in unit coverage. Post
restore did not run after the pre-restore failure; a replacement exact-head run
remains mandatory.

## PR #21 activation-readiness adversarial hardening (2026-08-09)

Safety status: implementation-only. Production migration/deployment/activation, Hosted extension/Vault/Cron mutation, scheduler HTTP, provider/model calls, Canary execution, broker connectivity, and PR merge/undraft are prohibited.

### Preflight and evidence boundaries

- [x] Derive local HEAD/branch/remote from Git, inspect the complete working tree, and preserve the 21 unrelated modified files observed in the shared working tree unstaged and unchanged.
- [x] Confirm Draft PR #21 points to `codex/activation-readiness-follow-up` at `f23c8e4a98338e2546497d53ab77238f51c09691`; no later PR commits exist.
- [x] Read current official Supabase migration, backup/restore, Cron/pg_cron, pg_net, Vault, RLS, security-definer, and breaking-change guidance; direct `cron.job` mutation and extension version pins remain forbidden.
- [x] Prove read-only that linked Capital-Lab Hosted migration history contains neither `20260809150000` nor `20260809150417`; `pg_cron`/`pg_net`, planned Vault names, activation relations, and scheduler jobs are absent. Existing Vault extension is platform baseline with zero entries.
- [x] Confirm read-only that the Vercel project is not live, the PR deployment is Preview-only (`target=null`), and tracked `vercel.json` disables `main` Git deployments; Production config remains untouched.

### Implementation plan

- [x] Replace name-trusting Cron logic with versioned canonical job specifications, persisted schedule-returned IDs, full-definition checks before install/arm/verify/stop, ID-bound `cron.alter_job`/`cron.unschedule`, and fail-closed extra-job detection.
- [x] Bind the campaign manifest to a parser-validated Production origin/path, Deployment ID, commit, environment, database target fingerprint, phase-file hashes, and server-derived Git/target evidence.
- [x] Add persistent one-shot auth-noop request/response/reconciliation evidence and a strict scheduler route response contract with exact zero side-effect counters and 401/no-side-effect coverage.
- [x] Split unconditional DB-first emergency kill from orderly Vercel-first stop; make drain, disable, unschedule, and audit retryable without rolling back phase-one controls.
- [x] Make dispatcher/reconciler transport capture unconditional, persist actual response JSON evidence, refresh side-effect snapshots on every tick, and implement deterministic terminal finalization (52 slots/104 events for v2) with drain and 300-second post-stop gates.
- [x] Replace partial baselines with deterministic full-state signatures/watermarks/sums; enforce the complete dangerous-setting keyset, mock/paper provider contract, lead time, and retry equality.
- [x] Establish one versioned critical-relation source of truth for exporter/manifest/restore verification, full schema/content hashes, clean-commit/migration/target binding, seed-free disposable restore, and tamper tests.
- [x] Minimize grants and wrapper execution, enforce actor/transition matrices and owner/campaign composite FKs, harden security-definer search paths, and protect immutable evidence including TRUNCATE and global Canary one-shot semantics.
- [x] Harden the cross-platform runner (`shell:false`, canonical paths, `psql -X`, timeouts, allowlists, unknown-outcome reconciliation) and expose explicit canonical phase files with frozen SHA-256 values.
- [x] Expand redacted credential/history scanning, pin security-critical Actions by immutable SHAs, keep Canary flags child-scoped, and expose only safe disabled/mock health evidence.
- [x] Add application, integration, pgTAP, fault-injection, full 52/104 happy-path, backup/restore tamper, privilege/RLS/TRUNCATE, target/manifest mismatch, Windows argument/path, and unknown/late request tests with zero external network/provider/OpenAI effects.

### Verification and publication

- [x] Run focused tests while iterating, then on the exact clean final commit: format, lint, typecheck, unit, safety, credentials, build, Playwright, pinned Supabase CLI version, local start/reset/pgTAP, seed-free export/restore, and rollback-only migration rehearsals.
- [x] Regenerate migration/script/manifest/documentation checksums from final bytes; verify them again after commit and record exact commands, exit codes, and test counts under `docs/post-build/`.
- [x] Push only scoped files to the existing PR branch, keep PR #21 draft/unmerged, observe exact-commit CI/Preview read-only, and end at no stronger than second-independent-review readiness.

Iteration evidence before the first CI commit: direct TypeScript compiler exit 0;
ESLint exit 0 with zero warnings; focused security suites 5 files / 34 tests;
complete Vitest 79 files / 589 tests; PAPER-only scan exit 0. Local Supabase,
pgTAP, Playwright, build, and seed-free restore remain pending until the clean
ephemeral CI checkout because this workstation has neither Docker nor psql.
Exact-head CI run `31341237570` passed application and browser gates, then
failed closed on a non-idempotent trigger drop. Run `31341396633` passed the
browser gate and advanced migration compilation to an installed-function
parameter-name mismatch. Both schema-local findings were fixed without Hosted
mutation; exact-head database rerun remains mandatory.
Run `31341545900` passed application, browser, Supabase start, migration compile,
and database reset. Its 1,332-assertion pgTAP pass then failed closed on a
schema-wide private-function revoke that regressed established owner wrappers
and on a non-superuser Cron-owner tamper fixture. The grant change is now an
exact activation-function allowlist; username tamper is covered by the
documented API rejection plus versioned hash inequality. A fresh exact-head
pgTAP/restore run remains mandatory.
Run `31341809083` passed application, browser, migration compile, and reset;
1,816 of 1,836 pgTAP assertions passed. The remaining failures reduced to an
older blanket exposed-schema SECURITY-DEFINER assertion, a missing explicit
safe-control test fixture, a transaktionsweit offenbleibendes internal-writer
flag, and one pg_cron SQLSTATE mismatch. The contract now allowlists only the
three narrow fixed-search-path public wrappers, the fixture creates every
required false setting explicitly, and internal writers open the mutation gate
only around individual writes and close it before return. Exact-head rerun is
still mandatory.
Run `31342073726` passed all non-database gates and reduced pgTAP to three
cascade assertions: the accelerated deterministic 52/104 test proposed a
future slot with a lease based only on current server time, violating
`lease_until > slot_at` before `ON CONFLICT` could use the preclaimed fixture.
The runtime now derives lease expiry from the greater of server time and the
server-planned slot, preserving the table invariant for retries and future
slots. A fresh exact-head run remains mandatory.
Run `31342252647` passed application, browser, pinned Supabase CLI startup,
reset, and all 14 pgTAP files / 1,836 assertions. The seed-free backup gate was
reached for the first time and rejected the post-toolchain checkout as dirty
before any dump. The exporter now reports only Git status plus repository path
(with `.env*`/`.npmrc` path redaction), never contents or credentials, so the
next ephemeral run can identify and explicitly ignore or eliminate only the
actual generated path. Clean-tree rejection remains unchanged.
Run `31342485611` proved the only dirty path is the Supabase CLI-generated
`supabase/.branches/_current_branch`; exactly `/supabase/.branches` is now
ignored alongside `/supabase/.temp`, while every other dirty path remains
blocking. Application and all database assertions stayed green. One unchanged
Research-import browser assertion timed out after earlier green runs; no retry,
timeout, or assertion was weakened, and a fresh exact-head browser pass remains
mandatory.
Run `31343249634` proved source evidence and sensitive export creation in
ephemeral external storage. Restore rejected the manifest before applying
roles/schema/data; mismatch reporting is now category-only, and psql distro
suffixes are accepted while exact export/restore version equality remains
mandatory. The credential gate correctly caught reserved-host test URLs in the
current tree and commit history. Only `critical-backup-contract.test.ts` URLs
to loopback or `db.example.com` are internally removed before CRED-008 matching;
all other files, hosts, credential classes, and 100-commit history scanning
remain fail-closed. Local scan now reports only the pre-existing ignored
`.env.local` categories, never their values.
Run `31343512116` passed application, browser, credential scan, all database
assertions, source export, and strict manifest validation. The first empty
target preflight failed before roles/schema/data restore. Exporter and verifier
now share one tested PostgreSQL error redactor; a fixture proves literals and
URLs are removed. Nine focused backup-contract tests pass, and the next
exact-head run remains mandatory.
Run `31343752298` identified the empty-target preflight error: the server
`system_identifier` column was selected beside an aggregate count without its
own aggregate. It now uses `max(system_identifier)` in the same one-row
server-side identity query. No restore phase ran; the next exact-head target
preflight and full restore remain mandatory.
Run `31343987544` passed application, browser, credentials, Supabase start,
reset, all 1,836 pgTAP assertions, export, manifest validation, and the empty
target preflight. Role replay then failed because PostgreSQL roles are
cluster-global: replaying the dump into a second database on the still-running
source server attempted a privileged global setting mutation. The contract now
freezes a password-free full role-policy fingerprint and a server fingerprint.
Same-server disposable restores require exact role-policy equality and do not
mutate shared roles; truly separate servers still restore and reverify roles.
The focused contract suite passes 1 file / 10 tests; exact-head schema/data
restore and full evidence comparison remain mandatory.
Run `31344323501` passed every gate through role-policy and empty-target
preflight. Schema restore then proved that Supabase CLI intentionally assumes a
pre-provisioned target and excludes the extension-managed schema namespace.
The seed-free target now applies one tracked, manifest-checksummed Prelude that
creates only the empty `extensions` schema: no table, extension, migration,
role, or row. The pgTAP path now also uses local `net._http_response` fixtures
instead of direct durable-evidence inserts, rolls back invalid correlation,
counter, transport-error, and terminal-reason cases, copies parsed counters,
expires ephemeral transport rows, injects post-kill Cron/audit faults, rejects
early finalization and drifted unschedule, and checks duplicate terminal ticks.
A new exact-head pgTAP and full schema/data restore run is mandatory.
Run `31344675766` kept all application and browser gates green (79 files / 594
tests and 4/4 Playwright). The expanded pgTAP path rejected the nominal auth
fixture because its JSON used the operation UUID in the `request_id` field
instead of the request UUID frozen by the claim. The fixture now uses the exact
persisted request identity; no production code or acceptance condition was
weakened. Backup/restore was correctly skipped after the pgTAP failure.
Run `31344881015` passed format, lint, typecheck, 79 files / 594 tests, safety,
credentials, build, pinned Supabase startup/reset, and all 14 pgTAP files /
1,851 assertions. The seed-free target passed export, manifest, role-policy,
and identity preflight, then stopped because the schema dump expects the empty
Supabase-managed `vault` namespace. The manifest-checksummed Prelude now creates
only empty `extensions` and `vault` namespaces; it installs no extension and
creates no table, role, migration, or row. One unchanged Research-import browser
assertion was transiently red (3/4); no retry, timeout, or assertion was
weakened. A fresh exact-head full restore and browser run remain mandatory.
Run `31345275407` again passed the complete application gate and all 1,851
database assertions. The `template0` restore advanced through the extension
namespaces and then proved the deeper contract error: official Supabase dumps
expect the managed Auth/Storage platform baseline of a provisioned target.
Target preparation now exports first, temporarily holds only the exact project
migrations, runs pinned `supabase db reset --no-seed`, restores the files,
clones that real local platform baseline to a distinct database, and removes
only its empty migration-history schema. The checksummed Prelude validates the
baseline without creating it. The database fingerprint now includes the
server-side database OID. Research import again failed at the same preview
assertion (3/4), so it is now tracked as a repeated root-cause investigation,
not dismissed as transient.
Run `31345678279` passed the complete application gate, all four Playwright
flows, migration compile/reset, and all 1,851 database assertions with the
OID-bound fingerprint. The new local target builder failed closed, but its
deliberately generic error did not identify the subphase. Fixed allowlisted
phase labels now distinguish baseline reset, source quiesce/drain/reopen,
clone, and history clear without emitting stderr, URLs, SQL values, or
credentials. A fresh exact-head restore run remains mandatory.
Run `31345975029` again passed application, all four Playwright flows, and all
1,851 database assertions. Its new label identified `source_drain`: the local
database operator cannot terminate every Supabase service backend. Physical
cloning is removed. The helper now uses `pg_dump` to create schema/data artifacts
for the real seed-free platform baseline in an OS temporary directory, restores
them transactionally into a new `template0` database, and removes the temporary
directory in `finally`. This path needs no backend termination and still emits
no dump contents, stderr, URL, SQL value, or credential.
Run `31346276617` passed application and all four Playwright flows but did not
exercise any database code: the ephemeral runner already had local port 54322
bound before `supabase start`. Reset, pgTAP, export, and restore were skipped.
No retry loop or port override was added; a fresh exact-head clean runner is
required.
Run `31346407773` passed application, all four Playwright flows, pinned local
startup/reset, and all 1,851 database assertions. The logical builder reached
`platform_schema_dump` and failed closed before target restore. It now reuses
the tested PostgreSQL redactor only for fixed `platform_*` phases: the next run
may emit only the first error category line with literals/URLs redacted and a
400-character cap; dump contents and stdout remain suppressed.
Run `31346632981` passed application, all four Playwright flows, and all 1,851
database assertions. The redacted diagnostic proved the runner `pg_dump` major
version differs from the Supabase database. The baseline export now uses the
same pinned Supabase CLI `2.113.0` dump path already proven by the critical
export, with schemas fixed to `auth,storage,extensions,vault`; no arbitrary
schema input or mismatched host client remains.
Run `31346865611` passed application, all four Playwright flows, and all 1,851
database assertions. The pinned baseline dump succeeded; restore then correctly
refused its `SET ROLE supabase_admin` under the generic operator. Ownership
commands are not stripped. Only the allowlisted managed baseline now restores
as the fixed local `supabase_admin` with the existing non-logged loopback
password; the Capital Lab schema/data restore and all evidence queries remain
bound to the parsed operator.
Run `31347131750` passed application, all four Playwright flows, and all 1,851
database assertions. Managed schema restore then succeeded under its preserved
role identity; baseline data failed because extension-owned `vault.secrets` was
not recreated by a schema-filtered dump. The local disposable builder now
installs `supabase_vault` with no version pin through `CREATE EXTENSION IF NOT
EXISTS ... WITH SCHEMA vault`, copies data only for `auth,storage`, and requires
the actual `vault.secrets` relation in both Prelude and target preflight. No
Hosted extension or Vault object was changed.
Run `31347387043` passed the complete application gate, pinned local reset, and
all 14 pgTAP files / 1,851 assertions. The local platform-baseline builder now
completed, including the unpinned local Vault extension; restore then attempted
to replay cluster-global role settings on a freshly reset local server even
though the password-free policy was already provisioned. The contract now
compares complete role attributes and memberships first, skips redundant
global replay on exact equality, rejects a same-server mismatch, and replays
plus reverifies only a differing policy on a distinct server. The repeated
Research-import browser failure was traced to interaction before React attached
the file-change handler: the input is now disabled through SSR and becomes
enabled only after the client hydration snapshot, which the unchanged semantic
E2E flow explicitly observes before upload. A new clean local-only rollback
rehearsal applies both PR migrations in one bounded transaction, verifies their
probe relation, rolls back, proves absence, and restores the exact migration
bytes; Hosted rehearsal remains unauthorized.
Run `31404735561` passed the complete application and browser jobs, including
the hydration-gated Research import, plus pinned local startup, the new
rollback-only migration rehearsal, full reset, and all 1,851 pgTAP assertions.
The seed-free builder and role-policy gate completed; schema restore then
failed because a schema-filtered platform dump does not carry the global empty
`supabase_realtime` publication that official Supabase application dumps expect
to exist. The disposable builder now creates exactly that local publication,
and both the verifier preflight and checksummed Prelude require its non-all-table
default DML policy. No Hosted publication or Realtime configuration was read or
changed.
Run `31405499189` again passed application, all four browser flows, rollback
rehearsal, reset, and all 1,851 pgTAP assertions. The Realtime publication gate
allowed schema restore to complete; data restore then exposed that the default
Supabase data dump also carried managed Storage baseline tables outside the
critical relation contract. The exporter now derives a sorted data-schema scope
from the canonical critical relation list, passes only that scope to the dump,
freezes it in the manifest, and makes restore reject drift. Auth/Storage remain
the separately provisioned seed-free platform baseline.
Run `31406201745` at exact code commit
`1023be44ed9f4e1f0e610dba8a501c7ccf687e89` is the first complete green cycle:
format, zero-warning lint, strict typecheck, 80 Vitest files / 600 tests,
PAPER-only safety, current plus 100-commit credential history, production build,
4/4 Playwright flows, pinned Supabase CLI 2.113.0, local start, rollback-only
rehearsal, full reset, 14 pgTAP files / 1,851 assertions, sensitive external
export, seed-free managed target construction, and full restore verification of
40 critical relations. The documentation-only checksum/handoff commit is the
final candidate and remains subject to exact-head CI/PR reconciliation before
handoff.
Run `31342645890` passed application, all four browser flows, Supabase startup,
reset, and 1,836 pgTAP assertions. The clean-tree gate now passes; the first
canonical evidence query fails before any dump. The exporter now emits only
the first PostgreSQL `ERROR` line with all single-quoted literals and URLs
redacted and a hard 400-character cap. It still never prints query output,
rows, credentials, headers, or connection details. A fresh exact-head run is
required to identify the SQL contract defect.
Run `31342850522` kept application, browser, reset, and all pgTAP assertions
green. The pre-dump `psql` failure uses lowercase `psql: error:` formatting, so
the redactor remained unclassified. Matching is now case-insensitive; no error
detail, query output, row, literal, URL, or connection value is exposed. The
next exact-head run remains mandatory.
Run `31343009696` identified the pre-dump failure: libpq ignored the full URI
when placed only in `PGDATABASE` and fell back to the default local socket.
Export and restore now use one strict parser and separate non-logged `PGHOST`,
`PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, and `PGSSLMODE` fields. The
parser requires credentials/database, exact port bounds, loopback for restore,
`verify-full` for non-loopback sources, and rejects fragments or non-allowlisted
parameters. Eight focused contract tests pass; exact-head restore remains
mandatory.

## Activation readiness follow-up (2026-08-09)

- [x] Preserve unrelated working-tree changes and branch from the audit tree on `codex/activation-readiness-follow-up` without merging or deploying Production.
- [x] Classify the prior audit evidence, record `key_rotation_completed=owner_attested`, and keep `server_consumer_scope_sync=pending` without inspecting hosted secret values.
- [x] Confirm the hosted Production off-state and identify Supabase CLI `2.113.0` as the exact release resolved by the last green clean-checkout CI run.
- [x] Pin the database gate, add redacted credential scanning, and capture exact-commit exit codes and test counts as machine-readable CI evidence.
- [x] Separate schema migration, extension preparation, disabled job installation, later arming, and shutdown into idempotent fail-closed phases.
- [x] Add the dedicated `no_ai_shadow_infrastructure_dry_run`, two-full-regular-session plan, expected-vs-actual evidence, alarms, atomic stop, and audited state machine.
- [x] Make the paid Canary globally one-shot across operation IDs and isolate temporary launcher flags without executing a real model request.
- [x] Add focused application and pgTAP coverage, harden backup/restore evidence, and produce the final Activation Readiness report.
- [x] Run clean application, browser, and exact-commit CI database gates; publish only an unmerged draft PR and leave every dangerous flag false.

Scope guard: this follow-up prepares and verifies code only. It must not apply the Production migration, install remote extensions, inspect or change hosted secrets, create or enable jobs, promote or deploy Production, merge a PR, activate any runtime control, call a live provider or model, run the paid Canary, import research, or create an order, fill, or ledger entry.

## Post-build hosting and activation audit (2026-08-09)

- [x] Re-audit repository instructions, architecture, dependencies, migrations, runtime boundaries, CI, environment examples, and dirty worktree without overwriting unrelated user changes.
- [x] Remove the Vercel Cron GET path and prepare the single dormant Supabase Cron -> pg_net -> protected Production POST topology with 110/120/300-second deadlines.
- [x] Add fail-closed agent/paid/Canary/autonomous/Sol/web/broker/scheduler flags and mandatory Preview no-op behavior.
- [x] Version and expire exact Luna/Terra/Sol pricing; add the free model-list check and a fully gated local-only paid Canary without running a paid call.
- [x] Enforce daily/monthly/experiment/lifetime budget defaults, atomic experiment serialization, persistent 70/90/100 alerts, and conservative unknown usage.
- [x] Add scheduler cycle identity, lease/heartbeat/retry/reconciler evidence, Sol isolation, storage thresholds, audited retention, and dashboard projections in one unapplied migration.
- [x] Add dormant activation/shutdown SQL, backup/export and local-only restore scripts, and the Notion runtime boundary.
- [x] Compile the migration and reach pgTAP assertion 42 against the hosted schema inside rollback-only transactions; no hosted schema/data persisted.
- [x] Complete final format/lint/type/unit/safety/build/database/Preview gates and record exact results in `docs/post-build/hosting-safety-audit.md`.
- [ ] Rotate the server key disclosed in conversation, manually verify Vercel Production flag scopes, OpenAI credit/expiry/project/spend limit, and approve the migration before any activation.

Scope guard: this audit ends with agent, paid calls, Canary, autonomous paper execution, Sol, web search, broker paths, and both scheduler jobs disabled. It does not apply the migration, run the Canary, connect Notion, or start the 48-hour dry run.

Final gate evidence: GitHub push and pull-request runs `31312305640` and `31312307206` are green at exact application commit `42dc1b3`; the clean-checkout application gate passed formatting, zero-warning lint, strict TypeScript, 74 Vitest files / 558 tests, the PAPER-only scan, and the Next.js 16.3 build. Browser passed 4/4 journeys. Database passed 13 pgTAP files / 1,575 assertions. Vercel Preview `dpl_LSUP5aUruge2dvNpS93DJVfRdULQ` is READY with no Production target; exact-deployment health is HTTP 200 in disabled mock mode and observed runtime error/warning/fatal logs are empty.

## Plan

### Structured paper-agent orchestration

- [x] Replace financial-number proposal fields with canonical decimal strings and enforce semantic bounds through the financial decimal wrapper.
- [x] Add deterministic Luna/Terra/Sol routing, daily/monthly caps, exceptional-escalation rules, and a separately reserved controlled-web-research gate.
- [x] Add a shadow proposal boundary that cannot create an order and an explicit live-paper boundary that can delegate only to the deterministic simulation service.
- [x] Persist immutable run provenance, routing events, concise rationale, scenarios, and point-in-time evidence through an owner-only hosted contract.
- [x] Replace the hosted Agent console mock with an owner-scoped read projection and truthful empty/disabled states.
- [x] Run application, database, browser, hosted rollback, Preview, and CI gates without enabling paid AI, Sol, web search, scheduling, or Production.

Scope guard: the hosted environment remains `AGENT_ENABLED=false`, shadow by default, with Sol and web search disabled. This work cannot add brokerage connectivity, broker credentials, real-order paths, or direct fill/ledger writes.

#### Application foundation review

- Exact-decimal proposal validation, deterministic model/web routing, paid-run deduplication, and the shadow/simulation-only dispatcher are implemented without changing a hosted control or environment value.
- Luna relevance and Terra/Sol shadow runners now reserve routing and quota atomically before any provider request, use only immutable database-pinned prompts/schema IDs, settle exact provider usage, reject candidate/evidence drift, and conservatively mark unreconciled calls as unknown cost. They remain dormant behind disabled server flags.
- The owner-scoped hosted Agent console now projects real runs, concise decisions/scenarios, evidence, tool calls, and exact cost strings with truthful disabled/empty states; it receives no environment object or credential across the client boundary.
- The additive migration sections compile against the hosted Capital-Lab schema inside rollback-only transactions, including canonical Luna/Terra/Sol prompts, immutable prompt pins and provider response provenance, atomic begin/finalize/fail contracts, point-in-time evidence enforcement, and the bounded owner console. No rehearsal schema or data persisted.
- Repository verification passed zero-warning ESLint, strict TypeScript, 70 Vitest files / 531 tests, the PAPER TRADING ONLY scan, intended-slice formatting, `git diff --check`, and the Next.js 16.3 production build.
- Shadow dispatch persists only a decision record through an injected writer and never invokes simulation. Explicit live-paper dispatch can call only the deterministic `PaperSimulationExecutionService` port; neither path contains a broker, fill, ledger, credential, or external-action capability.
- GitHub CI run 107 is green at exact application commit `7f97242`: clean-checkout formatting, zero-warning lint, strict TypeScript, 70 Vitest files / 531 tests, the PAPER TRADING ONLY scan, the Next.js 16.3 build, the Chromium gate, a fresh Supabase start/reset, and all 12 pgTAP files / 1,469 assertions passed. The unrelated mock research-import journey passed on its configured retry, while the protected hosted verification below completed cleanly.
- The complete structured runtime migration passed a rollback-only compile rehearsal against the current hosted schema before migration `20260808235225` was applied. Supabase's foreign-key advisor then identified two prompt-pin access paths; follow-up migration `20260809000307` adds both covering indexes, passed its own rollback rehearsal, and is applied from the CI-validated SQL.
- Generated hosted types include the immutable prompt pins, provider response provenance, atomic Luna/shadow begin/finalize/fail contracts, and bounded console read. Prompt pins retain forced RLS and read-only owner access; only `service_role` may begin a run, while `authenticated` may only read the console and `anon` cannot.
- Post-migration Supabase advisors report no unindexed foreign key or new schema-security finding. Performance findings are informational unused-index notices on the intentionally dormant schema; leaked-password protection remains the one project-level security warning.
- The hosted audit reports four immutable prompt versions and three experiment-role pins, with zero agent runs, decisions, AI budget reservations, AI usage events, enabled agent controls, enabled scheduler controls, orders, or fills. The single pre-existing opening cash-ledger entry is unchanged.
- Vercel Preview `dpl_6jbeDa3p5U7GWJt3ierVCzZuFsMZ` is READY as Next.js at exact application commit `7f97242` with no Production target. `/api/health` returns `200`, `paperTradingOnly: true`, mock data mode, and `agentEnabled: false`; build-error logs are empty.
- The authenticated owner `/agent` route renders the hosted database projection, disabled provider/broker boundaries, and truthful zero-run/decision/evidence/tool states. Browser warning/error diagnostics are empty. Paid AI, Sol, controlled web research, live market data, remote scheduling, brokerage connectivity, and Production remain disabled.

### Hosted evidence statistics and reviewed pattern gates

- [x] Define one owner-only, bounded `decisionAt` learning snapshot for confidence calibration, decision categories, evidence kinds, evaluated outcome horizons, and current pattern/strategy readiness.
- [x] Return every rate, return, excursion, allocation, and threshold as an exact decimal string; exclude decisions, citations, outcomes, patterns, and assignments that were not available at the requested decision boundary.
- [x] Replace JavaScript financial-number promotion inputs with exact decimal values and a fixed versioned policy; require independent linked outcomes, positive benchmark-relative evidence, bounded adverse excursion, and an explicit holdout result before eligibility.
- [x] Add owner-reviewed pattern lifecycle actions with durable idempotency and audit evidence, while preventing self-promotion, direct table writes, active strategy assignment, or allocation changes.
- [x] Add strict application mapping, a server-only repository, and truthful hosted `/memory` statistics/review states while preserving deterministic mock mode.
- [x] Cover owner/non-owner/anonymous access, grants/search paths, point-in-time exclusion, exact decimals, sparse/empty evidence, idempotent review, deterministic gate failure reasons, and zero AI/provider/scheduler/order/fill/ledger side effects with pgTAP and application tests.
- [x] Run complete application/database/browser release gates, reconcile hosted types/advisors, and publish through a protected Preview and reviewed PR without enabling agents, paid calls, providers, scheduling, strategy allocation, or Production.

Scope guard: this slice measures immutable hosted paper evidence and records explicit owner review of pattern lifecycle only. It cannot call a model/provider, create or modify a strategy assignment, allocate capital, enable a runtime control, create an order/fill, mutate positions/ledger/P&L, or promote Production.

#### Review

- Existing schema audit: authenticated owners can read owner-scoped pattern, evidence, strategy-version, and assignment rows through forced RLS, but cannot write them directly. No hosted pattern review RPC or point-in-time aggregate existed, and the prior pure promotion helper accepted financial evidence as JavaScript basis-point numbers.
- The additive migration compiles against the hosted Capital-Lab schema. Its combined rollback-only rehearsal passes all 39 pgTAP assertions, including a regression check that a later lifecycle review cannot leak into an earlier learning snapshot. A post-rollback audit confirms that the functions and index are absent, so no rehearsal state persisted.
- Focused application verification passes 10 files / 64 tests. Repository-wide zero-warning lint, strict TypeScript, 61 files / 491 tests, the PAPER TRADING ONLY scan, and the Next.js 16.3 production build all pass.
- The exact `pnpm verify` sequence reaches only the known local OneDrive formatting condition: Prettier reports 17 unrelated market-ingestion files whose line endings differ in this Windows working tree while Git reports no content diff. Intended-slice formatting and `git diff --check` pass; clean-checkout CI remains the full formatter authority.
- Next.js and React boundary review keeps both independent historical reads parallel, authenticates and authorizes inside the Server Action, retains server-only Supabase access, and serializes only strings, booleans, bounded arrays, and lifecycle-available operation IDs to the client.
- GitHub PR #18 CI run 96 is green at exact application commit `4d8854b`: clean-checkout formatting, zero-warning lint, strict TypeScript, all 491 Vitest tests, the paper-only scan, the Next.js build, all Chromium journeys, a fresh Supabase start/reset, and every pgTAP file passed.
- Hosted migration `20260808204019` is applied to Capital-Lab. Its rollback-only rehearsal and hosted pgTAP suite pass all 39 assertions; generated types match, the five functions retain fixed empty search paths and least-privilege grants, security advisors retain only the known leaked-password-protection warning, and performance findings remain informational unused-index notices.
- Protected Vercel Preview `dpl_6GhNStW2ddTcnJHV78PzUvw6uKjp` is READY as Next.js at exact application commit `4d8854b` with no Production target. The authenticated owner `/memory` route renders the hosted decision boundary, exact-decimal statistics, and honest zero-data states; browser diagnostics are empty and exact-deployment runtime logs contain only successful `200`/`204` requests with no warning, error, or fatal entries.
- The hosted project still has zero pattern hypotheses, strategy assignments, agent runs, agent decisions, orders, and fills. The one pre-existing opening cash-ledger entry is unchanged; market ingestion, scheduler, agents, paid calls, providers, brokerage connections, strategy allocation, and Production remain disabled.

### Immutable hosted decision memory

- [x] Enforce owner, experiment, version, portfolio, run, and decision-time alignment for every new immutable decision context and decision.
- [x] Enforce deterministic outcome chronology and exact excursion-sign invariants without weakening append-only evidence.
- [x] Add one bounded owner-only `decisionAt` read contract that returns exact financial values as text and excludes future evidence at every layer.
- [x] Add strict application mapping, a server-only repository, and a truthful hosted `/memory` view while preserving deterministic mock mode.
- [x] Cover authorization, grants, fixed search paths, lookahead exclusion, exact decimals, immutability, scope drift, and empty hosted state with pgTAP and application tests.
- [x] Run complete application/database/browser release gates, reconcile hosted types/advisors, and publish through a protected Preview and reviewed PR without enabling agents, AI, providers, orders, fills, or Production.

Scope guard: this slice reads and validates persisted paper-only decision evidence. It cannot create a decision, call a model/provider, promote a pattern or strategy, enable a runtime control, or create an order, fill, position, ledger entry, or P&L mutation.

#### Review

- The additive migration and self-contained pgTAP test pass all 33 assertions against the hosted Capital-Lab schema inside a rollback-only transaction. A post-rollback audit confirms that the read function and new indexes are absent, so the rehearsal retained no schema or fixture state.
- The application boundary is green: slice formatting, zero-warning repository ESLint, strict TypeScript, 54 Vitest files / 442 tests, the PAPER TRADING ONLY scan, and the Next.js 16.3 production build all pass. The repository-wide formatter reports only the same 17 untouched OneDrive line-ending files recorded by the prior release.
- The hosted page remains a Server Component with a server-only repository and a strict second owner/time/link/exact-decimal validation layer. React best-practices review found no client state, hydration boundary, serialized credential, or render waterfall.
- The public read is stable, security-invoker, fixed-search-path, bounded to 100 contexts and 100 citations per decision, executable only by `authenticated`, and backed by forced RLS. It provides no mutation or pattern-promotion action.
- GitHub PR #17 CI run 91 is green at exact application commit `f5ccae9`: clean-checkout formatting, zero-warning lint, strict TypeScript, all 442 Vitest tests, the paper-only scan, the Next.js build, all Chromium journeys, a fresh Supabase start/reset, and every pgTAP file passed. The first database run exposed the synthetic experiment version's default present-day `created_at`; the seed now records its canonical historical creation time without weakening the production point-in-time invariant.
- Hosted migration `20260808193957` is applied to Capital-Lab. Generated hosted types match the checked-in memory RPC signature; the function remains stable, security-invoker, fixed-empty-search-path, granted only to `authenticated`, and backed by all four owner/timeline indexes. Security advisors retain only the known leaked-password-protection warning, and performance findings remain informational unused-index notices.
- Protected Vercel Preview `dpl_8oQ4DZ6bsiMrTHjKbKxidGqwUPSf` is READY as Next.js at exact commit `f5ccae9` with no Production target. The authenticated owner `/memory` route renders the database decision boundary and honest zero contexts, decisions, citations, and outcomes; browser diagnostics are empty and deployment runtime logs contain only successful `200`/`204` requests with no warning/error entries.
- The hosted project still has zero decision contexts, agent decisions, decision evidence, trade outcomes, orders, and fills. The one pre-existing opening cash-ledger entry is unchanged; market ingestion, scheduler, agents, paid calls, broker connections, and pattern promotion remain disabled, and Production remains unpromoted.

### Durable owner-triggered paper cycle envelope

- [x] Define one manual-only hosted scheduler contract with a database-stamped decision boundary, fixed 15-minute slots, official-calendar checks, overlap exclusion, and exact duplicate-result reuse.
- [x] Require the authenticated owner, current control revision, active replay/shadow lifecycle, active paper account, locked reviewed manifests, and scheduler/agent/emergency controls off.
- [x] Persist only sanitized scheduler and skipped-simulator evidence while provider requests, ingestion, AI reservations/calls, decisions, orders, fills, positions, and ledger writes remain impossible.
- [x] Add a strict state/read projection, typed repository, re-authorizing Server Action, and hosted experiment control with exact confirmation and unknown-result guidance.
- [x] Cover grants, owner/non-owner/anonymous access, stale inputs, same-operation and same-slot retries, market-closed/runtime-disabled paths, immutable evidence, and zero financial/AI/provider side effects with pgTAP and application tests.
- [x] Reconcile generated types and scheduling/security/runbook/limitation documentation, then run complete application/database/browser release gates before a protected Preview and reviewed merge.

Scope guard: this slice finalizes only the durable manual scheduling envelope and a skipped simulator-run journal. It cannot enable a remote scheduler, fetch market data, call a model, reserve AI budget, create a proposal/order/fill, or mutate cash, positions, or P&L.

#### Review

- The additive migration compiles against the hosted Capital-Lab schema, and the combined rollback-only rehearsal passes all 55 pgTAP assertions without retaining a function, row, or fixture.
- Application gates pass: zero-warning ESLint, strict TypeScript, 52 Vitest files / 429 tests, the PAPER TRADING ONLY scan, the Next.js 16.3 production build, all four mock Chromium journeys, slice formatting, and `git diff --check`. The repository-wide local formatter reports only 17 untouched Windows-checkout line-ending files; clean-checkout CI remains the authoritative full formatting gate. Docker is unavailable locally, so the fresh reset/every-pgTAP gate remains for CI; the hosted-schema rollback rehearsal covers all 55 new assertions.
- The public functions are fixed-search-path security invokers over private fixed-search-path definers. Authenticated callers retain no direct scheduler/simulator inserts, and anonymous/PUBLIC/service-role function execution is denied.
- Two reviewed replay boundaries create exactly two skipped slots/runs and two skipped simulator journals. Exact operation retries and same-slot duplicate deliveries reuse immutable IDs; ingestion, source health, quotes, bars, agents, AI reservations/usage, decisions, orders, fills, ledger, position, and portfolio/P&L counts remain unchanged.
- Hosted migration `20260808181247` is applied to Capital-Lab. Generated hosted RPC types match the checked-in state/run contracts; all five functions retain fixed empty search paths, the public wrappers remain security invokers, and only `authenticated` has execution while owner identity is rechecked inside the private definers. Supabase advisors report no new schema security finding: leaked-password protection remains the one project-level warning, and unused-index notices remain informational.
- GitHub PR #16 passed the clean-checkout application, browser, database, Vercel, and Preview-comment checks for both push and pull-request events at commit `d2ded11`. Vercel Preview `dpl_41gZPMB3o7Tvv7XTaccew5sVfVja` is READY as Next.js at that exact commit; the protected owner UI renders with scheduler, agent, market ingestion, paid calls, and broker connections disabled.
- The authenticated Preview action recorded scheduler run `cfac7702-d0b5-4a19-8ece-76309d962661`, simulator journal `c8c63901-b38b-49d3-b8fa-0db2c2b9ae60`, and one manual slot at the database-stamped `2026-08-08T18:26:37.796476Z` boundary. The closed Saturday session returned `market_closed`; the UI and database agree on the durable IDs and safe-skip result.
- The immediate before/after hosted audit changed only scheduler slots/runs, simulator journals, idempotency, and redacted audit rows from zero/four baselines by exactly one. Ingestion, source health, quotes, bars, agent runs/decisions, AI reservations/usage, orders, fills, position lots/positions, cash-ledger entries, and portfolio snapshots remained unchanged; metadata attests zero provider requests, model calls, orders, fills, and ledger entries. Browser diagnostics are empty, the action POST/refresh are HTTP 200, deployment runtime errors are empty, and Production remains unpromoted.

### Owner-reviewed hosted experiment start

- [x] Define one fixed paper-only start manifest covering the simulator, risk, disabled model routing, reviewed data sources, Luna prompt, empty corpus, AI budget, hosted universe, and official calendar.
- [x] Add one atomic owner-only, draft/control-revision-checked, idempotent replay/shadow start contract that locks an immutable experiment version and creates the paper simulation account, opening cash entry, and initial portfolio snapshot.
- [x] Keep provider runtime fetches, scheduler, agent, Sol, web search, broker capabilities, orders, and fills disabled; expose no credential or environment state to the client.
- [x] Cover readiness, exact owner authorization, direct-write denial, concurrent/stale inputs, retries, manifest drift, immutable evidence, exact decimals, and zero out-of-scope side effects with pgTAP and application tests.
- [x] Add a strict readiness projection, repository boundary, re-authorizing Server Action, and hosted-only draft controls with explicit replay/shadow confirmation.
- [x] Reconcile generated types and lifecycle/security/runbook/limitation documentation, then run the complete application/database/browser release gates before a protected Preview and reviewed merge.

Scope guard: starting creates only deterministic paper-simulation initialization evidence. It cannot call a provider or model, enable ingestion/cron/agent controls, create an order or fill, add a broker integration, or promote Production.

#### Review

- The additive migration and the complete start test passed all 55 pgTAP assertions against the hosted Capital-Lab schema inside one rollback-only transaction. A post-rollback audit confirmed that the rehearsal left no start table, function, or draft fixture behind.
- Local application gates are green: repository-wide zero-warning ESLint, strict TypeScript, 50 Vitest files / 390 tests, the PAPER TRADING ONLY safety scan, the Next.js 16.3 production build, slice formatting, and `git diff --check`.
- GitHub PR #15 CI run 79 is green at application commit `17f79bc`: formatting, lint, strict TypeScript, 390 Vitest tests, the paper-only scan, the production build, all Chromium journeys, a fresh Supabase reset, and every pgTAP file passed. Run 77 exposed the deterministic seed's older AAPL metadata; the rollback-only fixture was aligned without weakening the production conflict check.
- Hosted migration `20260808150423` was applied only after green exact-commit CI. Supabase-generated types match the checked table, version/view, and start-RPC contract; the four readiness identifiers remain intentionally nullable in the client because the function can return an unconfigured state that PostgreSQL function metadata cannot express.
- Protected Vercel Preview `dpl_4gMfCv7mSpEi8CHsUAKsKQytF1At` is READY at exact application commit `17f79bc` with no Production target. The authenticated owner created experiment `c01b2400-0fd4-4242-a932-62f2563db96f`, confirmed `START REPLAY`, and reloaded the persisted Active/Replay detail with locked version `2153e382-04dd-40ad-bac1-d0bf39c20023`; browser and deployment warning/error scans are empty.
- The hosted start created one immutable version, one active paper simulation account, one EUR `100000.00000000` opening ledger entry, and one opening snapshot with EUR `200000.00000000` buying power and zero exposure/P&L. Completed idempotency and redacted audit evidence reference the reviewed start, market, and 2026 calendar manifests.
- Provider runtime fetches and every source/policy, scheduler slot, simulator/ingestion/agent run, agent decision, AI usage event, order, and fill remain zero or disabled. Forced RLS, direct-write denial, narrow authenticated start execution, anonymous/PUBLIC/service-role denial, and the fixed empty search path were rechecked. Security advisors retain only the known leaked-password-protection warning; performance advice is informational unused-index output. Production remains unpromoted.

### Owner-reviewed 2026 official market calendar

- [x] Define one fixed 2026 XNAS/ARCX regular-session manifest from the official Nasdaq Trader and NYSE/NYSE Arca calendars, including the ten exchange holidays and the November 27 / December 24 early closes.
- [x] Add an atomic, owner-only, idempotent Supabase contract that persists disabled provenance sources and exact UTC session evidence, rejects conflicts, and attests the complete manifest without enabling a provider or scheduler.
- [x] Add strict application mapping, a re-authorizing Server Action, a hosted-only `/markets` setup control, and truthful configured/unavailable states while preserving mock mode.
- [x] Cover owner/non-owner/anonymous access, grants/search paths, manifest completeness, DST conversion, holiday/early-close rows, retries, conflict rollback, and zero ingestion/scheduler/agent/order/fill side effects with unit and pgTAP tests.
- [x] Reconcile generated database types and calendar/security/runbook/limitation documentation; run the complete application/database/browser gates and publish through a protected Preview and green reviewed PR without promoting Production.

Scope guard: this slice checks in fixed calendar evidence only. It makes no external runtime request, stores no credentials, enables no data source, cron, agent, AI, experiment, or trading control, and cannot create orders, fills, or ledger entries.

#### Review

- Official-source review fixes the 2026 XNAS and ARCX core calendar at 261 weekday records per exchange: 249 regular sessions, the November 27 / December 24 13:00 early closes, and ten holiday closures. The contract stores New York-local windows as exact UTC timestamps and rejects any extra or conflicting 2026 row.
- The additive migration and combined rollback-only rehearsal passed all 55 pgTAP assertions against hosted PostgreSQL, then migration `20260808115951` was applied only after a green exact-commit CI cycle. Hosted-generated types match the checked contract, including the intentional nullable unconfigured state.
- The complete clean-mirror `pnpm verify` pass is green: formatting, zero-warning ESLint, strict TypeScript, 47 Vitest files / 349 tests, the PAPER TRADING ONLY safety scan, and the Next.js 16.3 production build. The final regression specifically covers the `+00:00` timestamp shape emitted by hosted PostgREST.
- GitHub PR #14 CI run 72 is green at application commit `6b8687e`: application, a fresh Supabase reset plus every pgTAP file, and all four Chromium journeys passed. Earlier CI runs exposed the two append-only synthetic seed sessions, and protected Preview exposed the PostgREST offset mismatch; both were corrected without weakening production conflict checks or authorization.
- Protected Vercel Preview `dpl_25FFkeCUobJ4JVSqc9LxjrHankEB` is READY at exact commit `6b8687e`. The authenticated owner used the real Markets control to attest the manifest, and a full reload persisted the configured UI with the latest eligible XNAS/ARCX sessions; browser and deployment runtime warning/error scans are empty.
- Hosted state contains one manifest and 522 unique weekday rows: each exchange has 249 regular, two early-close, and ten closed sessions. The official Nasdaq/NYSE reference sources and policies remain disabled with `runtime_fetch=false`, Alpaca remains disabled, and scheduler runs/slots, agents, experiments, ingestion runs, orders, fills, and ledger entries remain zero.
- Forced RLS, narrow authenticated RPC access, direct-write denial, anonymous/service-role denial, exact owner attestation, and one redacted audit were rechecked after configuration. Security advisors retain only the known leaked-password-protection warning; performance advice is informational unused-index output on empty or newly populated low-traffic tables. Production remains unpromoted.

### Preview deployment control

- [x] Diagnose the missing Vercel Git deployment without changing production, domains, billing, or environment secrets.
- [x] Replace the repository-wide deployment shutdown with a branch rule that keeps `main` disabled and permits non-production Preview branches.
- [x] Verify the configuration, publish only the scoped config/tracker change, and confirm Vercel creates a protected Preview from the Git push.
- [x] Run the protected browser and runtime checks, merge only through green required checks, and leave Production unpromoted.

#### Review

- Root cause: the connected Git integration was healthy, but `vercel.json` explicitly disabled every Git-triggered deployment. The branch rule now disables only `main`, leaving normal non-production Preview branches enabled.
- Git push `8f38550` automatically created protected Preview `dpl_ArTMWe7K4nqnqHqCZu1Rz5Qo2yk2` from the exact commit. It reached `READY` with no Production target and no build errors.
- The owner gate rendered with meaningful content, no Next.js error overlay, and no browser warnings/errors. Preview runtime logs returned `200` for `/`, `/dashboard`, `/login`, `/experiments`, and `/api/health`, with no warning/error entries.
- Both the push and pull-request CI runs passed the application, fresh Supabase reset/pgTAP, and Chromium browser jobs before merge approval. No environment variable, credential, domain, billing, Supabase data, or Production alias was changed.

### Hosted locked-experiment lifecycle controls

- [x] Define one owner-only, revision-checked, idempotent lifecycle contract for explicit shadow-to-live-paper simulation promotion, pause, resume, completion, and clone-to-draft; keep scheduler, agent, and all broker capabilities disabled.
- [x] Preserve the immutable locked experiment/version, simulation ledger, orders, fills, and historical status evidence; clone only configuration references and paper capital into a new disabled draft.
- [x] Add strict application inputs, a re-authorizing Server Action, typed Supabase repository mapping, and hosted detail controls with explicit confirmation and truthful conflict/unknown-result states.
- [x] Cover owner/non-owner/anonymous access, allowed and forbidden transitions, revision conflicts, retries, evidence integrity, clone isolation, and zero financial/order/AI/scheduler side effects with unit and pgTAP tests.
- [x] Reconcile generated types and lifecycle/security/runbook/limitation documentation, then run the complete application/database/browser release gates before a protected Preview and reviewed merge.

#### Scope note

Draft-to-replay/shadow start was completed in the separate owner-reviewed slice above. It locks the exact simulator, risk, routing, data-source, prompt/corpus, budget, universe, and calendar references without changing the independent locked-experiment lifecycle contract.

#### Review in progress

- The migration and all 43 lifecycle pgTAP assertions passed against the hosted Capital-Lab schema in rollback-only transactions; no fixture state was retained. The rehearsals caught and corrected the canonical open-order state set, result-column qualification, fixture portability, and owner-scoped provenance index coverage before release.
- Clean-mirror application gates pass: Prettier, zero-warning ESLint, strict TypeScript, 43 Vitest files / 308 tests, the paper-only safety scan, and the Next.js 16.3 production build.
- GitHub PR #12 CI run 56 is green: the application, fresh Supabase reset/pgTAP, and Chromium browser jobs all passed.
- Hosted lifecycle and provenance-index migrations were applied only after CI passed. Hosted-generated TypeScript types were reconciled. The project remains at zero experiments, orders, fills, agent runs, scheduler runs, enabled controls, and enabled Alpaca sources. Authenticated execution is granted only through the narrow lifecycle RPC; anonymous/PUBLIC execution and direct authenticated experiment updates are denied, and both lifecycle functions have fixed search paths.
- Supabase security advisors report only the known Free-plan leaked-password warning. The new foreign key is fully indexed; performance advisors otherwise report informational unused-index findings on the empty/low-traffic schema.

### Deterministic point-in-time market features

- [x] Define `market-technical-v1` in pure domain code with canonical Decimal.js inputs/outputs, bounded one-minute history, strict continuity, and explicit unavailable states for missing samples or zero denominators.
- [x] Add an owner-only, read-only Supabase feature-input function that selects at most 21 eligible latest logical bar revisions per feed at a required decision timestamp and returns every financial value as exact text.
- [x] Extend the atomic hosted market snapshot and strict mapper so configuration, quotes/bars, feature inputs, sessions, and source health share one PostgreSQL statement boundary; reject owner/time/scope/latest-bar drift again in the application.
- [x] Render spread, one/five-minute returns, 20-minute relative volume, five-minute realized volatility, SMA5 distance, and typical-price-VWAP20 distance with truthful history coverage on hosted `/markets`.
- [x] Cover deterministic math, malformed/gapped/zero-denominator inputs, owner/grant/search-path boundaries, correction/cancellation/future-receipt behavior, exact-text precision, bounded reads, and zero mutations with unit and pgTAP tests.
- [x] Run the complete application/database/browser release gates, reconcile hosted generated types and advisors, publish a protected Preview through a green PR, apply the migration, and merge without enabling Alpaca, scheduler, AI, or production.

Scope guard: feature generation is a read-only derivation from persisted evidence. It cannot contact Alpaca, add credentials, enable a source, create a scheduler/agent/order/fill/ledger row, or promote production. Missing market history remains unavailable.

#### Review

- The generated migration compiled on the hosted PostgreSQL schema and the bound rollback-only pgTAP rehearsal completed `1..17`; a post-check confirmed the new function, temporary feature bars, and pgTAP extension were all absent afterward.
- Focused pure/application verification passes in the clean workspace (4 files / 30 tests plus strict TypeScript). The complete application gate is green: Prettier, zero-warning ESLint, strict TypeScript, 42 Vitest files / 282 tests, the PAPER TRADING ONLY safety scan, and the Next.js 16.3 production build. The repository-pinned pnpm download wrapper stalled after the bundled pnpm 11 tried to replace the mirror's dependency tree, so the same six scripts were executed directly with the already installed project binaries.
- GitHub PR #11 CI runs 49 and 51 are green through application commit `2f002b4`: the application gate, four mock Playwright journeys, a fresh Supabase reset, and every pgTAP file passed.
- Hosted migration `20260807222906` is applied to Capital-Lab. Generated hosted types match the checked-in feature-input and aggregate RPC contracts. The feature function is stable, security-invoker, fixed-search-path, executable by authenticated callers, and denied to anonymous/PUBLIC. Alpaca IEX and its policy remain disabled; quote, bar, health, raw-event, ingestion, scheduler, agent, order, fill, and cash-ledger counts remain zero. Security advisors remain unchanged with only leaked-password protection disabled; performance advice is informational unused-index output on the empty runtime tables.
- Protected Vercel Preview `dpl_EkLcDF1hwwiL4oKduMBYrEhnFh6n` is READY as Next.js at exact application commit `2f002b4`. Health reports PAPER TRADING ONLY with mock data and the agent disabled; owner sign-in renders with owner setup absent, unauthenticated `/markets` access fails closed, and deployment runtime error/warning scans are empty. Production remains unpromoted.

### Owner-triggered Alpaca IEX ingestion

- [x] Harden the data-only Alpaca HTTP adapter around the exact `data.alpaca.markets` quote and stock-bar endpoints with five-symbol bounds, raw/as-of historical semantics, pagination, byte/page/record limits, redirect refusal, per-request and aggregate timeouts, exact decimal parsing, provider request IDs, and sanitized typed failures.
- [x] Define a fixed manual batch: the reviewed SPY/QQQ/AAPL/MSFT/NVDA aliases, latest IEX quotes, and bounded completed raw one-minute bars. Do not call Alpaca calendar, account, broker, or order hosts; market-session ingestion remains a later official-calendar slice.
- [x] Add owner-only, idempotent source activation plus short begin/commit/fail/result database RPCs. Derive identity from `auth.uid()`, keep provider calls outside database transactions, stamp availability in PostgreSQL, append revisions rather than overwrite, record raw normalized evidence, source health, ingestion counters, and redacted audits, and deny direct writes.
- [x] Add a re-authorizing Server Action, typed repository/orchestration boundary, and hosted `/markets` controls with truthful credential/source/readiness, success, replay, failure, and unknown-result states. Keep mock mode unchanged and scheduler/agent/order creation disabled.
- [x] Cover adapter, mapper, repository, action, RLS/grants, owner/non-owner/anonymous access, retry/idempotency, correction history, malformed/future/oversized payloads, source lifecycle, zero scheduler/agent/order side effects, and failure recording with unit and pgTAP tests.
- [x] Reconcile generated database types and update data-source, security, deployment, runbook, limitation, implementation-plan, and task-review documentation.
- [x] Run formatting, lint, strict typecheck, focused/full tests, database reset/pgTAP, paper-only and secret scans, production build, mock browser journeys, protected Preview verification, Supabase advisors, and merge only through a green reviewed PR. Do not promote production or enable a scheduler/agent.

Scope guard: this slice may contact only Alpaca Market Data after an authenticated owner explicitly enables the reviewed IEX source and invokes a manual batch with server-only credentials. It cannot call the Alpaca calendar because the documented calendar endpoint is on a trading host, cannot place or forward an order, cannot enable cron or AI, and cannot store credentials in Supabase.

#### Review

- Implementation is complete locally. Focused ingestion tests pass (9 files / 92 tests), and the clean-mirror `pnpm verify` pass is green: formatting, zero-warning lint, strict TypeScript, 41 Vitest files / 275 tests, paper-only scan, and Next.js 16.3 production build.
- Pull request #9 CI run 40 is green at commit `14f31bf`: application formatting/lint/typecheck/test/safety/build passed, Playwright passed, a fresh Supabase reset applied every migration, and all four database files / 1084 pgTAP assertions passed.
- Hosted migration `20260807195503` was applied to Capital-Lab only after clean CI. Generated hosted TypeScript types were reconciled and independently passed the complete clean-mirror gate again. The source and current policy remain disabled; quote, bar, health, raw-event, ingestion-run, scheduler-run, agent-run, order, and fill counts are all zero. Authenticated roles retain no direct inserts, anonymous function execution is denied, and all reviewed mutation functions have fixed empty search paths.
- Supabase security advisors report only the known Free-plan leaked-password warning; performance advisors report informational unused-index findings on the empty/low-traffic schema. Protected Vercel Preview `capital-8dp3fj7d2-constantinjanz-7876s-projects.vercel.app` is READY: remote build/typecheck passed, `/api/health` reports paper-only mock mode with the agent disabled, and unauthenticated `/markets` redirects to the owner login. No production promotion or Alpaca request occurred.

### Owner-reviewed hosted market configuration

- [x] Define one fixed, bounded manifest for XNAS/ARCX, SPY/QQQ/AAPL/MSFT/NVDA, exact Alpaca aliases, locked append-only owner universe versions that reuse the exact current version, and one initially disabled Alpaca IEX data-only source/policy.
- [x] Add an atomic owner-only configuration RPC that derives identity from `auth.uid()`, uses a private `SECURITY DEFINER` implementation with a fixed empty search path and public invoker wrapper, serializes setup, records durable idempotency and redacted audit evidence, and rejects conflicting reference metadata.
- [x] Cover owner/non-owner/anonymous access, direct-write denial, same-operation replay, changed-input rejection, conflict rollback, immutable prior universe versions, explicit grants, and a zero-observation post-state with rollback-only pgTAP.
- [x] Add a typed Supabase repository, re-authorizing Server Action, and hosted-only `/markets` setup control with precise failure states while preserving the deterministic mock page unchanged.
- [x] Reconcile generated database types and the implementation/data-source/limitation/security documentation with the already implemented direct Alpaca adapter and the deliberately deferred ingestion/runtime boundaries.
- [x] Apply and verify the additive migration against the hosted project, confirm the exact five-member disabled-source state and zero quote/bar/session/health/ingestion/scheduler evidence, and review Supabase advisors.
- [x] Run formatting, lint, strict typecheck, focused/full tests, pgTAP, paper-only/secret scans, production build, mock Playwright journeys, protected Preview verification, and merge only through a green reviewed PR.

Scope guard: this slice makes no Alpaca request, stores no Alpaca or Supabase secret, grants no direct table writes, creates no calendar or market observation, enables no scheduler/agent/provider, and does not promote production. Manual owner-triggered data-only ingestion remains the next separate review slice.

#### Review

- The fixed configuration, owner-only idempotent RPC, typed Server Action/repository, hosted setup control, and database-attested `reviewed_manifest_id` are implemented. The attestation fails closed on reference/member/alias/source/policy/audit drift while remaining separate from future runtime activation authorization.
- Local application verification is green: changed-file formatting, ESLint with zero warnings, strict TypeScript, 33 Vitest files / 185 tests, the paper-only scan, and the Next.js production build. Independent application, SQL, and contract-consistency reviews were addressed.
- Hosted migration `20260807172041` was applied to Capital-Lab after both push and pull-request CI passed the full database reset and all 118 pgTAP assertions. Owner operation `884debf6-cc53-4e09-bc15-4c2c0b7d14aa` created one locked five-member universe, exact Alpaca aliases, and one disabled data-only source/policy; replay is idempotent and the snapshot attests `capital_lab_us_core_alpaca_iex_v1`.
- Hosted grant checks are all green: only authenticated owners can invoke configuration, anonymous/service-role configuration is denied, the public wrapper is a fixed-search-path invoker over a private fixed-search-path definer, authenticated roles retain no direct writes, and attestation has the intended authenticated/service grants. The audit is redacted, and quotes, bars, FX, corporate actions, sessions, health, raw events, ingestion, and scheduler evidence all remain at zero.
- Supabase security advisors remain unchanged with only leaked-password protection disabled; performance advisors contain informational unused-index findings on the still-empty runtime tables. Generated hosted RPC types match the checked-in contract, retaining the intentional SQL-correct nullable snapshot override.
- GitHub CI is green for both push and pull-request events at application commit `d9e9112`: application formatting/lint/typecheck/tests/safety/build, database reset/pgTAP, and four mock browser journeys all passed. The initial database failure was isolated to two same-statement pgTAP snapshot joins plus one earlier valid fail-closed message and was corrected without changing the migration.
- Protected Vercel Preview `dpl_Gt1TKUTwWkrsHL34W1otyPfzFs5L` is READY at exact commit `d9e9112` as Next.js. Health reports paper-only with the market provider in safe mock mode and the agent disabled; the owner login renders without an application error overlay, protected `/markets` fails closed for the unavailable browser identity, and deployment runtime/browser-console error scans are empty. Production remains unpromoted.

### Hosted point-in-time market snapshot

- [x] Add owner-only, read-only Supabase functions for an atomic current configuration scope, universe instruments, completed quote/bar revisions, recent sessions, and provider health at one database-stamped decision timestamp; return every market decimal as exact text and deny anonymous callers explicitly.
- [x] Cover the database contract with pgTAP for owner/non-owner/anonymous access, latest-correction selection, cancelled-record removal, future availability/receipt and incomplete-bar exclusion, exact decimal output, bounded session/source reads, and zero mutations.
- [x] Add strict hosted snapshot mappers and a server-only repository that requests one database-stamped aggregate snapshot, rejects malformed/partial/future or cross-exchange rows, emits sanitized failure classifications, and never falls back to fixtures or calls an external provider.
- [x] Route `/markets` by authenticated data mode and add a separate hosted view with truthful unconfigured/empty/current-day-session/provider-observation states while preserving the deterministic mock page byte-for-byte.
- [x] Apply and verify the additive migration with rollback-only hosted fixtures, regenerate/check database types, review Supabase advisors, and confirm the empty project remains unchanged.
- [x] Run formatting, lint, strict typecheck, focused/full unit and database tests, paper-only/secret scans, the production build, and all mock Playwright journeys.
- [x] Publish through a reviewed GitHub PR, verify CI and a protected Vercel Preview, and merge only if every gate is green.

#### Review

- The additive hosted market migration was exercised against rollback-only fixtures with `1..73` pgTAP assertions, then applied as hosted migration `20260807140239`. The owner receives one database-stamped aggregate row, non-owners fail with `42501`, all five RPCs remain stable security invokers with fixed empty search paths, and anonymous/PUBLIC execution is revoked.
- The hosted database remains empty across universes, instruments, sources, quotes, bars, sessions, and health evidence. Generated types were reconciled with SQL-correct nullable fields. Supabase security advisors remain unchanged with only leaked-password protection disabled; performance advisors contain only expected unused-index information on the empty database.
- Full application verification passed: Prettier, ESLint with zero warnings, strict TypeScript, 29 Vitest files / 144 tests, the paper-only and literal-secret scans, the Next.js production build, four mock Playwright journeys, a visual `/markets` browser check with no overlay/console/page errors, and the production dependency audit with no known vulnerabilities.
- GitHub PR #7 passed the application, database, and browser jobs for both push and pull-request events at application commit `7acb0a0`. Protected Vercel Preview `dpl_Dkcm52JGA3zmznHajSwGwA8FVCp7` is READY at that exact commit after a cold-cache build; health is paper-only with the external market-data feed and agent disabled, the Supabase owner form renders with bootstrap absent, unauthenticated `/markets` access fails closed, and browser/runtime error logs are empty. Production remains unpromoted.

### Hosted draft metadata editing

- [x] Add an owner-only, revision-checked draft-update contract that changes only the normalized name and objective, preserves every execution/configuration field, and uses durable idempotency plus one redacted audit record.
- [x] Expose the exact draft revision in the hosted detail read model and add SQL contract coverage for authorization, validation, stale writes, retries, immutable replay results, direct-write denial, and atomic rollback.
- [x] Add a protected Server Action, typed repository boundary, and hosted-only editor with precise validation and conflict messaging while preserving the deterministic mock experience.
- [x] Apply the additive migration after rollback-only hosted validation, regenerate/check database types, and review Supabase security and performance advisors.
- [x] Run formatting, lint, strict typecheck, unit/database/browser tests, paper-only and secret scans, dependency audit, and the production build.
- [x] Publish through a reviewed GitHub PR, verify CI and the Vercel preview, and merge only if all gates are green.

#### Review

- Additive metadata migration and the reviewed controls-before-experiment lock-order correction applied to Capital-Lab after rollback-only compile/behavior probes. A focused hosted pgTAP transaction passed `1..28`, then rolled back its temporary experiment, audit/idempotency rows, and pgTAP extension; the project remains at zero experiments.
- The hosted contract exposes `draft_revision` as exact text, grants the public security-invoker RPC only to authenticated/service roles, and leaves direct table mutation denied. Same-operation replay, replay after a later edit, stale-write rollback, changed-body rejection, redacted auditing, and preservation of every execution side table were verified.
- Full application verification passed: Prettier, ESLint with zero warnings, strict TypeScript, 27 Vitest files / 127 tests, paper-only safety scan, and the Next.js production build. Four mock Playwright journeys and the production dependency audit also passed. Independent reviews cleared the database security boundary, ambiguous-result reconciliation, and UUID normalization/version handling.
- Supabase generated types match the checked-in revision/view/RPC fields. Security advisors remain unchanged with only the Free-plan leaked-password warning; performance advisors contain only expected unused-index information on the empty database.
- GitHub PR #5 passed both push and pull-request application, database, and browser jobs, then merged as `c4cf042`. Vercel Preview `dpl_6tVtueNuiKawxfkuSjhGDzmim8Vv` is READY at the reviewed source commit after a cold-cache build; hosted owner login renders with setup disabled, unauthenticated experiment access redirects to login, and no runtime warnings or errors were found. The final hosted snapshot retains the controls-before-experiment lock order and zero experiment, update-idempotency, or update-audit rows.

### Hosted draft experiment creation

- [x] Define an owner-only, atomic Supabase draft-creation contract with explicit grants, an exact decimal default, safe paper-only settings, durable idempotency, audit evidence, and an initialized disabled control row.
- [x] Add SQL contract coverage for valid owner creation, anonymous/non-owner denial, invalid input rollback, and persisted read-model precision.
- [x] Add a protected Next.js Server Action and hosted form that validate input, create the draft, surface safe field errors, and redirect to the persisted detail route.
- [x] Preserve the existing deterministic mock flow and update hosted list/detail copy so the new write boundary is truthful.
- [x] Apply the migration to Capital-Lab, regenerate/check database types, run advisors, and verify the hosted owner authorization and protected browser boundaries.
- [x] Run formatting, lint, typecheck, unit, database, browser, audit, and production-build gates; document the review results before publishing.

#### Review

- Hosted creation and idempotent-replay migrations applied after rollback-only validation. A create/edit/retry verification returned the original UUID with one lifecycle event and one audit record, then rolled back; the project remains at zero experiments.
- Focused boundary tests: 4 files and 23 tests passed. Full application suite: 26 files and 92 tests passed. Lint, typecheck, paper-only safety scan, production build, production dependency audit, and four mock Playwright journeys passed.
- Hosted generated types match the checked-in RPC contract. Authenticated execution remains granted, anonymous execution is denied, and no verification experiment, idempotency row, or audit row remains.
- Post-migration security advisors remain unchanged: only the Supabase Pro-plan leaked-password warning is open.
- GitHub PR #4 passed both application, database, and browser jobs for the push and pull-request events. Vercel preview `dpl_82Gowd43b66Z9NzrPMSbe6c3ajMT` is READY at the reviewed commit with no runtime errors; the owner login rendered and an unauthenticated experiment request failed closed. No privileged sign-in link was generated and no permanent draft was created for visual testing.

### Owner lock and hosted experiment detail

- [x] Verify the confirmed hosted identity is the single active application owner and the database bootstrap is consumed.
- [x] Disable the application owner-setup flag, deploy the locked Preview, and verify sign-in remains while setup is absent.
- [x] Merge the verified owner/bootstrap revision through GitHub PR #1 and synchronize `main`.
- [x] Disable project-level public signup in Supabase Auth and verify after reload that signup, manual linking, and anonymous sign-in remain off while email confirmation remains on.
- [x] Add an owner-RLS-backed `security_invoker` experiment-detail read view with exact decimal/bigint strings, explicit grants, and its supporting index.
- [x] Replace the hosted experiment-detail 404 with a read-only Supabase repository, strict mapper, honest empty states, persisted status timeline, and mock-mode preservation.
- [x] Remove adjacent hosted fabrications: unknown AI spend, missing controls shown as off, mock-specific 404 copy, and hosted manual-cycle execution.
- [x] Extend SQL/application/browser contracts, apply and audit the hosted migration, and publish a protected Preview for the next review PR.

### Hosted owner and first live database slice

- [x] Add a server-controlled, one-time owner bootstrap path that uses `OWNER_EMAIL`, never persists a privileged Supabase key in the application, and leaves ongoing authorization in `app_users`.
- [x] Add a safe email/password owner registration state and keep all non-owner identities denied.
- [x] Replace the protected shell, dashboard landing state, and experiment reads with owner-scoped Supabase data when hosted Auth is configured; retain deterministic fixtures only in explicit mock mode.
- [x] Make live empty/read-only states honest: no synthetic experiment, portfolio, scheduler, spend, or control state may be presented as hosted data.
- [x] Extend application, SQL contract, and browser coverage for owner bootstrap, RLS, live mapping, and mock-mode regressions.
- [x] Apply and audit the hosted migration, configure only the non-secret owner bootstrap environment, and verify the protected preview.
- [x] Publish the verified revision and complete the private confirmation-email owner handoff.

### GitHub, Supabase, and Vercel connection

- [x] Inspect connected accounts/projects and local CLI/Git state without mutations.
- [x] Initialize a project-local Git repository for `constantinjanz/Capital-Lab` without touching the unrelated parent repository.
- [x] Apply the hosted Supabase schema, align migration history, generate typed clients, and clear security/unindexed-foreign-key advisor findings.
- [x] Provision the first hosted owner identity; do not apply the development auth seed to the hosted project.
- [x] Create and link the Vercel project, configure scoped public Supabase variables without installing the unused secret key, and connect GitHub.
- [x] Bootstrap the empty GitHub default branch with the verified code and no committed credentials.
- [x] Deploy and verify a protected preview; leave production unpromoted until the owner identity and reviewed database adapters are ready.

- [x] Inspect workspace, toolchain, governing instructions, and master brief.
- [x] Verify current official platform guidance and package baseline.
- [x] Phase 0: architecture and operating documents.
- [x] Phase 1: Next.js foundation, environment, auth, health, styling, and CI.
- [x] Phase 2: Supabase migrations, ownership/RLS/grants, fixtures, and SQL tests authored.
- [x] Phase 3: decimal simulator, risk, point-in-time integrity, and reconciliation tests.
- [x] Phase 4: mock and data-only provider adapters, ingestion, provenance, and features.
- [x] Phase 5: all dashboard/control-plane routes and accessible UI states.
- [x] Phase 6: AI pricing/budgets, scheduler, idempotency, and fake gateway.
- [x] Phase 7: research import/retrieval, memory, outcomes, and strategy gates.
- [x] Phase 8: Luna/Terra/Sol orchestration with disabled safe defaults.
- [x] Phase 9: application quality gates, security/docs review, and handoff.
- [ ] Infrastructure follow-up: execute the same reset/pgTAP path locally when Docker/Supabase CLI is available (the hosted rollback-only contract passed 700 assertions).
- [ ] Integration follow-up: continue replacing the remaining mock-only use cases after owner provisioning; the protected shell, dashboard landing, and experiment list now have owner-scoped Supabase reads.
- [ ] Approve the initial GitHub Actions workflow through an authenticated GitHub web session; GitHub's public-repository workflow protection held the Codex-authored run before any job steps executed.

## Review

- Status: GitHub, hosted Supabase, and protected Vercel previews are connected; the confirmed identity is the single active owner, both application bootstrap and project-level signup are disabled, PRs #1 and #2 are merged, and production promotion remains intentionally pending while the remaining hosted adapters and write paths are built and reviewed.
- Starting state: empty directory, no Git repository.
- Available: Node.js 24, corepack, pnpm 10, npm 11, Git.
- Unavailable: Docker and Supabase CLI; local database test execution will require installation.
- External mutations: 15 hosted Supabase migrations, the GitHub root history plus merged PR #1 on `main`, one Vercel project/Git connection, scoped public environment variables, a preview-only non-secret owner email/bootstrap/base URL configuration, and six READY previews. No privileged Supabase key, broker, live-market-data, paid OpenAI, agent, scheduler, or production deployment was enabled.
- `pnpm verify`: passed after the exact-string hosted experiment-detail slice was wired (Prettier, ESLint with zero warnings, strict TypeScript, 22 Vitest files / 69 tests, safety and secret scan, Next.js production build with all required routes).
- `pnpm test:e2e`: passed (4 Chromium critical-flow tests).
- `pnpm audit --prod`: passed with no known production vulnerabilities.
- Hosted database contract: passed `1..700` against rollback-only seed fixtures; the run verified singleton owner binding, exact confirmed-email enforcement, and RLS, then left zero Auth users, owner rows, experiments, or pgTAP extension state behind.
- Hosted database audit: 15 transaction-framed migrations, 78 tables, RLS on all 63 public tables, a `security_invoker` experiment-detail view with explicit grants, exact decimal/bigint rollback checks, and only expected unused-index information. The owner bootstrap configuration is consumed by the one confirmed active owner. The Auth advisor still warns that leaked-password protection is disabled.
- Vercel preview: deployment `dpl_2bbGoCxcY23LNjGE1uZbxHWXF4Y1` is READY as Next.js at `capital-juq9mv4u7-constantinjanz-7876s-projects.vercel.app`; Vercel Authentication protects workspace probes, the application owner-setup flow remains absent, and deployment-specific error logs are empty. Automatic Git deployments remain disabled pending deliberate production approval.
- GitHub CI: repository Actions are enabled, but the initial public-repository run was held in the queue and canceled before any steps; GitHub requires a collaborator to approve this protected workflow in an authenticated web session.
