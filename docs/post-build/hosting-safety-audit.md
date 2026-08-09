# Capital Lab post-build hosting and safety audit

Audit date: 2026-08-09 (Europe/Berlin)
Branch: `codex/post-build-hosting-audit`
Scope: post-build hardening and preparation only
Production migration applied: **no**
Scheduler activated: **no**
Paid OpenAI response created: **no**

## Executive verdict

**GO WITH LISTED CONDITIONS** for a later 48-hour no-AI shadow dry run.

The repository is safe to remain deployed in its current disabled state. The prepared dry-run path is not yet authorized to run. Before activation, the owner must rotate the server key disclosed in conversation, review and apply the migration, verify the exact Vercel Production environment scopes, add the URL/secret to Supabase Vault, take and restore-test a backup, and explicitly approve activation. Agent, paid inference, Canary, autonomous paper execution, Sol, web search, and every broker path must remain off.

Status markers:

- `manual_credit_verification_required`
- `paid_canary_not_run`
- `production_migration_not_applied`
- `scheduler_jobs_not_created`
- `notion_not_connected`
- `research_experiment_not_started`

## Architecture before and after

Before this audit, the repository had a Vercel-oriented GET Cron route, a Vercel scheduler provider option, a shorter legacy secret contract, no durable remote Reconciler, no price-verification expiry, older daily/monthly budget defaults, no experiment-wide hard cap, no local paid Canary, and no database-size shutdown control. The durable manual owner cycle and structured shadow agent were already strongly idempotent and paper-only, but remote activation did not have the requested single-authority topology.

After this audit, the only prepared remote topology is:

`Supabase Cron -> pg_net -> POST /api/internal/scheduler -> Production/flag/auth guards -> no-AI slot or Reconciler -> Supabase`

The route is POST-only, uncached, constant-time bearer checked, Preview-no-op, Supabase-provider-only, and bounded by `maxDuration=300`, a 110-second internal abort deadline, and a 120-second future `pg_net` timeout. The repository contains no Vercel Cron configuration. Two Supabase jobs exist only in an unapplied manual activation script. The database contract in this release can record only a skipped no-AI shadow slot or reconcile an expired lease; every returned model/order/fill/ledger counter must be exact zero.

## Findings and disposition

### Critical

1. **Competing/incorrect remote scheduler boundary.** A GET Vercel Cron route conflicted with the required Supabase-only authority and Hobby subdaily constraints. **Fixed:** route removed; `vercel.json` has no Cron jobs; protected POST route and dormant Supabase activation scripts added.
2. **Paid-call activation was not independently gated.** The runtime factory previously centered on the agent flag. **Fixed:** paid calls, Canary, autonomous execution, Sol challenger/live, web search, broker, scheduler, provider, and execution-mode invariants now parse together and fail closed. Preview always receives a disabled gateway.
3. **Unknown/stale pricing could not be time-expired.** **Fixed in code and prepared migration:** exact IDs, official source URL, `verified_at`, verification expiry, version, checksum, and a reservation trigger that rejects unverified/expired prices.

No critical finding remains unresolved in the disabled repository state. Activation conditions remain mandatory.

### High

1. Daily and monthly defaults were USD 0.30 and USD 6.30 soft; there was no experiment hard cap. **Fixed:** USD 0.25/0.40 daily, USD 8/10 monthly, USD 30 experiment, USD 50 lifetime; exact under/on/over tests added.
2. Scheduler rows lacked complete lease heartbeat, terminal recovery states, retry ceiling, and Reconciler audit. **Fixed in unapplied migration.**
3. Supabase Free storage did not have an automated threshold guard or external backup workflow. **Fixed in unapplied migration and scripts:** daily AI-free size snapshots, 60/75/85/90 actions, batch/audited regenerable-payload compaction, dump/restore workflows, dashboard projection.
4. A server key was pasted into the conversation. It was not written to the repository or logs, but should be considered disclosed. **Open manual condition:** rotate it in Supabase and update only server-side consumers before any dry run.

### Medium

1. Hosted `model_pricing` currently has zero rows, so paid calls fail closed. The new verified records exist only in the unapplied migration. This is safe now and a migration prerequisite later.
2. The connected Vercel project tool does not enumerate environment variable names/scopes. Code/defaults and Preview behavior are verified, but exact Production values require a manual Settings review before activation.
3. Supabase Auth reports one warning: leaked-password protection disabled. The owner must use a unique password or enable the feature if the plan supports it. [Supabase remediation](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
4. The CI workflow invokes a moving Supabase CLI release rather than a pinned version. This does not affect runtime safety but reduces infrastructure reproducibility and should be pinned in a separate CI-maintenance change.

### Low

1. OneDrive made the frozen dependency relink slow and created a read-ACL issue in one generated dependency folder. The exact folder ACL was reset; source and lockfile were unaffected.
2. Storage growth has no seven-day history yet, so forecast days are correctly `pending` rather than guessed in the dashboard.

## Changed files

- Safety/config: `.env.example`, `vercel.json`, `src/lib/env/server.ts` and tests.
- Scheduler: removed `src/app/api/cron/market-cycle/route.ts`; added `src/app/api/internal/scheduler/route.ts`, tests, and `src/lib/supabase/scheduler-runtime-repository.ts`.
- OpenAI boundary: `src/providers/openai/gateway.ts`, `factory.ts`, `fake.ts`, `types.ts`, model-list tests, `scripts/check-openai-model-access.ts`.
- Canary: `src/features/agent/paid-canary.ts` and tests, `src/lib/supabase/paid-canary-repository.ts`, `scripts/run-openai-paid-canary.ts`.
- Budget/pricing: `src/domain/budgets/pricing.ts`, `guard.ts`, and tests; `scripts/verify-model-pricing.ts`.
- Database: `supabase/migrations/20260809150000_post_build_hosting_safety.sql`, `supabase/tests/post_build_hosting_safety_test.sql`.
- Dormant activation: `supabase/activation/enable-hosted-scheduler.sql`, `disable-hosted-scheduler.sql`.
- Dashboard: Costs page/view plus hosted storage and budget-status repositories/tests.
- Backups: `scripts/export-critical-tables.mjs`, `scripts/verify-backup-restore.mjs`, `docs/BACKUP_AND_RESTORE.md`.
- Architecture/docs: README, cost, deployment, runbook, security, known limitations, `docs/NOTION_BOUNDARY.md`, this report, and `tasks/todo.md`.

Unrelated pre-existing user worktree modifications were preserved and are not part of this audit scope.

## Requirement / status / evidence

| Requirement                                          | Status                                                  | Evidence                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Paper only; no broker                                | Pass                                                    | `pnpm test:safety`; no trading host/SDK/order endpoint; DB trigger rejects Sol-origin orders        |
| Agent/paid/Canary/Sol/web/autonomous/broker disabled | Pass in repo/defaults; manual hosted env review pending | `.env.example`, Zod cross-flag validation, hosted controls all zero                                 |
| Preview cannot call/fill                             | Pass                                                    | Gateway factory Preview disable; scheduler returns `production_only`; route tests                   |
| One scheduler authority                              | Pass, dormant                                           | Vercel Cron removed; no `vercel.json` crons; Supabase-only env rule                                 |
| Exactly two later Cron jobs                          | Prepared, not active                                    | `enable-hosted-scheduler.sql`; hosted `pg_cron`/`pg_net` absent                                     |
| POST/auth/no cache/IDs/timeouts                      | Pass                                                    | protected route and route tests; 300/110/120-second configuration                                   |
| Market holiday/DST/early close                       | Existing pass                                           | immutable 2026 XNAS/ARCX official calendar and existing pgTAP/Vitest suites                         |
| Unique cycle and duplicate no-op                     | Pass/prepared                                           | slot PK plus unique experiment/session/quarter index; advisory lock; route/DB tests                 |
| Heartbeat/retry/Reconciler/audit                     | Prepared                                                | additive migration, expired lease never provider-retried                                            |
| Order/fill idempotency and immutable ledger          | Existing pass                                           | existing constraints/service tests; no new writer added                                             |
| Unknown possibly charged                             | Pass                                                    | existing reservation transition plus Canary/agent unknown paths                                     |
| USD 0.40/10/30/50 ceilings                           | Pass                                                    | decimal guard and table-driven under/on/over tests; DB trigger serializes experiment total          |
| 70/90/100 durable alerts                             | Prepared/dashboard-ready                                | deduplicated table/trigger and hosted Costs projection                                              |
| Current official pricing                             | Pass in code; migration pending                         | official model pages verified 2026-08-09, version/expiry/checksum                                   |
| Free model-list check                                | Implemented; no key configured locally                  | `status=not_configured`; zero generation                                                            |
| Paid Canary                                          | Implemented and fully mocked; not run                   | local CLI only, seven gates, one-shot lock, <= USD 0.01, max 3                                      |
| Champion/challenger isolation                        | Prepared                                                | immutable paired table, same snapshot/prompt IDs, no promotion field, Sol order trigger             |
| 500 MB strategy                                      | Prepared                                                | exact-byte daily monitor, 60/75/85/90 actions, Costs projection                                     |
| Retention                                            | Prepared                                                | batch, idempotent operation ID, audit, regenerable payload only                                     |
| Backup/restore                                       | Scripts/docs pass static review; execution pending      | dump manifest and localhost-only restore verifier                                                   |
| Notion boundary                                      | Pass                                                    | no runtime dependency; `docs/NOTION_BOUNDARY.md`; no connection made                                |
| RLS/grants/search path                               | Pass in rollback rehearsal                              | forced RLS and explicit grants; fixed empty search paths; pgTAP assertions                          |
| Production unchanged                                 | Pass                                                    | migration/tests executed only inside `BEGIN ... ROLLBACK`; model pricing still 0; extensions absent |

## Current feature flags

Repository/example defaults:

```dotenv
AGENT_ENABLED=false
AGENT_EXECUTION_MODE=mock
AUTONOMOUS_PAPER_EXECUTION_ENABLED=false
PAID_MODEL_CALLS_ENABLED=false
OPENAI_CANARY_ENABLED=false
OPENAI_WEB_SEARCH_ENABLED=false
SOL_ENABLED=false
SOL_CHALLENGER_ENABLED=false
SOL_LIVE_EXECUTION_ENABLED=false
REAL_BROKER_ENABLED=false
SCHEDULER_ENABLED=false
SCHEDULER_PROVIDER=supabase
```

Hosted database evidence on 2026-08-09: 0 enabled agent controls, 0 enabled scheduler controls, 0 emergency pauses, 0 agent runs, 0 decisions, 0 budget reservations, 0 usage events, 0 orders, and 0 fills. The legacy persisted scheduler provider remains `manual`; because scheduler controls are false and the new remote function is unapplied, this is fail-closed. The later activation script atomically changes only the reviewed provider/control state to Supabase.

## Vercel verification

- Project: `capital-lab` (`prj_pbCNwlmXZLeZprZpsRAfAAhPPXVR`), Next.js, Node 24.x.
- Project `live=false`; latest observed deployment is READY and Preview (`target=null`) at prior commit `451633f`.
- `vercel.json` has no Cron schedule and now explicitly sets Fluid Compute.
- Current official Vercel documentation reports a 300-second Hobby maximum with Fluid Compute and a once-per-day minimum Hobby Cron frequency. Sources: [Function limits](https://vercel.com/docs/functions/limitations), [Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing).
- Exact Production environment names/scopes: `manual_verification_required` because the connected project API does not expose them.
- New audit Preview: recorded in final verification below after Git deployment.

## Supabase verification

- Project: `Capital-Lab`, `ACTIVE_HEALTHY`, `eu-west-3`, PostgreSQL 17.6.1.155.
- Current size: **26,635,411 bytes (25.40 MiB), 5.08% of 500 MiB**.
- Largest relations: `public.market_sessions` 581,632; `public.experiment_versions` 491,520; `private.ai_budget_reservations` 311,296; `public.decision_context_snapshots` 278,528; `public.fills` 245,760; `public.orders` 229,376; `public.agent_decisions` 229,376; `public.agent_runs` 204,800 bytes.
- 0 current `model_pricing` rows; `pg_cron` and `pg_net` are not installed; no job was created.
- All exposed existing tables have RLS; post-build additions force RLS in rollback rehearsal.
- Security advisor: only leaked-password protection disabled. Performance advisor: informational unused indexes expected for the dormant schema.
- The full new migration compiled on the hosted schema and the combined pgTAP rehearsal reached `ok 42` inside a transaction that ended in `ROLLBACK`.

## Three-month storage projection

There is no historical snapshot series, so no observed growth rate is claimed. Scenario projections from 26,635,411 bytes over 90 days are:

| Scenario  |    Projected size | Free-limit utilization | Interpretation                        |
| --------- | ----------------: | ---------------------: | ------------------------------------- |
| 1 MiB/day | 121,007,251 bytes |                 23.08% | below warning                         |
| 2 MiB/day | 215,379,091 bytes |                 41.08% | below warning                         |
| 5 MiB/day | 498,494,611 bytes |                 95.08% | 90% pause would trigger around day 85 |

The dashboard forecast remains pending until at least seven real daily snapshots exist.

## Pricing evidence

Verified at `2026-08-09T09:30:00Z`; expiry `2026-09-08T09:30:00Z`; version `openai-2026-08-09-v1`.

| Exact model     | Input | Cached input | Cache write | Output | Official source                                                      |
| --------------- | ----: | -----------: | ----------: | -----: | -------------------------------------------------------------------- |
| `gpt-5.6-luna`  |  0.20 |         0.02 |        0.25 |   1.20 | [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)   |
| `gpt-5.6-terra` |  2.00 |         0.20 |        2.50 |  12.00 | [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) |
| `gpt-5.6-sol`   |  5.00 |         0.50 |        6.25 |  30.00 | [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)     |

Values are USD per one million tokens. Long-context multipliers and any tool price must be reserved explicitly before those modes are allowed; this runtime uses the short tier and zero tools for the Canary.

## OpenAI activation evidence

The local free check returned:

```json
{
  "status": "not_configured",
  "requiredModels": {
    "gpt-5.6-luna": false,
    "gpt-5.6-terra": false,
    "gpt-5.6-sol": false
  }
}
```

No request was attempted without `OPENAI_API_KEY`. The normal endpoint and limitations are documented at [Models list](https://developers.openai.com/api/reference/resources/models/methods/list) and [Administration overview](https://developers.openai.com/api/reference/administration/overview). Remaining prepaid credit cannot be established by the normal Models API.

Manual Billing checklist:

- correct OpenAI project selected;
- approximately USD 50 active prepaid credit;
- credit expiry date reviewed;
- billing/payment status healthy;
- project hard monthly spend limit set manually to USD 10 at [Billing overview](https://platform.openai.com/settings/organization/billing/overview).

## Verification commands and exit codes

The command record includes failures; none is hidden.

| Command / operation                                              | Exit/result                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------ |
| Initial focused env/scheduler/readiness Vitest                   | 0, 3 files / 21 tests                                        |
| Pricing/budget Vitest after exact-limit changes                  | 0, 2 files / 10 tests                                        |
| Model-list + pricing/budget Vitest                               | 0, 3 files / 15 tests                                        |
| First model-list CLI                                             | 1; incomplete local `esbuild` dependency, no API request     |
| `pnpm install --offline --frozen-lockfile` (120 s)               | 124; OneDrive relink timeout                                 |
| Same offline install (600 s)                                     | 124; incomplete offline cache/registry denied                |
| Approved `pnpm install --frozen-lockfile`                        | 0; exact lockfile, 805 packages linked                       |
| `pnpm exec` focused test/typecheck                               | 1; non-TTY managed-pnpm purge check; no tests run            |
| Direct focused Vitest + TypeScript                               | tests 0, 35/35; typecheck 1 on stale deleted route metadata  |
| `next typegen`                                                   | 0; stale `.next/dev/types` still present                     |
| Remove verified generated `.next/dev/types`; direct TypeScript   | 0                                                            |
| Canary/storage/scheduler focused Vitest + TypeScript             | 0, latest 16/16 and typecheck pass                           |
| First hosted migration rehearsal                                 | transport error; command text was truncated before execution |
| Chunked hosted migration `BEGIN ... ROLLBACK`                    | success, no persistence                                      |
| First combined pgTAP rehearsal                                   | stopped: pgTAP search path missing                           |
| Corrected combined migration/pgTAP rehearsal                     | success through `ok 42`, then rollback                       |
| Disabled Canary CLI with wrong confirmation/default flags        | expected exit 1; `calls=0`, `reservedUsd=0`                  |
| Free model-list CLI without key                                  | expected exit 1; `not_configured`, no request                |
| First repository scan command                                    | PowerShell parse error before scan                           |
| Corrected `node scripts/check-paper-only.mjs` and targeted scans | 0                                                            |
| Exact Notion runtime dependency scan                             | 0, none found                                                |
| Final repository `pnpm format:check`                             | 1; 15 preserved, unrelated dirty market-ingestion files      |
| Audit-owned Prettier slice                                       | 0; all matched TS/JS/JSON/Markdown files pass                |
| Final direct ESLint (`--max-warnings=0`)                         | 0; zero warnings                                             |
| Final direct TypeScript (`tsc --noEmit`)                         | 0                                                            |
| Final direct Vitest                                              | 0; 74 files / 558 tests                                      |
| Final paper-only safety scan                                     | 0                                                            |
| Final direct Next.js production build                            | 0; Next.js 16.3, internal scheduler route present            |
| First final Playwright attempt                                   | 1; Chromium spawn denied by Windows sandbox                  |
| Second Playwright attempt                                        | 1; real `.env.local` selected hosted auth, no mock mutation  |
| Corrected isolated mock Playwright                               | 0; 4/4 Chromium journeys                                     |
| Local `pnpm test:db`                                             | 1 immediately; Docker is not installed/running               |
| Final connector rollback request                                 | refused: embedded migration `COMMIT`; no query executed      |
| Prior hosted rollback migration + pgTAP rehearsal                | success through `ok 42`; no schema/data persisted            |
| `git diff --check`                                               | 0                                                            |
| Preview and clean-checkout CI                                    | pending exact-commit Git gates                               |

## Exact later commands — do not run without separate approval

### 1. Free OpenAI metadata check

Set `OPENAI_API_KEY` ephemerally in the local shell or approved secret manager, never in source control:

```powershell
$env:OPENAI_API_KEY='<project-runtime-key>'
pnpm openai:models:check
Remove-Item Env:OPENAI_API_KEY
```

Expected prerequisite result: `status=ok` with all three exact IDs true. This remains free/non-generating and proves neither credit nor inference.

### 2. Optional maximum USD 0.01 paid Canary

Only after migration, key rotation, backup restore, metadata check, Billing checklist, and separate paid approval:

```powershell
$env:AGENT_ENABLED='false'
$env:AGENT_EXECUTION_MODE='mock'
$env:AUTONOMOUS_PAPER_EXECUTION_ENABLED='false'
$env:PAID_MODEL_CALLS_ENABLED='true'
$env:OPENAI_CANARY_ENABLED='true'
$env:OPENAI_WEB_SEARCH_ENABLED='false'
$env:SOL_ENABLED='false'
$env:SOL_CHALLENGER_ENABLED='false'
$env:SOL_LIVE_EXECUTION_ENABLED='false'
$env:REAL_BROKER_ENABLED='false'
$env:SCHEDULER_ENABLED='false'
$operationId = [guid]::NewGuid().ToString()
pnpm openai:canary -- --confirm-paid-canary=MAX_0_01_USD --operation-id=$operationId
$env:PAID_MODEL_CALLS_ENABLED='false'
$env:OPENAI_CANARY_ENABLED='false'
```

`OPENAI_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, and `SUPABASE_SECRET_KEY` must already be supplied by the approved local secret mechanism. Do not paste them into the command or report. The real Canary was **not run** in this audit.

### 3. Prepare the 48-hour no-AI shadow dry run

First take and restore-test a backup. Then review the SQL diff and dry-run the migration:

```powershell
supabase db push --linked --dry-run
pnpm test:db
```

After explicit migration approval only:

```powershell
supabase db push --linked
```

In Vercel Production Settings, verify the exact disabled flags from this report, set `SCHEDULER_PROVIDER=supabase`, keep `SCHEDULER_ENABLED=false` initially, store a new rotated `SUPABASE_SECRET_KEY`, and store a new 32+ character `SCHEDULER_SHARED_SECRET`. Do not put either in Preview unless needed for a no-op auth test; Preview still cannot dispatch.

In Supabase Vault UI, create exactly:

- `capital_lab_scheduler_url` = full protected Production `/api/internal/scheduler` URL;
- `capital_lab_scheduler_shared_secret` = the same rotated bearer secret.

Then set Vercel Production `SCHEDULER_ENABLED=true`, redeploy that environment-only change, and execute the reviewed activation file once:

Run the file in Supabase SQL Editor, or use an ephemerally supplied database URL with `psql`:

```powershell
psql "$env:SUPABASE_DB_URL" --set ON_ERROR_STOP=1 --file supabase/activation/enable-hosted-scheduler.sql
Remove-Item Env:SUPABASE_DB_URL
```

The transaction requires exactly one eligible active shadow experiment, keeps every AI/paid/Sol/web/broker flag false, enables only its no-AI scheduler control, installs unpinned `pg_cron`/`pg_net`, and creates exactly two jobs.

Observe for 48 hours: every slot must be `no_ai_shadow_dry_run`, `model_calls=0`, `paper_orders_created=0`, `paper_fills_created=0`, and `ledger_entries_created=0`; duplicates must reuse the unique slot; Reconciler may only mark stale leases and capture one daily storage snapshot.

### 4. End or abort the dry run

Set Vercel Production `SCHEDULER_ENABLED=false` first, then execute:

```powershell
psql "$env:SUPABASE_DB_URL" --set ON_ERROR_STOP=1 --file supabase/activation/disable-hosted-scheduler.sql
Remove-Item Env:SUPABASE_DB_URL
```

Verify zero named jobs, scheduler/agent controls false, and unchanged order/fill/ledger/AI usage counts. Any unknown state is a stop condition.

## Remaining manual conditions and risks

1. Rotate the disclosed Supabase server key and update only approved server-side consumers.
2. Review/apply the migration after an external backup and local restore test.
3. Verify Vercel Production environment values and scopes; no privileged `NEXT_PUBLIC_*` values.
4. Complete the free Models check and manual OpenAI credit/expiry/project/spend-limit review.
5. Decide separately whether to authorize the maximum USD 0.01 Canary.
6. Decide separately whether to authorize the 48-hour no-AI dry run.
7. Re-verify pricing before 2026-09-08.
8. Build a 2027 official exchange calendar before any operation beyond the locked 2026 manifest.
9. Pin the Supabase CLI version in CI in a separate reviewed change.

## Final disabled state

At handoff: agent off; autonomous paper execution off; scheduler off; paid calls off; Canary off; Sol challenger/live off; OpenAI web search off; Notion runtime absent; real broker capability absent; no Research Deck or experiment started.

Review this report before deciding separately on the paid Canary and, only afterward, the 48-hour no-AI shadow dry run.
