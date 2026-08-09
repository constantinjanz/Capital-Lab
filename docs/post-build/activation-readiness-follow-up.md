# Capital Lab activation-readiness follow-up

- Date: 2026-08-09
- Scope: code, schema, scripts, tests, and evidence preparation only
- Audit input: [`hosting-safety-audit.md`](./hosting-safety-audit.md)

Verdict: **GO FOR MIGRATION REVIEW**. This authorizes review only and is not authorization to apply a migration or activate anything.

## Immutable scope and credential handling

- `key_rotation_completed=owner_attested`.
- `server_consumer_scope_sync=pending`.
- The rotation attestation does not prove that intended server-side Production consumers use the new credential generation or that obsolete Preview/Development consumers were removed or replaced.
- No old or new credential value was requested, read, compared, logged, hashed, or written. A later Owner gate may confirm environment-variable names and Production scopes, never values.
- No hosted secret, Vault entry, Cron job, extension, Vercel environment, Production deployment, model configuration, provider, research corpus, order, fill, or ledger row was changed by this follow-up.
- The redacted repository scanner reports only file path, rule ID, and finding class. Current result: zero findings.

## Starting point and Git evidence

| Evidence                    | Value                                                                                       | Classification  |
| --------------------------- | ------------------------------------------------------------------------------------------- | --------------- |
| Merged audit base           | `70ed610d5e0e5c08bf523d0d160a7b76f5fe2e51`                                                  | `code_verified` |
| Audit branch tip            | `a3bf18439d2bcdcf512976ff55a4879d88f3abbd`                                                  | `code_verified` |
| Shared audit tree           | `ca969f8887b36200ece84c65221881ee8fa465f2`                                                  | `code_verified` |
| Follow-up branch            | `codex/activation-readiness-follow-up`                                                      | `code_verified` |
| Verified implementation SHA | `88295e0fe1b51c5bcea4a17ac4129911a72ba51d`                                                  | `code_verified` |
| Exact-head PR CI            | [run `31324382247`](https://github.com/constantinjanz/Capital-Lab/actions/runs/31324382247) | `code_verified` |
| Draft PR                    | [PR #21](https://github.com/constantinjanz/Capital-Lab/pull/21), open and unmerged          | `code_verified` |

The audit tip, merged base, and `origin/main` have the same tree. The verified implementation SHA is the exact code checkpoint covered by the evidence below. A later report-only commit necessarily changes the PR head and cannot self-embed its own SHA; the authoritative final report-head SHA is therefore the exact PR head shown by GitHub and repeated in the handoff. Unrelated user working-tree changes were preserved and are excluded from this follow-up's staged-file allowlist. No reset, broad checkout, or `git add -A` is permitted.

## Prior audit claim register

Every inherited audit claim is interpreted under one of the required evidence classes:

| Claim group                                                                                                                                                                                                         | Classification        | Current interpretation                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------- |
| Repository boundaries, PAPER-only scan, fail-closed application flags, migration contents, activation scripts, backup scripts, Canary code                                                                          | `code_verified`       | Verified source behavior, not Hosted activation evidence                                             |
| Exact protected Preview deployment, Preview health, authenticated Preview pages, Preview browser/runtime logs                                                                                                       | `preview_verified`    | Applies only to the cited Preview deployment, never to Production                                    |
| Prior combined migration/pgTAP execution inside a transaction ending in rollback                                                                                                                                    | `rollback_rehearsed`  | Proves compilation/assertions against the then-current Hosted schema; no schema or fixture persisted |
| Hosted migration list, absent post-build migrations, absent `pg_cron`/`pg_net`, disabled persisted controls, zero agent/AI/order/fill activity at inspection time                                                   | `production_verified` | Narrow Hosted database observation only; not a Production application or activation pass             |
| Owner statement that the disclosed server credential was rotated                                                                                                                                                    | `owner_attested`      | Recorded without credential inspection                                                               |
| Server-consumer names/scopes, Vercel Production deployment, Production environment, backup restore, Production migration, extensions, Vault, jobs, authorized no-op, baseline, dry run, OpenAI access/credit/Canary | `pending`             | Requires later manual evidence; none is inferred                                                     |

Prepared RLS, explicit grants, price rows, backup tooling, extension scripts, job scripts, state-machine functions, and dry-run tables are classified `prepared` or `rollback_rehearsed` until separately applied and verified. They are not Production passes.

## Findings closed in code

1. Supabase CLI is pinned to exactly `2.113.0` in CI. The version was reconstructed from the setup action used by the last green audit run and confirmed locally with the exact package version. No `latest` or moving CLI reference remains.
2. All CI jobs checkout the exact push/PR-head SHA with depth one and disabled persisted credentials, assert a clean checkout, capture each gate's exit code and applicable test counts as JSON, publish them to the job summary, and retain them as exact-SHA artifacts.
3. Credential-pattern scanning is independent of the PAPER-only scan and emits no matching text, entropy string, fragment, prefix, or credential hash.
4. The app/schema migration contains no extension creation, Vault operation, Cron job, or HTTP request.
5. Extension preparation, Vault name/shape verification, disabled job installation, auth/no-op, planning/baseline, arming, and shutdown are separate versioned scripts. The standard runner verifies target identity and file checksum and invokes `psql` with `ON_ERROR_STOP=1`; SQL Editor copy/paste is fallback-only.
6. Extension preparation uses bare `create extension if not exists pg_cron` and `pg_net`, with no version pins. Cron jobs are managed only through `cron.schedule`, `cron.alter_job`, and `cron.unschedule`; `cron.job` is read-only evidence.
7. New persistence is in the non-exposed `private` schema, forces RLS, grants no client access, and grants only the server role. No new Data API table or client mutation was added.
8. The dedicated stable run class is `no_ai_shadow_infrastructure_dry_run`, with stable ID `6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001`. It is not a `public.experiments` row, cannot count as the three-month research experiment, cannot promote a strategy, and has no research, provider, model, execution, order, fill, or ledger capability.
9. Planning selects exactly two consecutive complete XNAS `regular` sessions available at `decisionAt`. Activation at or after an open skips that session. Weekday calendar gaps fail closed; weekends, recorded holidays, DST timestamps, and early closes are handled from the versioned official calendar.
10. Two complete 6.5-hour sessions preregister 26 15-minute slots each: 52 dispatcher slots plus 52 five-minute reconciler events, for 104 expected events. Planned end is the second regular close plus a fixed 10-minute reconciliation grace period.
11. Expected-vs-actual evidence records Cron trigger count, pg_net request ID, HTTP status/timeout, authenticated route count, claimed cycle count, terminal no-AI reason, and exact zero model/budget/order/fill/ledger counters. No jobs or missing slots is failure, never success.
12. Deduplicated alarms atomically close the database scheduler control, every dangerous persisted flag, every experiment scheduler/agent control, and both expected Cron jobs on forbidden database delta, missing/duplicate slot, auth failure, non-2xx, timeout/possibly-charged result, stale lease, unexpected controls, planned end, or storage/security boundary.
13. The Canary lock uses immutable campaign `openai_postbuild_canary_v1`, exact-model uniqueness, and a campaign advisory transaction lock. One claim creates all three model locks atomically; the operation UUID is correlation evidence only. Claimed, unknown, or possibly charged evidence cannot be bypassed by another UUID.
14. The Canary launcher forces temporary flags only in an isolated child process. The environment disappears on normal exit, error, or interruption. No route, UI, Cron, or Canary execution was added.
15. Backup export now records exact commit, pinned CLI, dump checksum, critical row counts, deterministic content checksums, exact ledger currency totals, and duplicate-ledger-ID evidence. Restore succeeds only if a local/disposable database reproduces all preregistered evidence exactly.

Relevant current platform rules were checked against primary sources: [extension version pinning](https://supabase.com/changelog/extension-version-pinning-ignored), [explicit Data API grants](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically), [pg_net response evidence](https://supabase.com/docs/guides/database/extensions/pg_net), and [Supabase Cron](https://supabase.com/docs/guides/cron).

## Migration and activation checksums

| File                                                                    | SHA-256                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `supabase/migrations/20260809150000_post_build_hosting_safety.sql`      | `ee9a1390a6cf1abfca9a8664d6dfe492bc217741265f2d0d5e8b010af6c0352e` |
| `supabase/migrations/20260809150417_activation_readiness_follow_up.sql` | `3e41522e59e2f319bcf74623747d390095990a6925a168c84b9eecea35b1ad91` |
| `supabase/activation/prepare-no-ai-dry-run.sql`                         | `1a8a921e835a2dee65064773f5ca874804f0ed000ba6fb67cc7bbcbe54314257` |
| `supabase/activation/prepare-scheduler-infrastructure.sql`              | `9af3f8c597fd62b0bf174e3a654927d8df82a8377e442c255ef8dbfaf23a60c0` |
| `supabase/activation/verify-scheduler-vault.sql`                        | `2bb34de5402fc50d35aa76948004d054cacdbd759d386580cd2e447b45478d78` |
| `supabase/activation/install-hosted-scheduler-jobs-disabled.sql`        | `47c1f9ac1e6a37fbf20217b6c7e20f45cf35bcd96d8e5f7b4415f30b76c1ccc1` |
| `supabase/activation/request-scheduler-auth-noop.sql`                   | `8a9cd31d9562e221cfcd43dbd9b857a5a86c03b8e17f9d0dfcd05dcbff5d1d07` |
| `supabase/activation/verify-scheduler-auth-noop.sql`                    | `2233a7d01d0ca15a69e866ac4d82a6911e4a04f1617aa5076e6b7716e0a77753` |
| `supabase/activation/plan-and-freeze-no-ai-dry-run.sql`                 | `78444c0f34666a36b479e171f4f09ed80a67ac10d07cc174ecca7111970bdc0f` |
| `supabase/activation/enable-hosted-scheduler.sql`                       | `942001b4d8b3405bdb8b7915249e4b1e1cbbd7fa4833d2680b7495f0d11ea00b` |
| `supabase/activation/disable-hosted-scheduler.sql`                      | `ebd6551991a9bff58ac6e66b933ba3a97e8e6c3902e593e74f39c2337c3db523` |

Checksums must be regenerated after any file change. The versioned runner refuses a mismatched reviewed checksum.

## State machine

| State                         | Required evidence and allowed next state                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepared`                    | Stable run ID, exact commit/config, all flags false -> `infra_installed`                                                                                                                                |
| `infra_installed`             | `pg_cron` and `pg_net` present without version pins; zero jobs/requests -> `vault_verified`                                                                                                             |
| `vault_verified`              | Exact required Vault names and minimum secret length verified without output; Production consumer scopes separately confirmed -> `jobs_installed_disabled`                                              |
| `jobs_installed_disabled`     | Exactly two expected inactive jobs; Vercel scheduler false; zero requests -> `auth_noop_verified`                                                                                                       |
| `auth_noop_verified`          | One authorized pg_net request, 2xx, route no-op, zero side effects -> `baseline_frozen`                                                                                                                 |
| `baseline_frozen`             | Future two-session plan, 52 slots/104 events, storage and forbidden-effect baselines -> `armed`                                                                                                         |
| `armed`                       | Database control and jobs armed before the future start while Vercel remains false -> `running` only after the last Production kill-switch is enabled and the first preregistered request authenticates |
| `running`                     | Only preregistered no-AI events; any deviation -> `failed`; planned end -> `auto_stopped`                                                                                                               |
| `auto_stopped`                | Database control false and jobs inactive -> `reconciled` after drain and response/lease reconciliation                                                                                                  |
| `reconciled`                  | Exact expected-vs-actual evidence -> `passed`, otherwise `failed`                                                                                                                                       |
| `passed`, `failed`, `aborted` | Immutable archived terminal states; no next state                                                                                                                                                       |

Every transition requires the expected current state, actor, timestamp, commit SHA, config version, correlation ID, and append-only evidence. State skipping is rejected.

## Safe later activation order

1. Externally confirm backup and successful disposable restore evidence.
2. Review and apply only the app/schema migrations, then verify RLS/grants and off-state.
3. Install/verify extensions with the separate infrastructure script; verify zero jobs.
4. Verify an exact Production deployment is READY at the migration-reviewed commit with every dangerous flag false and no OpenAI key.
5. Confirm Vault names and server-consumer environment names/scopes without reading values.
6. Install exactly two jobs inactive while Vercel scheduler remains false.
7. Run one authorized auth/no-op request; verify 2xx and zero side effects.
8. Plan two future complete sessions and freeze 52 slots, 104 events, storage, and forbidden-effect baselines.
9. Arm the database control and jobs while no expected slot is yet due and Vercel scheduler remains false.
10. Enable the Vercel scheduler control as the last kill-switch, verify the new exact Production deployment READY, and allow only the preregistered window to start.

## Safe later stop order

1. Set Vercel scheduler false.
2. Prove a new exact Production deployment READY.
3. Disable the database dry-run control and all dangerous flags.
4. Unschedule only the two exact expected jobs through `cron.unschedule`.
5. Drain at least 300 seconds, covering maximum HTTP and lease duration.
6. Reconcile pg_net responses and open leases.
7. Compare final counts with baseline and all 52 slots/104 expected events.

The automatic end independently disables the database control and both jobs after the second close plus grace, so forgetting the manual stop cannot leave the run unbounded.

## Verification ledger

| Command/evidence                                                           |    Exit |                                   Count | Classification                                                                                    |
| -------------------------------------------------------------------------- | ------: | --------------------------------------: | ------------------------------------------------------------------------------------------------- |
| Exact-head CI `pnpm format:check`                                          |       0 |                          clean checkout | `code_verified`                                                                                   |
| Exact-head CI `pnpm lint`                                                  |       0 |                              0 warnings | `code_verified`                                                                                   |
| Exact-head CI `pnpm typecheck`                                             |       0 |                                  strict | `code_verified`                                                                                   |
| Exact-head CI `pnpm test`                                                  |       0 |         76 files / 571 passed / 0 flaky | `code_verified`                                                                                   |
| Exact-head CI redacted credential-pattern scan                             |       0 |                              0 findings | `code_verified`                                                                                   |
| Exact-head CI PAPER-only scan                                              |       0 |                              0 findings | `code_verified`                                                                                   |
| Exact-head CI `pnpm build`                                                 |       0 |            14 static/dynamic app routes | `code_verified`                                                                                   |
| Exact-head CI `pnpm test:e2e` with fail-on-flaky                           |       0 |                      4 passed / 0 flaky | `code_verified`                                                                                   |
| Exact-head CI Supabase CLI                                                 |       0 |                               `2.113.0` | `code_verified`                                                                                   |
| Exact-head CI `supabase start`                                             |       0 |                       local stack ready | `code_verified`                                                                                   |
| Exact-head CI `supabase db reset`                                          |       0 |                    migrations reapplied | `code_verified`                                                                                   |
| Exact-head CI `supabase test db`                                           |       0 |        14 files / 1692 passed / 0 flaky | `code_verified`                                                                                   |
| Combined audit + follow-up migration Hosted transaction ending in rollback |       0 |                                compiled | `rollback_rehearsed`                                                                              |
| Follow-up pgTAP in the same rollback-only transaction                      |       0 |                           62 assertions | `rollback_rehearsed`                                                                              |
| Post-rollback table and migration-record check                             |       0 |                             both absent | `production_verified` narrow absence check                                                        |
| Local database reset/pgTAP                                                 |       2 |       unavailable: Docker not installed | `pending`; exact-head clean CI supplies the reproducible database gate, not a local-restore claim |
| Local mock browser                                                         |       0 |                      4 passed / 0 flaky | `code_verified`; initial sandbox launch returned `EPERM`, approved Chromium launch passed         |
| Real backup restore                                                        | not run | no disposable Docker/Postgres available | `pending`                                                                                         |
| Production browser/runtime verification                                    | not run |         no Production deployment exists | `pending`                                                                                         |

The authoritative machine-readable evidence is attached to exact-head PR run `31324382247`; every recorded gate has commit SHA `88295e0fe1b51c5bcea4a17ac4129911a72ba51d` and exit code `0`.

## Gate status and exact manual evidence still required

| Gate                           | Status           | Required later evidence                                                                                                                         |
| ------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Key rotation                   | `owner_attested` | Owner attestation already recorded; never request value evidence                                                                                |
| Exact-head clean CI            | `verified`       | PR run `31324382247`: application, browser, database, and exact-SHA evidence all passed                                                         |
| Current dangerous controls     | `verified`       | Repository scan and narrow Hosted database inspection both found zero enabled dangerous controls                                                |
| Server consumer scope sync     | `pending`        | Production server variable names/scopes point to the new generation; obsolete Preview/Development consumers removed/replaced; names/scopes only |
| Follow-up app/schema migration | `prepared`       | Rollback rehearsal passed; review, approved apply, migration-list entry, checksum, RLS/grant postflight remain later                            |
| Extensions                     | `prepared`       | Separate install/verify evidence, no version pins, zero jobs                                                                                    |
| Vault                          | `prepared`       | Required names, scopes, random-secret length gate; no value output                                                                              |
| Jobs                           | `prepared`       | Exactly two expected inactive jobs before arming                                                                                                |
| Production deployment          | `pending`        | Exact deployment ID, URL, commit, `READY`, Production environment names/scopes                                                                  |
| Production off-state           | `pending`        | Every dangerous flag false, no privileged public variable, no OpenAI key, health paper-only/mock/agent-off                                      |
| Scheduler auth/no-op           | `prepared`       | Invalid/missing bearer 401/403 with zero effects; one valid no-op 2xx with request ID and zero effects                                          |
| Runtime logs                   | `pending`        | No credential leak and no warning/error/fatal during gates                                                                                      |
| Backup/restore                 | `pending`        | Tooling is prepared; real local/disposable restore with exact row-count/checksum/ledger match is still required; no dump in Git or CI           |
| No-AI dry run                  | `prepared`       | Later state-machine execution across two complete sessions                                                                                      |
| OpenAI/Canary                  | `prepared`       | Execution remains pending; stays off and unconfigured during no-AI run; any later paid gate requires separate approval                          |

Production apply, extension installation, Vault changes, job creation/activation, Production deployment/promotion, PR merge, model/provider calls, Canary, research import, scheduler/agent activation, and financial side effects remain explicitly unauthorized by this report.

## Verdict

**GO FOR MIGRATION REVIEW**. Code, checksums, exact-head clean-checkout CI, and the unmerged Draft PR are ready for controlled review. Server-consumer scope sync, real disposable restore, Production deployment/off-state/runtime evidence, and every later activation phase remain manual blockers. This verdict does not authorize migration apply, extensions, Production, Vault, jobs, OpenAI, the no-AI dry run, PR merge, or any provider/financial side effect.
