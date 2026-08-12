# PR #21 fourth activation-readiness remediation report

Date: 2026-08-12

Repository: `constantinjanz/Capital-Lab`

Branch: `codex/activation-readiness-follow-up`

Draft PR: `#21` (must remain Draft and unmerged)

Verified starting SHA: `3015f864f26e2d547f43e1f47a8adfe6a1200bf8`

Implementation SHA: `ae878c0b02b4a929570465da9c61a0282a007521`

Final report/handoff SHA: intentionally recorded in the Draft PR and final chat
handoff after this report is committed. A Git commit cannot contain its own SHA
without changing that SHA, so the report does not make a self-referential claim.

Merge base used by the checksum contract:
`70ed610d5e0e5c08bf523d0d160a7b76f5fe2e51`.

## Current acceptance status

`BLOCKED — CODE-LEVEL ACCEPTANCE CRITERIA NOT MET`

The executable provenance workflow for independent pre/post schema Goldens is
implemented, but the two required committed Golden files are deliberately
absent. They were not fabricated from the backup source, restore target,
Hosted database, placeholders, or a circular CI artifact. Consequently exact
implementation CI run `31609688876` correctly fails closed in
`verify-schema-golden-contracts.mjs`; application gates after that step and the
pre/post export/restore gates cannot be counted as passed. This supersedes every
earlier positive readiness conclusion in the historical sections below.

## Authorization and non-execution

This remediation changed repository artifacts and used local/ephemeral test
fixtures only. It did not apply a Hosted migration, run Hosted `db push`, run
Hosted migration repair, install or mutate a Hosted extension, read/create/change
a Hosted Vault secret, create/alter/activate/remove a Hosted Cron job, send a
scheduler/auth-probe/auth-noop request, change a Vercel Production environment
variable, create or promote a Production deployment, invoke OpenAI, market-data,
news, broker, paid Canary, web-search, Sol, or trading execution, or create an
order, fill, position, ledger entry, or other trading side effect. No secret,
credential-derived hash, Authorization header, or credential value was persisted
or printed. PR #21 was not merged or marked ready for review.

Dangerous controls remain required false: scheduler during the disabled
deployment and after stop, agent, autonomous paper execution, paid models,
Canary, web search, Sol challenger/execution, and real broker. The only modeled
runtime exception is the separately reviewed no-AI Runtime deployment where
`scheduler_enabled=true` is permitted only after its immutable deployment proof;
all trading/AI/provider controls remain false and providers remain mock/paper.
No activation phase was executed in this remediation.

## Read-only preflight observations and limits

- Git independently derived the starting branch/head and a 21-file unrelated
  dirty set in the shared checkout. Work occurred in a clean detached worktree;
  those unrelated files were neither staged, reformatted, reverted, nor committed.
- The linked Supabase project ref is `qrnuyibntcxwffrxmrvn`. Read-only migration
  metadata showed 32 applied entries. The four repository migrations beginning
  with `20260809150000`, `20260809150417`, `20260812092043`, and
  `20260812140953` are not in that Hosted history; none was applied here.
- Fifteen same-name version discrepancies were mapped one-to-one to the Hosted
  applied identifiers. Each repository rename is 100% byte-identical in Git.
  Hosted history was not mutated and migration repair was not used. A final
  read-only metadata comparison found the exact same 82 public/private base
  relation names in Hosted and the pre-activation contract, with RLS enabled on
  all 82. The new independent-Golden contract additionally covers the full Auth
  base-table schema and application/Auth foreign-key closure, but its pre/post
  restore cannot pass until the two separately generated Golden files are
  reviewed and committed. No Hosted rows were exported.
- Read-only extension metadata showed `pg_cron` and `pg_net` absent. The
  platform-managed Vault extension exists. Vault values and entries were not read.
  No Hosted Cron/job/Vault mutation or scheduler request was made.
- Read-only Vercel metadata identified team
  `team_yqndKHk6nfWGlte1UVLTJOHG`, project
  `prj_pbCNwlmXZLeZprZpsRAfAAhPPXVR`, Node 24.x, `live=false`, and the observed
  branch deployment as Preview/`target=null`. Production environment variables
  and Production deployments were not changed or probed by request. A live
  Production deployment proof is deliberately a later operator gate.
- GitHub read-only metadata confirmed PR #21 is open, Draft, unmerged, and points
  to the requested branch. Exact final head, CI run IDs, and Preview ID are added
  to the Draft-PR handoff after the final push.

## Finding-by-finding disposition

| Finding                     | Root cause                                                                                         | Executable remediation                                                                                                                                                                                                                                                                                             | Test/evidence                                                                                                                                                | Remaining gate or risk                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| P0-1 two Vercel deployments | One deployment identity incorrectly represented disabled auth and enabled runtime                  | Append-only role bindings `auth_disabled` and `no_ai_runtime_enabled`; distinct immutable IDs; required `runtime_deployment_verified` state before freeze/arm; Runtime envelopes use only the Runtime binding                                                                                                      | Route, domain, runner and pgTAP happy/negative paths prohibit equal IDs and role/commit/project/environment drift                                            | Future real deployments require separately reviewed read-only proofs; none created here |
| P0-2 trusted endpoint       | URL syntax and operator strings could bless an attacker origin                                     | Checksummed project identity contract plus read-only Vercel proof verifier for team/project/READY/production/commit/deployment/alias/path; canonical no-port/userinfo/query/fragment origin; sanitized proof hash                                                                                                  | Hostile arbitrary host, redirect, alias, team/project, Preview, commit/deployment drift and forged-echo fixtures                                             | Live proof intentionally not executed in this repository-only run                       |
| P0-3 mandatory 401 probes   | Auth-noop could skip missing/invalid Bearer validation                                             | Mandatory endpoint/probe-claimed/probes-verified/auth-noop/runtime states; exactly one durable missing and one invalid identity; exact 401/schema/no-redirect/zero-effects evidence; original request reconciliation only                                                                                          | pgTAP happy path runs the probes; Auth-Noop-before-probes and replacement/unknown-outcome paths fail                                                         | No real request sent by design                                                          |
| P0-4 pre-migration backup   | Existing exporter referenced post-migration objects and covered a partial relation set             | Separate versioned pre (82 relations/32 migrations) and post (108 relations/36 migrations) contracts; full Auth schema, sensitive Auth equality only in ephemeral memory, exact Owner/Auth closure, schema-driven FK validation, external manifest hash, distinct stack proof and empty-target identity validation | Unit tamper/identity/provenance matrix; source/target restore remains fail-closed before use without both independent Goldens                                | The two approved seed-free Golden files are absent; no restore pass is claimed          |
| P0-5 handoff checksums      | Stale hashes and omitted changed files were not enforced                                           | Deterministic status-aware merge-base generator; A/M hash HEAD bytes, D hashes merge-base bytes; exact casing/uniqueness/set verification; CRLF/LF-sensitive                                                                                                                                                       | Stale, omitted, extra, duplicate, rename/delete, casing and byte-difference tests                                                                            | Manifest excludes only itself and this report                                           |
| Break-glass availability    | General runner rejected dirty trees and required Campaign/Vercel artifacts                         | Minimal emergency runner allows unrelated dirt, verifies its own HEAD blobs, structurally binds TLS/project/database, requires UUID and exact phrase, runs bounded DB-first kill/readback without Vercel/manifest                                                                                                  | Dirty tree, absent manifest, Vercel unavailable, replay, target/campaign mismatch, timeout/unknown tests                                                     | Requires a future authorized database operator and valid target credentials             |
| Side-effect completeness    | A fixed 22-table list omitted mutable application state                                            | Every public/private base table is exactly activation evidence, scheduler envelope, forbidden, or explicit platform exclusion; new tables fail CI classification                                                                                                                                                   | Catalog equality plus adversarial market/portfolio/risk/simulator/trade/decision/experiment mutation tests                                                   | Schema growth must update the reviewed contract                                         |
| Paid Canary prerequisite    | Paid claim was not tied to passed no-AI terminal evidence                                          | Claim requires exactly one immutable passed Campaign, all dangerous controls false, jobs inactive/absent, and no unresolved network outcome                                                                                                                                                                        | Canary-before-terminal and state-drift negatives                                                                                                             | Canary remains disabled and was not executed                                            |
| Retry-safe terminal work    | Unknown commits could repeat or overwrite operations                                               | Operation-ID keyed append-only terminal operations return same evidence on retry and reject different identities                                                                                                                                                                                                   | Duplicate/unknown finalize, unschedule and emergency phase-two tests                                                                                         | Operator runbook must preserve the original operation ID                                |
| Runtime/Windows/credentials | Mixed Node versions, shallow CI history, unsafe subprocess assumptions                             | Node 24.x everywhere; 100-commit bounded scanner with binary/size guards; executable resolution, argument arrays, `shell:false`, timeouts/signals, safe junction/case handling, held-file `try/finally`                                                                                                            | Windows subprocess/metacharacter/path/fault tests and redacted current/history scan                                                                          | Local database gates need Docker; CI supplies the clean Linux database run              |
| Database privilege/evidence | Administrative paths and append-only evidence needed stronger denial                               | Fixed empty `search_path`, qualified SQL, owner/campaign checks, composite FKs, minimal wrapper grants, no service-role admin transitions, UPDATE/DELETE/TRUNCATE guards                                                                                                                                           | pgTAP RLS/grants/SECURITY DEFINER/TRUNCATE/service-role tests                                                                                                | Database owner retains unavoidable DDL authority                                        |
| Reconcile/finalize          | Ephemeral pg_net and owner availability could strand or fabricate outcomes                         | Capture first on every tick, exact JSON bindings/counters, fresh snapshots, missing evidence becomes inconclusive, drain before job disable, exact 52 slots/104 events, server-time final gates                                                                                                                    | Deterministic full path and late/duplicate/missing/error/correlation/counter/terminal mismatch tests                                                         | Real transport remains a later authorized gate                                          |
| Auth transport destination  | A valid Bearer could still be sent to a mutable Production alias before response identity checking | Forward-only submission functions revalidate the immutable `auth_disabled` binding and send both probes and Auth No-op only to its deployment-specific URL; the Vault alias remains a separate scope check                                                                                                         | Function-definition assertions, hostile identity fixtures, distinct deployment route tests                                                                   | No live request was sent                                                                |
| Transport/counter evidence  | Auth evidence did not require exact JSON/no-store metadata and omitted portfolio mutations         | Durable transport insertion re-reads the exact transient pg_net row, accepts only `application/json` plus exact `Cache-Control: no-store`, persists sanitized fields only, and requires the portfolio zero-counter                                                                                                 | Missing no-store, wrong content type, missing portfolio key, exact route and 104-response pgTAP fixtures                                                     | pg_net remains transient and is never long-term audit storage                           |
| Forbidden mutation timing   | AFTER-statement triggers detected a forbidden effect after its DML could persist                   | Every classified forbidden relation now rejects INSERT/UPDATE/DELETE/TRUNCATE in a BEFORE-statement trigger while protected states exist                                                                                                                                                                           | Actual synthetic market, portfolio, risk, simulator, outcome, decision and experiment row mutations plus compensation attempts must throw and preserve bytes | Exact SQL execution requires the current ephemeral CI database gate                     |
| Emergency state drift       | A global active-Campaign count made phase-one kill fail when a second Campaign existed             | Bounded mutations are scoped to the exact operation/campaign; emergency repair is valid from terminal drift; nine settings and owner experiment controls are verified before Campaign stop evidence                                                                                                                | Second Campaign is created through the real prepare lifecycle; repeated kill and terminal-control-drift cases                                                | Cron phase two remains separate and cannot roll back phase one                          |
| Golden provenance           | Golden generation could circularly use Source A and ignored most Auth schema objects               | A checksummed run/container/system-ID proof requires a fresh seed-free, migration-built reference cluster distinct from Source A; complete Auth base-schema fingerprints are frozen while Auth row data remains users/identities only                                                                              | Provenance, same-server, seeded, wrong-contract, Auth cardinality and FK query tests                                                                         | Golden generation requires explicit separate approval and has not occurred              |

## Fourth-remediation verification delta

Local commands used Node `v24.14.0` and repository dependencies without network
or external providers:

| Command                                  |        Exit | Exact result                                                                          |
| ---------------------------------------- | ----------: | ------------------------------------------------------------------------------------- |
| `prettier --check .`                     |           0 | all matched files formatted                                                           |
| `eslint . --max-warnings=0`              |           0 | zero warnings                                                                         |
| `tsc --noEmit`                           |           0 | strict TypeScript passed                                                              |
| `vitest run`                             |           0 | 96 files / 715 tests passed                                                           |
| focused adversarial suite                |           0 | 8 files / 94 tests passed                                                             |
| `check-paper-only.mjs`                   |           0 | PAPER-only scan passed                                                                |
| `check-credential-patterns.mjs`          |           0 | worktree plus 100 commits, zero redacted findings                                     |
| `activation-phase-contract.mjs --verify` |           0 | 21 phases; SHA-256 `66524049b1ead87e89014109c9757a6051bab6584846f6c9b69a7d0e8054d85a` |
| `generate-backup-contracts.mjs --verify` |           0 | 82 pre / 108 post relations; 32 pre / 36 post migrations                              |
| `verify-schema-golden-contracts.mjs`     |           1 | expected fail-closed `ENOENT`; both independent Golden files absent                   |
| `git diff --check`                       |           0 | no whitespace errors                                                                  |
| Docker/local Supabase                    | unavailable | no Docker executable; no local reset/pgTAP/restore claim                              |

Exact implementation CI `31609688876` is tied to
`ae878c0b02b4a929570465da9c61a0282a007521`. Browser 4/4 and the native Windows
subprocess job passed. The Application job stopped at the intentionally absent
schema Goldens before later application gates. The database job verified the
pinned CLI setup but its redacted ephemeral `supabase start` exited 1 before
rollback, reset, pgTAP or restore. No retry was added or used to mask that
unknown infrastructure outcome; no database gate from this run is claimed.

### Exact fourth-run changed files (`3015f864` → `ae878c0`)

```text
M  .github/workflows/ci.yml
M  IMPLEMENTATION_PLAN.md
M  docs/BACKUP_AND_RESTORE.md
M  docs/RUNBOOK.md
M  package.json
M  scripts/activation-artifacts.test.ts
M  scripts/activation-phase-contract.mjs
A  scripts/capture-backup-schema-golden.mjs
M  scripts/check-credential-patterns.mjs
A  scripts/create-local-restore-stack.mjs
M  scripts/critical-backup-contract.mjs
M  scripts/critical-backup-contract.test.ts
M  scripts/export-critical-tables.mjs
M  scripts/generate-backup-contracts.mjs
A  scripts/lib/credential-scan-safety.mjs
A  scripts/lib/credential-scan-safety.test.ts
A  scripts/lib/local-supabase-target-proof.mjs
A  scripts/lib/mvcc-race-control.mjs
A  scripts/lib/mvcc-race-control.test.ts
A  scripts/lib/safe-artifact-path.mjs
A  scripts/lib/safe-artifact-path.test.ts
M  scripts/lib/safe-process.mjs
A  scripts/lib/schema-golden-reference-proof.mjs
A  scripts/lib/schema-golden-reference-proof.test.ts
A  scripts/local-auth-restore-fixture.mjs
A  scripts/local-auth-restore-fixture.test.ts
A  scripts/local-supabase-target-proof.test.ts
A  scripts/prepare-schema-golden-reference-proof.mjs
M  scripts/prepare-seed-free-local-restore-target.mjs
A  scripts/prepare-seed-free-local-restore-target.test.ts
M  scripts/run-activation-phase.mjs
M  scripts/run-activation-phase.test.ts
M  scripts/run-database-tests.mjs
A  scripts/run-database-tests.test.ts
A  scripts/run-emergency-bootstrap.mjs
M  scripts/run-emergency-kill.mjs
M  scripts/run-emergency-kill.test.ts
A  scripts/run-local-mvcc-race-writer.mjs
M  scripts/run-local-rollback-migration-rehearsal.mjs
A  scripts/run-redacted-subprocess.mjs
A  scripts/run-redacted-subprocess.test.ts
M  scripts/vercel-deployment-proof.mjs
M  scripts/vercel-deployment-proof.test.ts
M  scripts/verify-backup-restore.mjs
A  scripts/verify-schema-golden-contracts.mjs
M  src/app/api/internal/scheduler/route.test.ts
M  src/app/api/internal/scheduler/route.ts
M  src/domain/activation-readiness/no-ai-dry-run.ts
M  src/lib/env/server.test.ts
M  src/lib/env/server.ts
M  supabase/activation/emergency-kill.sql
A  supabase/activation/finalize-runtime-deployment.sql
M  supabase/activation/phase-contract.json
M  supabase/activation/prepare-no-ai-dry-run.sql
M  supabase/activation/project-identity.v1.json
A  supabase/activation/request-runtime-config-attestation.sql
A  supabase/activation/verify-runtime-config-attestation.sql
M  supabase/activation/verify-runtime-deployment.sql
M  supabase/backup/post-activation.v1.json
M  supabase/backup/pre-activation.v1.json
A  supabase/backup/target-stack/supabase/config.toml
A  supabase/migrations/20260812092043_fourth_activation_readiness_remediation.sql
A  supabase/migrations/20260812140953_fourth_activation_readiness_review_closure.sql
M  supabase/tests/activation_readiness_follow_up_test.sql
M  tasks/lessons.md
M  tasks/todo.md
```

## Checksums from final implementation bytes

### Top-level contracts

| Artifact                                                        | SHA-256                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `20260809150000_post_build_hosting_safety.sql`                  | `ee9a1390a6cf1abfca9a8664d6dfe492bc217741265f2d0d5e8b010af6c0352e` |
| `20260809150417_activation_readiness_follow_up.sql`             | `01e5b32ccc10581b272a31b91660854e6875241a88aa2893b3f1e185ef9dfb7d` |
| `20260812092043_fourth_activation_readiness_remediation.sql`    | `0385cf8d05b105766f43f2c5f0b2683696a3d0416cd79390fbdae97b2d0b23fa` |
| `20260812140953_fourth_activation_readiness_review_closure.sql` | `e8382eb73227eb4a227eb1036daaa7e7c1d5826f4234ee3f86516980f8f136fe` |
| `pre-activation.v1.json`                                        | `fa8a573a1d5ee2a1134b1079bc4e813fb9463061aa9ed8df9397ba57690f27de` |
| `post-activation.v1.json`                                       | `95e8d4426e5f12626faa03a7d99e283a49beb7a3faf88383eec98890c09b5197` |
| `project-identity.v1.json`                                      | `d6b38244bdc714f3aa68efbb96ddd36115e13410e8c2d9e8c14677e512f1a634` |
| `phase-contract.json` (21 phases)                               | `66524049b1ead87e89014109c9757a6051bab6584846f6c9b69a7d0e8054d85a` |
| handoff checksum manifest (145 entries)                         | `1d9e940abf5867c5d87e33717a5ada210602fb8da4521eea211820cc38da7560` |

### Phase SQL

| Phase                                | SHA-256                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| prepare                              | `f91e119c407441b5313f08ff1ac2bdfc30fb467273ec088e8228d3763549d20d` |
| scheduler-infrastructure-preparation | `380c12f533caf6af75abae33b2f7c0a15b0dca8e1721bc45cd4b051335d8df01` |
| vault-verification                   | `cfd79e63558f668269148e88abd49a22d7be5122d1ae34414546fb41b17f878b` |
| install-jobs-disabled                | `733ed8603607ef7be0c5d54fdfe88d564c3df61e11c2733c692122b19bb90713` |
| auth-endpoint-verify                 | `e87a224c33235203fe3cf43ebe0a91fa7eba5324bdc315afab8924aa80258e55` |
| auth-failure-request                 | `ff9f5fae3852514f707e23f7e371e10f116eeda4e277aa2813025b94009b603f` |
| auth-failure-reconcile               | `f0ddc8d05101b714d4d6e65dfb6492b348958449c7672151d2eb4fdee9c3b020` |
| auth-noop-request                    | `25cd5df3aa260b81fec0d80cd7d425151ca6d0cb6776d6f5bf2ab01aa6042b1c` |
| auth-noop-reconcile                  | `7f033516ed8fbb0fb1e33d74eef3b4412d27f198dd08d5a7ff470102681680da` |
| runtime-deployment-verify            | `2cb2de20d560dd9655e176862570f58ca0e3fd61f30f81937cf14a9aefae9166` |
| runtime-config-request               | `12b47deb2cbb6332990ad0ca206a94e0e97d9679bbc4cc955fc7aedced7684c6` |
| runtime-config-reconcile             | `7a71cffe4ff8a66622cf24fcb57a1727a67a3147ae1dc877ff589c349017a4c7` |
| runtime-deployment-finalize          | `3c1f3e68958e56629521cff118bba3abcd7028bd91cb50c56e813b830d52ad3f` |
| baseline-freeze                      | `5ec0f72caeac1b4ff66dc3876d0a2e0c838c7ab290be8d7a10e51efbb459e111` |
| arm                                  | `289f55a7c4c5cd4ddb941ce86874a59ae9517fdfdd77a4684c3fcf69f4faec85` |
| drain-reconcile                      | `74a7ad9ed88e17e4e2fae20f82d2d1d209fad9e52d53a241867a97968f75abdc` |
| manual-finalize                      | `92b0cf37028d26e441afd4d5dcb9f41ccbff58c2b94204a4fa0bd08d4a5d2fea` |
| orderly-stop                         | `66f98a1645e163e945037ffc6f94e71da1c2412479e46fa37dd79e075ac8e7b7` |
| unschedule-terminal-jobs             | `adb2645b7d667641bbfeddc70c5a5455cc051564ef4dcafc302d051d723d6d2e` |
| emergency-kill                       | `9ff1e85f95f975c4db3cd578783d01fe2288de024128b1409afdbe7662b7e6a6` |
| emergency-disable-jobs               | `367efa2975e081b3323086ed9d39c2cba62598bd7aee0da96c1b070d7ec2d0c3` |

## Verification ledger

Local machine: Windows, Node `v24.14.0`, mock/paper-only environment. Commands
that initially failed solely because the sandbox denied browser spawn or public
font retrieval were rerun with the same command outside that sandbox; both then
passed. No assertion, timeout, retry, or safety gate was weakened.

| Command                                      |        Exit | Result                                          |
| -------------------------------------------- | ----------: | ----------------------------------------------- |
| `prettier --check .`                         |           0 | all matched files formatted                     |
| `eslint . --max-warnings=0`                  |           0 | zero warnings                                   |
| `tsc --noEmit`                               |           0 | strict TypeScript passed                        |
| `vitest run`                                 |           0 | 87 files, 635 tests passed                      |
| `node scripts/check-paper-only.mjs`          |           0 | PAPER-only scanner passed                       |
| `node scripts/check-credential-patterns.mjs` |           0 | worktree + 100 commits, zero redacted findings  |
| `next build`                                 |           0 | Next.js 16.3 production build passed on Node 24 |
| `playwright test --fail-on-flaky-tests`      |           0 | 4/4 Chromium mock-only flows passed             |
| `supabase@2.113.0 --version`                 |           0 | exact version `2.113.0`                         |
| `activation-phase-contract.mjs --verify`     |           0 | 18 phases, exact contract hash                  |
| `generate-backup-contracts.mjs --verify`     |           0 | 82 pre / 105 post relations                     |
| `handoff-checksums.mjs --verify`             |           0 | 115 exact entries, exact manifest hash          |
| `git diff --check`                           |           0 | no whitespace errors                            |
| `docker version`                             | unavailable | executable absent; no local DB gate claimed     |

The local seed-free pre/post restore, Supabase start/reset/pgTAP, and rollback
rehearsals were not run because Docker is unavailable. Exact-head CI run
`31489442949` supplied those clean ephemeral-database gates. The final
report/manifest-only commit is run through the same workflow; its exact SHA, CI
run, and Preview deployment are recorded in the Draft PR and chat handoff rather
than creating a self-referential report commit.

CI run `31478991594` was a deliberate fail-closed remediation run. Its Windows
subprocess job and 4/4 Playwright flows passed. The application job stopped at
a CRLF/LF-dependent phase checksum before any application gate; internal
repository text identities now canonicalize UTF-8 line endings and include a
cross-platform negative suite, while external artifacts remain raw-byte exact.
The database job successfully started Supabase and compiled/applied all
migrations to the ephemeral stack, then stopped because the Ubuntu image had a
`psql` wrapper without a versioned client package. CI now explicitly installs
and verifies PostgreSQL 17 client tools. No failed/skipped gate is counted as a
pass; the replacement exact-head run is mandatory.

CI run `31480224272` then proved all three canonical contracts on Linux and
again passed the Windows and 4/4 browser jobs. Application reached the full
unit suite and found that the simulated-Windows resolver fixture still applied
the host Linux execute-bit rule; the real Windows smoke job was green. The
resolver now uses its explicitly selected platform consistently, with focused
Linux and Windows-fixture coverage. Database stopped before Supabase because
Ubuntu Noble's default Apt sources do not contain PostgreSQL client 17. The
workflow now binds the official PGDG repository to the full expected signing-key
fingerprint, installs client 17, and asserts major version 17. This run is also
recorded as failed, not retried or reclassified.

CI run `31480867586` passed the complete application, Windows, and 4/4 browser
jobs. PGDG fingerprint validation and client-17 installation passed, but the
rollback process resolved Ubuntu's generic `/usr/bin/psql` wrapper instead of
the installed native PG17 executable. CI now requires the exact executable
`/usr/lib/postgresql/17/bin/psql`, verifies its major version directly, and
prepends only that native tool directory through `GITHUB_PATH`. Reset, pgTAP,
and both restores were correctly skipped after the rehearsal failure. This run
is failed evidence and does not support readiness.

CI run `31481331885` passed the complete application, Windows, and 4/4 browser
jobs. The database job passed the fingerprint-bound PGDG client install, the
rollback-only rehearsal of both pending migrations, and a fresh seed-free
Supabase reset. pgTAP then failed closed before either restore and exposed three
root causes: retry handling preceded the deployment-proof hash check, a local
PL/pgSQL variable made `probe_kind` ambiguous, and the new terminal-operation
trigger helper retained PostgreSQL's default `PUBLIC` execute privilege. The
proof is now cryptographically validated before retry reconciliation, the
variable is unambiguous, and the helper is covered by the explicit revoke set.
The post-migration backup contract was regenerated from the new migration
bytes. No failing assertion was weakened, and this failed run is not readiness
evidence; a replacement exact-head run remains mandatory.

CI run `31483832916` passed the complete application, Windows, and 4/4 browser
jobs, followed by Supabase start, both rollback rehearsals, and a fresh reset.
The prior 401/proof/privilege defects were resolved. pgTAP's next first failure
showed the synthetic test setup writing forbidden market-calendar/session and
experiment state after `runtime_deployment_verified`; the production mutation
guard correctly committed a DB-first stop. The deterministic local fixture now
runs before Campaign preparation, while every protected-state mutation test and
its emergency-stop assertion remains unchanged. The restores were correctly
skipped after pgTAP. This failed run is not readiness evidence; a replacement
exact-head run remains mandatory.

CI run `31484467384` passed application, Windows, browser, Supabase start, both
rollback rehearsals, and reset. pgTAP then completed the two-deployment,
mandatory-401, 52-slot/104-event, emergency, finalization, unschedule, and
pre-terminal Canary-denial paths; one of 1,920 assertions aborted at the first
allowed post-terminal Canary claim because the insert named nonexistent column
`metadata`. The immutable prerequisite payload now uses the existing `result`
evidence column, and a new assertion requires all three globally locked model
rows to bind to the exact passed Activation Campaign. The post-migration backup
contract was regenerated. Restores were correctly skipped after pgTAP. This
failed run is not readiness evidence; a replacement exact-head run remains
mandatory.

CI run `31485089511` passed application, Windows, browser, Supabase start, both
rollback rehearsals, and reset. Every one of the 135 Activation assertions ran;
the sole failure was the existing requirement that retryable emergency phase
two preserve an append-only `auto_stopped` transition proving phase-one controls
had already committed. The later operation-ID implementation had replaced the
earlier transition-writing body. Phase two now inserts and immediately verifies
the exact transition; a completed retry validates both immutable operation
evidence and the transition's operation/correlation identity before returning.
The post-migration backup contract was regenerated. Restores were correctly
skipped after pgTAP. This failed run is not readiness evidence; a replacement
exact-head run remains mandatory.

CI run `31485769952` passed application, Windows, browser, Supabase start, both
rollback rehearsals, reset, and every pgTAP assertion. The restore gate then
successfully created the 82-relation pre-activation backup and entered disposable
target preparation, where it failed closed because `supabase_vault WITH SCHEMA
vault` was requested before the new `template0` database contained schema
`vault`. The local-only target path now creates that schema under
`supabase_admin` before installing the extension, and a unit test freezes this
ordering. No Hosted extension or Vault state was inspected or mutated. The post
restore did not run after the pre-target failure. This failed run is not
readiness evidence; a replacement exact-head run remains mandatory.

CI run `31486465529` again passed application, Windows, browser, Supabase start,
both rollback rehearsals, reset, and pgTAP. The pre-activation exporter created
its 82-relation backup, and disposable Supabase platform preparation completed.
Schema restore then failed closed because the new `template0` database already
had an empty `public` schema while the verified dump contains `CREATE SCHEMA
public`. The preparer now drops only that empty schema in the exact
loopback-only, confirmation-bound `capital_lab_restore` database, inside the
existing cleanup boundary, before restoring platform and application schemas.
Unit coverage freezes this ordering. The post restore did not run after the
pre-restore failure. This failed run is not readiness evidence; a replacement
exact-head run remains mandatory.

CI run `31487163698` passed application (87 files / 634 tests), Windows (4
files / 14 tests), browser (4/4), Supabase start, both rollback rehearsals,
reset, and all 14 pgTAP files / 1,927 assertions. The pre-activation exporter
created 82 relation artifacts and the seed-free target preparation completed.
Application-schema restore then failed closed because the disposable `template0`
target had not installed the baseline `pgcrypto`, `citext`, and `vector`
extensions before restoring columns typed as `extensions.vector`. The preparer
now installs exactly those unversioned extensions, already declared by the first
historical application migration, in the validated loopback-only disposable
database before application-schema restore. Unit coverage freezes the ordering.
The post restore did not run after the pre-restore failure. This failed run is
not readiness evidence; a replacement exact-head run remains mandatory.

CI run `31488059936` again passed application (87 files / 634 tests), Windows
(4 files / 14 tests), browser (4/4), Supabase start, both rollback rehearsals,
reset, and all 14 pgTAP files / 1,927 assertions. The baseline-extension fix
carried the 82-relation pre restore through application types; the next
fail-closed statement was a platform-owned `supabase_admin` `ALTER DEFAULT
PRIVILEGES` emitted by plain `pg_dump --no-owner`. The version-5 exporter now
creates a restrictive-permission custom archive, parses its explicit TOC,
retains all application-owned `postgres` default ACLs and current object grants,
excludes only the classified platform-owned default ACL entries, rejects every
unknown owner, records both exact owners/counts and all PostgreSQL tool versions,
and removes its intermediate archive/TOC. The exact current grant fingerprint
remains mandatory after restore. The post restore did not run after the pre
failure. This failed run is not readiness evidence; a replacement exact-head run
remains mandatory.

CI run `31489442949` is the complete green implementation run at exact handoff
head `8afa83e36fd47def562eac3c15218fe4d7b79921`: application 87 files / 635
tests, formatting, zero-warning lint, strict TypeScript, PAPER-only scan,
worktree plus 100-commit credential scan with zero redacted findings, Node-24
production build, Windows 4 files / 14 tests, and 4/4 mock browser flows passed.
Supabase CLI 2.113.0 started the ephemeral stack; both pending migrations passed
rollback-only rehearsals; reset and all 14 pgTAP files / 1,927 assertions passed.
The seed-free pre contract exported and restored 82/82 relations with manifest
SHA-256 `2994fbd798a0891641572748fe5df2c3c3d5af2b889acf48919f326a672006cb`.
The post contract exported and restored 105/105 relations with manifest SHA-256
`0f490a59df1c4f4b2cb19219dc8def5049c48baf5859ad76711aa128e012da8b`.
Both verifiers reproduced migration history, schema/catalog evidence, column
contracts, current grants, and deterministic full-row evidence exactly. No
Production data or credential was used.

## Exact status-aware changed-file set

`A` and `M` entries hash canonical HEAD bytes. `D` entries hash canonical
merge-base bytes. The checksum manifest excludes only itself and this report.

```text
M  .github/workflows/ci.yml
M  .gitignore
A  .node-version
A  .nvmrc
M  .prettierignore
M  docs/BACKUP_AND_RESTORE.md
M  docs/DEPLOYMENT.md
M  docs/KNOWN_LIMITATIONS.md
M  docs/post-build/hosting-safety-audit.md
M  docs/RUNBOOK.md
M  e2e/mock-mode.spec.ts
M  IMPLEMENTATION_PLAN.md
M  package.json
M  playwright.config.ts
M  README.md
A  scripts/activation-artifacts.test.ts
A  scripts/activation-phase-contract.mjs
A  scripts/check-credential-patterns.mjs
A  scripts/critical-backup-contract.mjs
A  scripts/critical-backup-contract.test.ts
M  scripts/export-critical-tables.mjs
A  scripts/generate-backup-contracts.mjs
A  scripts/generate-backup-contracts.test.ts
A  scripts/handoff-checksums.mjs
A  scripts/handoff-checksums.test.ts
A  scripts/lib/canonical-repository-bytes.mjs
A  scripts/lib/canonical-repository-bytes.test.ts
A  scripts/lib/held-files.mjs
A  scripts/lib/held-files.test.ts
A  scripts/lib/safe-process.mjs
A  scripts/lib/safe-process.test.ts
A  scripts/migration-rehearsal-contract.mjs
A  scripts/migration-rehearsal-contract.test.ts
A  scripts/prepare-seed-free-local-restore-target.mjs
A  scripts/run-activation-phase.mjs
A  scripts/run-activation-phase.test.ts
A  scripts/run-ci-gate.mjs
A  scripts/run-emergency-kill.mjs
A  scripts/run-emergency-kill.test.ts
A  scripts/run-local-rollback-migration-rehearsal.mjs
A  scripts/run-openai-paid-canary-child.mjs
M  scripts/run-openai-paid-canary.ts
A  scripts/vercel-deployment-proof.mjs
A  scripts/vercel-deployment-proof.test.ts
M  scripts/verify-backup-restore.mjs
A  src/app/api/health/route.test.ts
M  src/app/api/health/route.ts
M  src/app/api/internal/scheduler/route.test.ts
M  src/app/api/internal/scheduler/route.ts
A  src/domain/activation-readiness/no-ai-dry-run.test.ts
A  src/domain/activation-readiness/no-ai-dry-run.ts
M  src/features/agent/paid-canary.test.ts
M  src/features/research/research-importer.tsx
M  src/lib/env/server.test.ts
M  src/lib/supabase/scheduler-runtime-repository.ts
M  supabase/activation/disable-hosted-scheduler.sql
A  supabase/activation/drain-reconcile.sql
A  supabase/activation/emergency-disable-jobs.sql
A  supabase/activation/emergency-kill.sql
M  supabase/activation/enable-hosted-scheduler.sql
A  supabase/activation/finalize-no-ai-dry-run.sql
A  supabase/activation/install-hosted-scheduler-jobs-disabled.sql
A  supabase/activation/phase-contract.json
A  supabase/activation/plan-and-freeze-no-ai-dry-run.sql
A  supabase/activation/prepare-no-ai-dry-run.sql
A  supabase/activation/prepare-scheduler-infrastructure.sql
A  supabase/activation/project-identity.v1.json
A  supabase/activation/request-scheduler-auth-failures.sql
A  supabase/activation/request-scheduler-auth-noop.sql
A  supabase/activation/unschedule-terminal-jobs.sql
A  supabase/activation/verify-auth-deployment.sql
A  supabase/activation/verify-runtime-deployment.sql
A  supabase/activation/verify-scheduler-auth-failures.sql
A  supabase/activation/verify-scheduler-auth-noop.sql
A  supabase/activation/verify-scheduler-vault.sql
A  supabase/backup/post-activation.v1.json
A  supabase/backup/pre-activation.v1.json
A  supabase/backup/seed-free-target-prelude.sql
D  supabase/migrations/20260806230845_experiment_detail_read_view.sql
A  supabase/migrations/20260806231551_experiment_detail_read_view.sql
D  supabase/migrations/20260807003631_hosted_draft_experiment_creation.sql
A  supabase/migrations/20260807005039_hosted_draft_experiment_creation.sql
D  supabase/migrations/20260807010216_fix_draft_idempotent_replay.sql
A  supabase/migrations/20260807010609_fix_draft_idempotent_replay.sql
D  supabase/migrations/20260807074159_hosted_draft_metadata_update.sql
A  supabase/migrations/20260807075504_hosted_draft_metadata_update.sql
D  supabase/migrations/20260807080749_fix_draft_update_lock_order.sql
A  supabase/migrations/20260807101714_fix_draft_update_lock_order.sql
D  supabase/migrations/20260807152514_hosted_market_configuration.sql
A  supabase/migrations/20260807172041_hosted_market_configuration.sql
D  supabase/migrations/20260807182144_manual_alpaca_ingestion.sql
A  supabase/migrations/20260807195503_manual_alpaca_ingestion.sql
D  supabase/migrations/20260807225640_hosted_locked_experiment_lifecycle.sql
A  supabase/migrations/20260807233649_hosted_locked_experiment_lifecycle.sql
A  supabase/migrations/20260807233953_reconcile_experiment_clone_provenance_index.sql
D  supabase/migrations/20260808013901_reconcile_experiment_clone_provenance_index.sql
D  supabase/migrations/20260808104856_hosted_official_market_calendar.sql
A  supabase/migrations/20260808115951_hosted_official_market_calendar.sql
D  supabase/migrations/20260808123948_hosted_experiment_start.sql
A  supabase/migrations/20260808150423_hosted_experiment_start.sql
D  supabase/migrations/20260808154152_durable_hosted_manual_cycle.sql
A  supabase/migrations/20260808181247_durable_hosted_manual_cycle.sql
D  supabase/migrations/20260808185120_immutable_hosted_decision_memory.sql
A  supabase/migrations/20260808193957_immutable_hosted_decision_memory.sql
D  supabase/migrations/20260808213223_structured_shadow_agent_runtime.sql
A  supabase/migrations/20260808235225_structured_shadow_agent_runtime.sql
A  supabase/migrations/20260809000307_structured_agent_prompt_pin_indexes.sql
D  supabase/migrations/20260809015621_structured_agent_prompt_pin_indexes.sql
A  supabase/migrations/20260809150417_activation_readiness_follow_up.sql
M  supabase/tests/0001_database_contract.sql
A  supabase/tests/activation_readiness_follow_up_test.sql
M  supabase/tests/post_build_hosting_safety_test.sql
M  tasks/lessons.md
M  tasks/todo.md
M  vitest.config.ts
```

## Manual gates and stop conditions

- Independent review must validate both exact commits and the checksum manifest.
- Exact-head CI must pass Node 24 application/browser/Windows gates, pinned
  Supabase 2.113.0 start/reset, all pgTAP, both rollback rehearsals, and both
  seed-free backup/restore contracts. Any skipped or flaky safety-critical gate
  is failure.
- A future Production operator must separately create and read-only prove two
  distinct deployments from the same reviewed commit. This report authorizes
  neither deployment nor request.
- Production backup/export, migration apply, endpoint probes, Vault/Cron setup,
  runtime arm, Canary, provider, broker, and trading remain separate manual gates.
- Any Hosted drift, proof mismatch, unknown request outcome, missing transport
  evidence, relation/schema/history mismatch, or non-false dangerous control is
  an immediate fail-closed stop.

## Conclusion

BLOCKED — CODE-LEVEL ACCEPTANCE CRITERIA NOT MET
