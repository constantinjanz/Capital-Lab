# PR #21 third activation-readiness remediation report

Date: 2026-08-11

Repository: `constantinjanz/Capital-Lab`

Branch: `codex/activation-readiness-follow-up`

Draft PR: `#21` (must remain Draft and unmerged)

Verified starting SHA: `e705f67db819be13c99f759e07186c63f114b831`

Implementation SHA: `e436ea7565707ac671c906fe54b6e79aa3d3bf46`

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
| `20260809150000_post_build_hosting_safety.sql`      | `3eed555ddd7249e49e21295bfd3cb6e3346d6d3b43b9cef4c85ef9dc2413463a` |
| `20260809150417_activation_readiness_follow_up.sql` | `eae2977846147a5d668b7c5d600bd5c4e2f96f18ca4fff6e19cf253d753b9651` |
| `pre-activation.v1.json`                            | `d947784b51612197daf8e01679bcf7114b9364bede15e7f2e0b76b4706fba153` |
| `post-activation.v1.json`                           | `0df64474a0d545f0bbe44e3db2237ccc991a0cbc2e893430540304e8407423cc` |
| `project-identity.v1.json`                          | `d6b38244bdc714f3aa68efbb96ddd36115e13410e8c2d9e8c14677e512f1a634` |
| `phase-contract.json` (18 phases)                   | `bd1bd6a9192ca4fd3aba734e9c1d991e430609f0e9b6f6153ff9e970d23436d5` |
| handoff checksum manifest (113 entries)             | `fd041b546b9fea3fc21860192cc6e75658bdce7f19ef5a11be0f4c1a44d2fd09` |

### Phase SQL

| Phase                                | SHA-256                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| prepare                              | `291ad466b037ff98e5227ea2bff11daf7ca002ccc3bde81fc7845147e9bf2d54` |
| scheduler-infrastructure-preparation | `6575394a2177e40617e2cb64a99b6e3898eaad23bdd46cead3f310e2d9fa30c4` |
| vault-verification                   | `05e200ca47bab99609039a95901c8efbb52a8dcd083a66ec145b436333782429` |
| install-jobs-disabled                | `9d2616f588aaa38ce15b2e56861f5a6f54a2da3f536b53adc2103b62eab2b786` |
| auth-endpoint-verify                 | `e87a224c33235203fe3cf43ebe0a91fa7eba5324bdc315afab8924aa80258e55` |
| auth-failure-request                 | `0121b6a2024f953e3721eb7ee89c9e523b0cf3ef13b9532c471c4c0e489f4fcd` |
| auth-failure-reconcile               | `b3db0b6549d8d1398fa56a0e1fa794e064a83c25c0d402c3a432d895d419b6fd` |
| auth-noop-request                    | `f8d5caf254eb6485f3be4ae43b042501434a0e3264a952dac09af1e89a97c874` |
| auth-noop-reconcile                  | `fbdf3b662a58b50cb4c19fa62591c2c62b24709cf7f5f687ec6a9ece5a8403e8` |
| runtime-deployment-verify            | `9a744d361d9812a91636d92b7cf1c4ae362d0175c09597523937f558f774d57f` |
| baseline-freeze                      | `f04829ac8aad48ecbf0d631862815558425790512a3673c1f499404d97554309` |
| arm                                  | `5c8f77c39778e287033103d2b1cc5f86cd73c156464753d6269a1d13b5ca3ed5` |
| drain-reconcile                      | `64847fba0b6341ebec4cb0cf8b56ae78ccef717411210a061e9fa649daf0267c` |
| manual-finalize                      | `34251b228128af43ef25aba45f08dc1359b32bf0a9496709951c25e09030093d` |
| orderly-stop                         | `5a9c06b84dac412775f0a36fc029d6e7e2b39dcf5825915059084b0e7dd8e1d1` |
| unschedule-terminal-jobs             | `6cdd3c088941706f284de3cbf0f6b673b344667ae4e6da5ec79da37332201c3f` |
| emergency-kill                       | `5d88eee2a81f5ad69c9e5a963fbee710f1be6c07833fe8c76b53cbf3b8a74759` |
| emergency-disable-jobs               | `32b50017555a6acfb2ee6be71486fc73e038e3a685bafbde64cc9eb87c6ddac3` |

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
| `vitest run`                                 |           0 | 86 files, 631 tests passed                      |
| `node scripts/check-paper-only.mjs`          |           0 | PAPER-only scanner passed                       |
| `node scripts/check-credential-patterns.mjs` |           0 | worktree + 100 commits, zero redacted findings  |
| `next build`                                 |           0 | Next.js 16.3 production build passed on Node 24 |
| `playwright test --fail-on-flaky-tests`      |           0 | 4/4 Chromium mock-only flows passed             |
| `supabase@2.113.0 --version`                 |           0 | exact version `2.113.0`                         |
| `activation-phase-contract.mjs --verify`     |           0 | 18 phases, exact contract hash                  |
| `generate-backup-contracts.mjs --verify`     |           0 | 82 pre / 105 post relations                     |
| `handoff-checksums.mjs --verify`             |           0 | 113 exact entries, exact manifest hash          |
| `git diff --check`                           |           0 | no whitespace errors                            |
| `docker version`                             | unavailable | executable absent; no local DB gate claimed     |

The local seed-free pre/post restore, Supabase start/reset/pgTAP, and rollback
rehearsals were not run because Docker is unavailable. They remain mandatory
exact-head CI gates. CI run IDs, exact pgTAP assertion count, both restore
results, Preview deployment ID, and final handoff SHA are recorded after the
final push; until they are green this report remains NO-GO.

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
