# PR #21 activation-readiness hardening report

Date: 2026-08-10

Repository: `constantinjanz/Capital-Lab`

Branch: `codex/activation-readiness-follow-up`

Draft PR: `#21`

Derived starting SHA: `f23c8e4a98338e2546497d53ab77238f51c09691`

End SHA: the exact Draft-PR HEAD identified in the final handoff and CI evidence;
embedding a commit's own SHA in that commit is self-referential.

## Authorization and non-execution

This work changed repository artifacts only. It did not apply a Hosted or
Production migration, run `supabase db push`, create/promote a Production
deployment, alter Production environment variables, install/change/delete a
Hosted extension, Vault value, or Cron job, send a scheduler HTTP request,
invoke OpenAI, inspect/configure an OpenAI key, call a market/news provider,
execute a Canary, connect a broker, or create a real order/fill/ledger entry.
PR #21 remains draft, unmerged, and not marked ready for review.

Read-only preflight derived the branch, remote, Git HEAD, PR head, and complete
working tree independently. Twenty-one unrelated modified files observed in the
shared working tree were
preserved and excluded from this change. Hosted migration history ended before
both PR migrations; `20260809150000` and `20260809150417` were absent. The
linked project had no `pg_cron` or `pg_net`, no activation tables/jobs, no
planned Vault names, zero Vault rows, and no enabled scheduler/agent controls.
The platform-provided Vault extension itself was present. Vercel observations
found only Preview deployments (`target=null`), no live Production project, and
tracked `vercel.json` disables deployment from `main`; the connector did not
provide a complete Production environment-variable listing, so scope parity is
still a manual gate.

## Official source baseline reviewed before changes

- Supabase Database Migrations and migration-history guidance:
  <https://supabase.com/docs/guides/deployment/database-migrations>
- Supabase CLI Backup/Restore, including roles → schema → replica-mode data and
  separately preserved migration history:
  <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>
- Supabase Cron and the current pg_cron troubleshooting guidance restricting
  changes to `cron.schedule`, `cron.alter_job`, and `cron.unschedule`:
  <https://supabase.com/docs/guides/cron> and
  <https://supabase.com/docs/guides/troubleshooting/pgcron-debugging-guide-n1KTaz>
- Supabase pg_net, Vault, RLS, and database-function security guidance:
  <https://supabase.com/docs/guides/database/extensions/pg_net>,
  <https://supabase.com/docs/guides/database/vault>,
  <https://supabase.com/docs/guides/database/postgres/row-level-security>, and
  <https://supabase.com/docs/guides/database/functions>
- Current breaking-change feed, including the prohibition on direct
  `cron.job` inserts/updates and managed-schema restrictions:
  <https://supabase.com/changelog?types=breaking-change>

## Finding disposition

| Finding                                            | Root cause                                                                       | Remediation                                                                                                                                                                                              | Evidence                                                                                      | Residual risk                                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Cron identity trusted names                        | v1 stop/install paths could adopt same-name jobs                                 | Persist versioned schedule-returned IDs and full name/schedule/command/database/username/active hash; compare before every mutation; use only `cron.schedule`, `cron.alter_job`, `cron.unschedule` by ID | pgTAP covers command, schedule, database, username, wrong ID, collision, extra job, and retry | Hosted install/arm remains manual and unauthorized                                                 |
| Bearer could target arbitrary HTTPS                | regex URL check and any 2xx were treated as evidence                             | Canonical parsed Production origin/path with no port/userinfo/query/fragment; exact Deployment/commit/environment; strict 401 and auth-noop response schemas; persistent sanitized evidence              | Route tests and pgTAP fixture reconciliation                                                  | No real Hosted request was sent by design                                                          |
| Emergency stop depended on downstream systems      | Vercel/Cron/audit work shared the stop path                                      | Phase 1 commits all nine settings false, pauses experiment controls, and stops the campaign without Cron/Vercel/audit; later ID-reverified disable/audit/unschedule phases are retryable                 | Idempotent kill plus post-commit Cron-drift and audit-write fault injection                   | Operator still must verify the later phases during a future authorized run                         |
| Caller asserted commit/target                      | runner accepted supplied hashes and substring project checks                     | Derive Git root/HEAD/clean tree; exact canonical manifest/phase checksums; structural TLS URL/host/user/db/port/mode parsing; server fingerprint on every phase; `shell:false`, `psql -X`, timeouts      | runner unit tests, TypeScript, activation artifact tests                                      | Pooler/direct fingerprints must be separately frozen; no silent switch                             |
| pg_net evidence could expire                       | reconciler read ephemeral response rows only when work was due                   | Every tick first persists allowlisted response fields, validates complete JSON identity/counters, refreshes full snapshots, and marks missing evidence inconclusive                                      | 104 local pg_net responses are parsed, copied, then expired before durable-evidence finalize  | No real Hosted transport request was sent by design                                                |
| Finalization could strand offline owner            | manual timing conflicted with final response drain                               | Server-time schedule, last-submit + 120s + 180s drain, 300s post-stop gate, automatic reconciler finalizer, exact 52/104 requirements, terminal evidence before unschedule                               | deterministic pgTAP 52/104 auto-finalize path                                                 | Production time/market-calendar evidence remains a later gate                                      |
| Backup omitted critical/evidence state             | exporter and verifier had independent partial lists                              | One canonical v2 relation contract drives full-row hashes, column signatures, counts, sorting, exporter manifest, and restore verification; roles/schema/data share one URL/fingerprint                  | unit tamper tests; CI seed-free restore gate                                                  | No Production export/restore was authorized                                                        |
| Excess privilege and mutable evidence              | broad service grants and row-only guards                                         | No `GRANT ALL`; forced RLS; private transitions not service-executable; narrow public wrappers; actor matrix; composite owner FKs; UPDATE/DELETE/TRUNCATE guards including Canary/audit/evidence         | pgTAP privileges, fixed search paths, composite FK and mutation tests                         | Database owner necessarily retains DDL authority                                                   |
| Count-only baselines missed compensating mutations | a few counters represented side effects                                          | Full owner-row canonical hashes, column/state watermarks, cash/order/fill/position totals, fresh control/storage snapshots, retry equality                                                               | relation-contract and pgTAP baseline tests                                                    | Hashing cost must be observed before any authorized activation                                     |
| Credentials/actions/Canary/health were weak        | narrow current-tree scan, moving action tags, parent env flags, ambiguous health | Redacted broader current/history scan, bounded history, immutable Action SHAs with release comments, child-only Canary env, exact disabled/mock health booleans                                          | scanner/unit/health tests and CI                                                              | Local ignored `.env.local` is intentionally not printed and prevents a local credential-gate claim |

## Complete changed-file list

```text
.github/workflows/ci.yml
.gitignore
.prettierignore
docs/BACKUP_AND_RESTORE.md
docs/post-build/activation-readiness-follow-up.md
docs/post-build/hosting-safety-audit.md
package.json
scripts/activation-artifacts.test.ts
scripts/check-credential-patterns.mjs
scripts/critical-backup-contract.mjs
scripts/critical-backup-contract.test.ts
scripts/export-critical-tables.mjs
scripts/run-activation-phase.mjs
scripts/run-activation-phase.test.ts
scripts/run-openai-paid-canary-child.mjs
scripts/verify-backup-restore.mjs
src/app/api/health/route.test.ts
src/app/api/health/route.ts
src/app/api/internal/scheduler/route.test.ts
src/app/api/internal/scheduler/route.ts
src/lib/supabase/scheduler-runtime-repository.ts
supabase/activation/disable-hosted-scheduler.sql
supabase/activation/drain-reconcile.sql
supabase/activation/emergency-disable-jobs.sql
supabase/activation/emergency-kill.sql
supabase/activation/enable-hosted-scheduler.sql
supabase/activation/finalize-no-ai-dry-run.sql
supabase/activation/install-hosted-scheduler-jobs-disabled.sql
supabase/activation/phase-contract.json
supabase/activation/plan-and-freeze-no-ai-dry-run.sql
supabase/activation/prepare-no-ai-dry-run.sql
supabase/activation/prepare-scheduler-infrastructure.sql
supabase/activation/request-scheduler-auth-failures.sql
supabase/activation/request-scheduler-auth-noop.sql
supabase/activation/unschedule-terminal-jobs.sql
supabase/activation/verify-scheduler-auth-failures.sql
supabase/activation/verify-scheduler-auth-noop.sql
supabase/activation/verify-scheduler-vault.sql
supabase/backup/critical-relations.v2.json
supabase/backup/critical-restore-evidence.sql
supabase/backup/seed-free-target-prelude.sql
supabase/migrations/20260809150417_activation_readiness_follow_up.sql
supabase/tests/0001_database_contract.sql
supabase/tests/activation_readiness_follow_up_test.sql
supabase/tests/post_build_hosting_safety_test.sql
tasks/todo.md
```

## Checksums from final candidate bytes

| Artifact                                            | SHA-256                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `20260809150417_activation_readiness_follow_up.sql` | `98705c6fd920ed49fd061fb0136032cbda42214be4df269f56a8456312c6c7bb` |
| `phase-contract.json`                               | `d795b4b100f932479e183316e82710bb5bc25693fee49163f6d1fc019bcb07f8` |
| `critical-relations.v2.json`                        | `ce65298a8b8e93954ca787b610bcedc988f04ce7645ba971395227aff6ba306d` |
| `run-activation-phase.mjs`                          | `90d943f61a22e18236912d635438f25490e21838a6a9ff862c654d3251c25b0d` |
| `check-credential-patterns.mjs`                     | `6541199b6bb8d545a5bc46f13ea0d92c6d9fdb0f3363e3f67ebfe5ba8a018a00` |
| `critical-backup-contract.mjs`                      | `2369370c62cc59b0fe024386ece966281071d27ab156f148b22024adbe389f01` |
| `export-critical-tables.mjs`                        | `8d708a56c76810e4c0b88ecdba63111866bb0b9600f2b80e81d573a950ebf48c` |
| `verify-backup-restore.mjs`                         | `a939b4af14d228c77da30b4c1d34894a93be31986e5b5c9e5ba26085b581dd79` |
| `prepare-seed-free-local-restore-target.mjs`        | `2aca63e34fcf1c28a5d6e10ed89641bbd6f6be4a0194b6bef130810760f5b2a2` |
| `seed-free-target-prelude.sql`                      | `d97bdd1ec58586944bbc0e556dd72113dfee4391eededa46aae1b5ff8009e353` |

The canonical phase contract additionally binds every phase file:

| Phase file                                   | SHA-256                                                            |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `enable-hosted-scheduler.sql`                | `6cbbb8eab716ee5e6fbc7702d17982847de0a6d61817b652170c542b08f0506b` |
| `verify-scheduler-auth-failures.sql`         | `7129e5a10baf51622b917e497039a030570fb1641b17f9e520f818a617f03db5` |
| `request-scheduler-auth-failures.sql`        | `fd1417acc208e536c20dd29568975fe25a2b4c502461e1e7033111c2d3c44cf4` |
| `verify-scheduler-auth-noop.sql`             | `c462504bb5a59ab72c849db60ddddd8514e5f3c84024f1101dfec0daf861c2f9` |
| `request-scheduler-auth-noop.sql`            | `a813eb81d1536c99ec5ccf7cd69ca5b57ec11c3eb4cb624afcc57eef4459fdfd` |
| `plan-and-freeze-no-ai-dry-run.sql`          | `f467a4cecac6af4eeddcd255bdc28e31c198ecd43b01ee636f18ce920e128dc2` |
| `drain-reconcile.sql`                        | `b4f799909161cd3cd05d0b5876255c39178446568097bc547e7c2ab33a1d4a80` |
| `emergency-disable-jobs.sql`                 | `ed20ca43bee72dcb8bd7f20288c0b023404f0142a74a42554741a8e8a0d128a1` |
| `emergency-kill.sql`                         | `5aa4b1b775322cdc5641c944830774c1e2c92cf764019adfbbef1ecc5037df34` |
| `install-hosted-scheduler-jobs-disabled.sql` | `27226009f6b4845013732f9c2971a7c28c764e596b83a2ed8538fa3aaeef5588` |
| `finalize-no-ai-dry-run.sql`                 | `2c62c980c063cbc20c5bd5007452d89c000f544aaab89464ef017344d7f5453a` |
| `disable-hosted-scheduler.sql`               | `1a88c394e14349084ce2d4274b43643c78bbeec3f2db3a3bacb2bdcd4a7408c4` |
| `prepare-no-ai-dry-run.sql`                  | `64b6089eac37c7ccb7f55a5c4cd9c1f8d3597116d23a6af338858b0ef3c91925` |
| `prepare-scheduler-infrastructure.sql`       | `d4610aa204f91eb64538535a6a79f7262e8f099f1d8c71f4d757f9ba5e0f0514` |
| `unschedule-terminal-jobs.sql`               | `f771bfe937d9729d14ff4860cd65952a993e2c022a84e845bb680d184ed613d7` |
| `verify-scheduler-vault.sql`                 | `41c5ef2edb010fee881d9535464aaf23bbacd4c76e8f2499270583055e627af1` |

## Verification ledger

| Command/evidence                                                         |        Exit | Result                                                                                                                 | Status                                                                                                                                |
| ------------------------------------------------------------------------ | ----------: | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| direct `tsc --noEmit`                                                    |           0 | strict                                                                                                                 | locally verified                                                                                                                      |
| direct `eslint . --max-warnings=0`                                       |           0 | zero warnings                                                                                                          | locally verified                                                                                                                      |
| focused security Vitest                                                  |           0 | 5 files / 34 tests                                                                                                     | locally verified                                                                                                                      |
| complete Vitest                                                          |           0 | 79 files / 589 tests                                                                                                   | locally verified                                                                                                                      |
| `node scripts/check-paper-only.mjs`                                      |           0 | PAPER-only scan passed                                                                                                 | locally verified                                                                                                                      |
| `git diff --check`                                                       |           0 | no whitespace errors                                                                                                   | locally verified                                                                                                                      |
| local credentials                                                        | not claimed | ignored `.env.local` contains redacted credential categories                                                           | expected local owner gate; values never emitted                                                                                       |
| local Supabase/pgTAP                                                     | unavailable | Docker, Supabase CLI, and psql absent                                                                                  | exact clean CI required                                                                                                               |
| local seed-free export/restore                                           | unavailable | Docker/psql absent                                                                                                     | exact clean CI required                                                                                                               |
| exact-head application CI, run `31341237570`                             |           0 | format, lint, typecheck, 589 tests, safety, credentials, build                                                         | verified on `1a97c215...`                                                                                                             |
| exact-head browser CI, run `31341237570`                                 |           0 | Playwright critical flows                                                                                              | verified on `1a97c215...`                                                                                                             |
| exact-head database CI, run `31341237570`                                |           1 | first migration compile exposed non-idempotent trigger drop                                                            | fixed with `DROP TRIGGER IF EXISTS`; rerun required                                                                                   |
| exact-head application CI, run `31341396633`                             |           1 | report formatting only                                                                                                 | formatted; rerun required                                                                                                             |
| exact-head browser CI, run `31341396633`                                 |           0 | Playwright critical flows                                                                                              | verified on `6113a000...`                                                                                                             |
| exact-head database CI, run `31341396633`                                |           1 | second compile exposed PostgreSQL parameter-name replacement                                                           | retained the installed signature names; rerun required                                                                                |
| exact-head application CI, run `31341545900`                             |           0 | complete application gate                                                                                              | verified on `7819a6c1...`                                                                                                             |
| exact-head browser CI, run `31341545900`                                 |           0 | Playwright critical flows                                                                                              | verified on `7819a6c1...`                                                                                                             |
| exact-head Supabase start/reset, run `31341545900`                       |           0 | full migration compile and deterministic reset                                                                         | verified on `7819a6c1...`                                                                                                             |
| exact-head pgTAP, run `31341545900`                                      |           1 | 1,332 assertions exposed overbroad private-function revoke and unsupported Cron-owner mutation fixture                 | narrowed to exact activation allowlist and safe API rejection/hash proof; rerun required                                              |
| exact-head application CI, run `31341809083`                             |           0 | complete application gate                                                                                              | verified on `0e1a6da9...`                                                                                                             |
| exact-head browser CI, run `31341809083`                                 |           0 | Playwright critical flows                                                                                              | verified on `0e1a6da9...`                                                                                                             |
| exact-head Supabase start/reset, run `31341809083`                       |           0 | full migration compile and deterministic reset                                                                         | verified on `0e1a6da9...`                                                                                                             |
| exact-head pgTAP, run `31341809083`                                      |           1 | 1,836 assertions: one exposed-wrapper contract mismatch plus 19 activation cascade failures                            | exact wrapper allowlist/fixed search paths, explicit safe-control fixture, scoped writer gate, and SQLSTATE corrected; rerun required |
| exact-head application CI, run `31342073726`                             |           0 | complete application gate                                                                                              | verified on `0e5f4fdc...`                                                                                                             |
| exact-head browser CI, run `31342073726`                                 |           0 | Playwright critical flows                                                                                              | verified on `0e5f4fdc...`                                                                                                             |
| exact-head Supabase start/reset, run `31342073726`                       |           0 | full migration compile and deterministic reset                                                                         | verified on `0e5f4fdc...`                                                                                                             |
| exact-head pgTAP, run `31342073726`                                      |           1 | 1,833/1,836 passed; future planned slot's proposed lease ended before `slot_at` in the accelerated local happy path    | lease now expires after the greater of server time and server-planned slot; rerun required                                            |
| exact-head application CI, run `31342252647`                             |           0 | complete application gate                                                                                              | verified on `2de5a146...`                                                                                                             |
| exact-head browser CI, run `31342252647`                                 |           0 | Playwright critical flows                                                                                              | verified on `2de5a146...`                                                                                                             |
| exact-head Supabase start/reset/pgTAP, run `31342252647`                 |           0 | pinned CLI `2.113.0`; 14 files / 1,836 assertions                                                                      | full deterministic database contract verified on `2de5a146...`                                                                        |
| exact-head seed-free export/restore, run `31342252647`                   |           1 | exporter stopped before dump because post-toolchain Git status was non-clean                                           | path-only redacted diagnosis added without weakening clean-tree rejection; rerun required                                             |
| exact-head application CI, run `31342485611`                             |           0 | complete application gate                                                                                              | verified on `377704ea...`                                                                                                             |
| exact-head Supabase start/reset/pgTAP, run `31342485611`                 |           0 | pinned CLI and all 1,836 assertions                                                                                    | database contract remains green                                                                                                       |
| exact-head seed-free export/restore, run `31342485611`                   |           1 | path-only evidence identified `supabase/.branches/_current_branch` as the sole dirty entry                             | exact generated CLI state root ignored; all other dirt remains blocking                                                               |
| exact-head browser CI, run `31342485611`                                 |           1 | one unchanged Research-import assertion timed out; 3/4 passed                                                          | no retry/timeout weakening; fresh exact-head run required                                                                             |
| exact-head application/browser CI, run `31342645890`                     |           0 | complete application and 4/4 Playwright gates                                                                          | verified on `b8d3700e...`                                                                                                             |
| exact-head Supabase start/reset/pgTAP, run `31342645890`                 |           0 | pinned CLI and all 1,836 assertions                                                                                    | database contract remains green                                                                                                       |
| exact-head seed-free export/restore, run `31342645890`                   |           1 | clean-tree gate passed; first canonical evidence query failed before dumps                                             | literal-/URL-redacted PostgreSQL error classification added; rerun required                                                           |
| exact-head application/browser CI, run `31342850522`                     |           0 | complete application and 4/4 Playwright gates                                                                          | verified on `926af4a9...`                                                                                                             |
| exact-head Supabase start/reset/pgTAP, run `31342850522`                 |           0 | pinned CLI and all 1,836 assertions                                                                                    | database contract remains green                                                                                                       |
| exact-head seed-free export/restore, run `31342850522`                   |           1 | pre-dump `psql` failure used lowercase error formatting and remained unclassified                                      | case-insensitive redacted classification added; rerun required                                                                        |
| exact-head application/browser CI, run `31343009696`                     |           0 | complete application and 4/4 Playwright gates                                                                          | verified on `dbc481ee...`                                                                                                             |
| exact-head Supabase start/reset/pgTAP, run `31343009696`                 |           0 | pinned CLI and all 1,836 assertions                                                                                    | database contract remains green                                                                                                       |
| exact-head seed-free export/restore, run `31343009696`                   |           1 | libpq ignored a connection URI placed only in `PGDATABASE` and fell back to socket port 5432                           | URL now strictly parsed into explicit non-logged libpq fields for exporter and verifier; rerun required                               |
| exact-head browser CI, run `31343249634`                                 |           0 | 4/4 Playwright gates                                                                                                   | verified on `69044778...`                                                                                                             |
| exact-head Supabase start/reset/pgTAP, run `31343249634`                 |           0 | pinned CLI and all 1,836 assertions                                                                                    | database contract remains green                                                                                                       |
| exact-head export, run `31343249634`                                     |           0 | sensitive roles/schema/data dumps and manifest created outside repository in ephemeral runner storage                  | exporter/source evidence path verified; ephemeral runner discarded artifact                                                           |
| exact-head restore contract, run `31343249634`                           |           1 | manifest verifier rejected a safe contract-field mismatch before restoring roles/schema/data                           | safe mismatch categories and exact psql distribution-version validation added                                                         |
| exact-head credential CI, run `31343249634`                              |           1 | synthetic reserved-host URL fixture matched current/history DB-URL rule                                                | only that exact test file plus loopback/reserved host fixtures are internally excluded; real files/history remain blocking            |
| exact-head application/browser/credential CI, run `31343512116`          |           0 | complete application, 4/4 Playwright, current/history credential gate                                                  | verified on `641c78fe...`                                                                                                             |
| exact-head Supabase start/reset/pgTAP/export/manifest, run `31343512116` |           0 | pinned CLI, 1,836 assertions, sensitive external export, strict manifest validation                                    | source/export/manifest chain verified                                                                                                 |
| exact-head seed-free target preflight, run `31343512116`                 |           1 | first target `psql` preflight failed before roles/schema/data restore                                                  | shared literal-/URL-redacted PostgreSQL diagnostic added; rerun required                                                              |
| exact-head application/browser/credential CI, run `31343752298`          |           0 | complete application, 4/4 Playwright, current/history credential gate                                                  | verified on `94c530ef...`                                                                                                             |
| exact-head Supabase start/reset/pgTAP/export/manifest, run `31343752298` |           0 | pinned CLI, 1,836 assertions, sensitive external export, strict manifest validation                                    | source/export/manifest chain remains green                                                                                            |
| exact-head seed-free target preflight, run `31343752298`                 |           1 | `system_identifier` was not aggregated beside the empty-target relation count                                          | server identifier now uses `max()` in the same preflight aggregate; rerun required                                                    |
| exact-head application/browser/credential CI, run `31343987544`          |           0 | complete application, 4/4 Playwright, current/history credential gate                                                  | verified on `bf29934f...`                                                                                                             |
| exact-head Supabase start/reset/pgTAP/export/manifest, run `31343987544` |           0 | pinned CLI, 1,836 assertions, sensitive external export, strict manifest validation                                    | source/export/manifest chain remains green                                                                                            |
| exact-head seed-free role phase, run `31343987544`                       |           1 | replaying cluster-global role settings into a second database on the same server required unavailable superuser rights | same-server restores now fingerprint the password-free global role policy instead of mutating the source cluster; rerun required      |
| exact-head application/browser/credential CI, run `31344323501`          |           0 | complete application, 4/4 Playwright, current/history credential gate                                                  | verified on `f7c8e963...`                                                                                                             |
| exact-head Supabase start/reset/pgTAP/export/manifest, run `31344323501` |           0 | pinned CLI, 1,836 assertions, role/server fingerprint and target preflight                                             | source/export/role/preflight chain verified                                                                                           |
| exact-head seed-free schema phase, run `31344323501`                     |           1 | an empty `template0` target lacked the managed `extensions` schema intentionally excluded by Supabase CLI dumps        | tracked data-free target Prelude is now manifest-checksummed and creates only that empty schema; rerun required                       |
| exact-head application/browser/credential CI, run `31344675766`          |           0 | format, lint, typecheck, 79 files / 594 tests, safety, credentials, build, 4/4 Playwright                              | verified on `36d47ed5...`                                                                                                             |
| exact-head Supabase reset / extended pgTAP, run `31344675766`            |           1 | local response fixture used the operation UUID where the frozen request UUID was required                              | exact claimed request identity corrected; restore step was not reached; rerun required                                                |
| exact-head application/credential CI, run `31344881015`                  |           0 | format, lint, typecheck, 79 files / 594 tests, safety, credentials, build                                              | verified on `0a3d9277...`                                                                                                             |
| exact-head browser CI, run `31344881015`                                 |           1 | unchanged Research-import assertion did not observe `Preview valid`; 3/4 passed                                        | no retry, timeout, or assertion weakening; fresh exact-head green run required                                                        |
| exact-head Supabase reset / extended pgTAP, run `31344881015`            |           0 | pinned CLI, all 14 pgTAP files / 1,851 assertions                                                                      | full durable-response, 52/104, drift, privilege, and emergency-fault path green                                                       |
| exact-head seed-free schema phase, run `31344881015`                     |           1 | `template0` target passed export, manifest, role-policy, and preflight, then lacked the empty `vault` namespace        | checksummed Prelude now creates only empty `extensions` and `vault` namespaces; no extension, table, role, migration, or row          |
| exact-head application CI, run `31345275407`                             |           0 | format, lint, typecheck, 79 files / 594 tests, safety, credentials, build                                              | verified on `d6d682bd...`                                                                                                             |
| exact-head browser CI, run `31345275407`                                 |           1 | Research-import again did not expose `Preview valid`; 3/4 passed                                                       | repeated failure is under root-cause investigation; no assertion or timeout weakened                                                  |
| exact-head Supabase reset / extended pgTAP, run `31345275407`            |           0 | pinned CLI, all 14 pgTAP files / 1,851 assertions                                                                      | database contract remained green                                                                                                      |
| exact-head seed-free schema phase, run `31345275407`                     |           1 | `template0` advanced through `extensions`/`vault`, then lacked managed `auth`                                          | target construction now clones a real seed-free local Supabase platform baseline; validation Prelude no longer synthesizes namespaces |
| exact-head application/browser CI, run `31345678279`                     |           0 | complete application gate and 4/4 Playwright                                                                           | verified on `9af64397...`                                                                                                             |
| exact-head Supabase reset / extended pgTAP, run `31345678279`            |           0 | pinned CLI, all 14 pgTAP files / 1,851 assertions                                                                      | database contract remained green with OID-bound fingerprint                                                                           |
| exact-head local target preparation, run `31345678279`                   |           1 | target builder failed closed with intentionally generic output                                                         | fixed, non-sensitive phase labels added; no stderr, URL, SQL value, or credential will be emitted                                     |
| exact-head application/browser CI, run `31345975029`                     |           0 | complete application gate and 4/4 Playwright                                                                           | verified on `2f805bdd...`                                                                                                             |
| exact-head Supabase reset / extended pgTAP, run `31345975029`            |           0 | pinned CLI, all 14 pgTAP files / 1,851 assertions                                                                      | database contract remained green                                                                                                      |
| exact-head local target preparation, run `31345975029`                   |           1 | `source_drain` was denied for one or more Supabase service backends                                                    | physical clone removed; logical seed-free platform dump/restore requires no backend termination                                       |
| exact-head application/browser CI, run `31346276617`                     |           0 | complete application gate and 4/4 Playwright                                                                           | verified on `0e4edb2e...`                                                                                                             |
| exact-head Supabase startup, run `31346276617`                           |           1 | runner-local port `54322` was already bound before the database container started                                      | infrastructure failure before reset/migration/test; no gate was retried or weakened                                                   |

## Manual gates and stop conditions

- Independent second review of SQL, runner, response contract, backup contract,
  and CI evidence.
- Exact Draft-PR-head green application, browser, database, pgTAP, and seed-free
  restore jobs with no skipped/flaky security test.
- Production environment-name/scope review without values, exact Production
  deployment identity, consumer scope parity, and auto-deploy impact review.
- Separate authorization for any migration apply, extension/Vault/job change,
  Production deployment, scheduler request, arm, provider/OpenAI/Canary action,
  or trading-affecting operation.
- Immediate NO-GO on Hosted drift, migration-history ambiguity, checksum/HEAD/
  target mismatch, unexpected Capital-Lab job, missing transport evidence,
  nonzero side-effect evidence, or any dangerous control not explicitly false.

All dangerous controls remain false in Hosted observations: scheduler, agent,
autonomous paper execution, paid models, Canary, web search, Sol challenger, Sol
execution, and real broker. Data mode remains mock/paper-only.

## Current status

**NO-GO — REMEDIATION INCOMPLETE**

This candidate cannot advance until the exact committed migration compiles,
the pgTAP suite and seed-free disposable restore pass in ephemeral CI, every
exact-commit check is green, checksums are reverified after commit, and the
Draft PR head is reconciled. Even a later positive result may be no stronger
than `READY FOR SECOND INDEPENDENT REVIEW` and never authorizes merge, migration
apply, Production deployment, or activation.
