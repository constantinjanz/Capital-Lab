# PR #21 third activation-readiness remediation report

Date: 2026-08-11

Repository: `constantinjanz/Capital-Lab`

Branch: `codex/activation-readiness-follow-up`

Draft PR: `#21` (must remain Draft and unmerged)

Verified starting SHA: `e705f67db819be13c99f759e07186c63f114b831`

Implementation SHA: `65a727c4454c3c0f509906e80d70a1304d2cbae9`

Final report/handoff SHA: intentionally recorded in the Draft PR and final chat
handoff after this report is committed. A Git commit cannot contain its own SHA
without changing that SHA, so the report does not make a self-referential claim.

Merge base used by the checksum contract:
`70ed610d5e0e5c08bf523d0d160a7b76f5fe2e51`.

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
  metadata showed 32 applied entries and proved both pending PR migrations
  `20260809150000` and `20260809150417` absent.
- Fifteen same-name version discrepancies were mapped one-to-one to the Hosted
  applied identifiers. Each repository rename is 100% byte-identical in Git.
  Hosted history was not mutated and migration repair was not used. Exact schema
  equivalence remains an exact-head pre/post baseline and restore CI assertion.
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

| Finding                     | Root cause                                                                             | Executable remediation                                                                                                                                                                                                      | Test/evidence                                                                                                               | Remaining gate or risk                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| P0-1 two Vercel deployments | One deployment identity incorrectly represented disabled auth and enabled runtime      | Append-only role bindings `auth_disabled` and `no_ai_runtime_enabled`; distinct immutable IDs; required `runtime_deployment_verified` state before freeze/arm; Runtime envelopes use only the Runtime binding               | Route, domain, runner and pgTAP happy/negative paths prohibit equal IDs and role/commit/project/environment drift           | Future real deployments require separately reviewed read-only proofs; none created here |
| P0-2 trusted endpoint       | URL syntax and operator strings could bless an attacker origin                         | Checksummed project identity contract plus read-only Vercel proof verifier for team/project/READY/production/commit/deployment/alias/path; canonical no-port/userinfo/query/fragment origin; sanitized proof hash           | Hostile arbitrary host, redirect, alias, team/project, Preview, commit/deployment drift and forged-echo fixtures            | Live proof intentionally not executed in this repository-only run                       |
| P0-3 mandatory 401 probes   | Auth-noop could skip missing/invalid Bearer validation                                 | Mandatory endpoint/probe-claimed/probes-verified/auth-noop/runtime states; exactly one durable missing and one invalid identity; exact 401/schema/no-redirect/zero-effects evidence; original request reconciliation only   | pgTAP happy path runs the probes; Auth-Noop-before-probes and replacement/unknown-outcome paths fail                        | No real request sent by design                                                          |
| P0-4 pre-migration backup   | Existing exporter referenced post-migration objects and covered a partial relation set | Separate versioned pre (82 relations) and post (105 relations) contracts; catalog-complete classification; migration/history/role/server/schema/content evidence; external manifest hash; safe seed-free target preparation | Unit tamper matrix includes relation/column/history/schema/artifact/hash drift; CI owns both real seed-free export/restores | Docker absent locally; exact-head CI result is mandatory and must not be inferred       |
| P0-5 handoff checksums      | Stale hashes and omitted changed files were not enforced                               | Deterministic status-aware merge-base generator; A/M hash HEAD bytes, D hashes merge-base bytes; exact casing/uniqueness/set verification; CRLF/LF-sensitive                                                                | Stale, omitted, extra, duplicate, rename/delete, casing and byte-difference tests                                           | Manifest excludes only itself and this report                                           |
| Break-glass availability    | General runner rejected dirty trees and required Campaign/Vercel artifacts             | Minimal emergency runner allows unrelated dirt, verifies its own HEAD blobs, structurally binds TLS/project/database, requires UUID and exact phrase, runs bounded DB-first kill/readback without Vercel/manifest           | Dirty tree, absent manifest, Vercel unavailable, replay, target/campaign mismatch, timeout/unknown tests                    | Requires a future authorized database operator and valid target credentials             |
| Side-effect completeness    | A fixed 22-table list omitted mutable application state                                | Every public/private base table is exactly activation evidence, scheduler envelope, forbidden, or explicit platform exclusion; new tables fail CI classification                                                            | Catalog equality plus adversarial market/portfolio/risk/simulator/trade/decision/experiment mutation tests                  | Schema growth must update the reviewed contract                                         |
| Paid Canary prerequisite    | Paid claim was not tied to passed no-AI terminal evidence                              | Claim requires exactly one immutable passed Campaign, all dangerous controls false, jobs inactive/absent, and no unresolved network outcome                                                                                 | Canary-before-terminal and state-drift negatives                                                                            | Canary remains disabled and was not executed                                            |
| Retry-safe terminal work    | Unknown commits could repeat or overwrite operations                                   | Operation-ID keyed append-only terminal operations return same evidence on retry and reject different identities                                                                                                            | Duplicate/unknown finalize, unschedule and emergency phase-two tests                                                        | Operator runbook must preserve the original operation ID                                |
| Runtime/Windows/credentials | Mixed Node versions, shallow CI history, unsafe subprocess assumptions                 | Node 24.x everywhere; 100-commit bounded scanner with binary/size guards; executable resolution, argument arrays, `shell:false`, timeouts/signals, safe junction/case handling, held-file `try/finally`                     | Windows subprocess/metacharacter/path/fault tests and redacted current/history scan                                         | Local database gates need Docker; CI supplies the clean Linux database run              |
| Database privilege/evidence | Administrative paths and append-only evidence needed stronger denial                   | Fixed empty `search_path`, qualified SQL, owner/campaign checks, composite FKs, minimal wrapper grants, no service-role admin transitions, UPDATE/DELETE/TRUNCATE guards                                                    | pgTAP RLS/grants/SECURITY DEFINER/TRUNCATE/service-role tests                                                               | Database owner retains unavoidable DDL authority                                        |
| Reconcile/finalize          | Ephemeral pg_net and owner availability could strand or fabricate outcomes             | Capture first on every tick, exact JSON bindings/counters, fresh snapshots, missing evidence becomes inconclusive, drain before job disable, exact 52 slots/104 events, server-time final gates                             | Deterministic full path and late/duplicate/missing/error/correlation/counter/terminal mismatch tests                        | Real transport remains a later authorized gate                                          |

## Checksums from final implementation bytes

### Top-level contracts

| Artifact                                            | SHA-256                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `20260809150000_post_build_hosting_safety.sql`      | `ee9a1390a6cf1abfca9a8664d6dfe492bc217741265f2d0d5e8b010af6c0352e` |
| `20260809150417_activation_readiness_follow_up.sql` | `01e5b32ccc10581b272a31b91660854e6875241a88aa2893b3f1e185ef9dfb7d` |
| `pre-activation.v1.json`                            | `98fad4a3292bf2f0e1d62e8967f04b165f5464e62590d164d80659c26239c706` |
| `post-activation.v1.json`                           | `e1bf901b7e34177acff0884bd2138cb28359b69b40adc9d3504fe27a7cfb91b3` |
| `project-identity.v1.json`                          | `d6b38244bdc714f3aa68efbb96ddd36115e13410e8c2d9e8c14677e512f1a634` |
| `phase-contract.json` (18 phases)                   | `19577027ceab91fef3ac510e6dd92d63772931767980fc07924ad462ef5b673d` |
| handoff checksum manifest (115 entries)             | `d97b2601b6bfe320a4c2beb254f39c6dbad116d86112fe42acc7343087b5818c` |

### Phase SQL

| Phase                                | SHA-256                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| prepare                              | `87592e2e3d87155884ad16d431f5a99771f6099a10a4faeab3a26612cf817b4c` |
| scheduler-infrastructure-preparation | `380c12f533caf6af75abae33b2f7c0a15b0dca8e1721bc45cd4b051335d8df01` |
| vault-verification                   | `cfd79e63558f668269148e88abd49a22d7be5122d1ae34414546fb41b17f878b` |
| install-jobs-disabled                | `733ed8603607ef7be0c5d54fdfe88d564c3df61e11c2733c692122b19bb90713` |
| auth-endpoint-verify                 | `e87a224c33235203fe3cf43ebe0a91fa7eba5324bdc315afab8924aa80258e55` |
| auth-failure-request                 | `ff9f5fae3852514f707e23f7e371e10f116eeda4e277aa2813025b94009b603f` |
| auth-failure-reconcile               | `f0ddc8d05101b714d4d6e65dfb6492b348958449c7672151d2eb4fdee9c3b020` |
| auth-noop-request                    | `25cd5df3aa260b81fec0d80cd7d425151ca6d0cb6776d6f5bf2ab01aa6042b1c` |
| auth-noop-reconcile                  | `7f033516ed8fbb0fb1e33d74eef3b4412d27f198dd08d5a7ff470102681680da` |
| runtime-deployment-verify            | `9a744d361d9812a91636d92b7cf1c4ae362d0175c09597523937f558f774d57f` |
| baseline-freeze                      | `5ec0f72caeac1b4ff66dc3876d0a2e0c838c7ab290be8d7a10e51efbb459e111` |
| arm                                  | `289f55a7c4c5cd4ddb941ce86874a59ae9517fdfdd77a4684c3fcf69f4faec85` |
| drain-reconcile                      | `74a7ad9ed88e17e4e2fae20f82d2d1d209fad9e52d53a241867a97968f75abdc` |
| manual-finalize                      | `92b0cf37028d26e441afd4d5dcb9f41ccbff58c2b94204a4fa0bd08d4a5d2fea` |
| orderly-stop                         | `66f98a1645e163e945037ffc6f94e71da1c2412479e46fa37dd79e075ac8e7b7` |
| unschedule-terminal-jobs             | `adb2645b7d667641bbfeddc70c5a5455cc051564ef4dcafc302d051d723d6d2e` |
| emergency-kill                       | `e395906040ea74cbf23c44a6162851b98c9df974cb5ce2bc3e6129167505e5ea` |
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
| `vitest run`                                 |           0 | 87 files, 633 tests passed                      |
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
rehearsals were not run because Docker is unavailable. They remain mandatory
exact-head CI gates. CI run IDs, exact pgTAP assertion count, both restore
results, Preview deployment ID, and final handoff SHA are recorded after the
final push; until they are green this report remains NO-GO.

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

## Current conclusion before exact-head CI

NO-GO — BLOCKER REMAINS
