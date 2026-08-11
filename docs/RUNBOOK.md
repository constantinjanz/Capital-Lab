# Runbook

## Safe degradation

- no quote or FX: reject the simulated fill
- stale quote: reject and record a risk event
- no relevant event: make no model call
- OpenAI error: create no order; unknown network outcome retains the reservation
- monthly/lifetime budget exhaustion: pause the agent
- ledger mismatch or corrupted projection: pause the experiment
- duplicate scheduler delivery: return the prior slot result

## Emergency pause

Emergency pause is idempotent. It blocks new model calls and paper orders while preserving positions and history. Record the owner, reason, correlation ID, and timestamp. Data ingestion may remain active if configured.

## Start a hosted paper experiment

Use the experiment detail page only for a clean disabled draft after the readiness panel attests the fixed market manifest, disabled Alpaca IEX source/policy, and complete official 2026 calendar. Review the displayed draft and control revisions. Choose `replay` or `shadow`, enter `START REPLAY` or `START SHADOW` exactly, and submit once.

A successful start must lock one immutable version and report an active paper mode with a new simulation account. Verify the controls remain scheduler off, agent off, emergency pause clear; the new account has exactly EUR 100000.00000000 opening cash; and the opening snapshot has zero exposure, EUR 100000.00000000 NAV, and EUR 200000.00000000 paper buying power. The start itself launches no cycle, provider request, model call, order, or fill. If readiness is unavailable or blocked, do not bypass the RPC or modify manifest rows. If the page reports a revision conflict, reload and reassess. If the result is unknown, reload before any further operation and inspect the operation UUID's idempotency, status, audit, ledger, and snapshot evidence.

## Manual hosted paper cycle

Use the experiment detail action only for an active replay/shadow experiment with its reviewed locked version and active paper account visible. Confirm the remote scheduler, agent, and emergency pause are all off, then enter `RUN PAPER CYCLE` exactly. The database uses the displayed decision boundary, the current control revision, the locked 2026 XNAS/ARCX session, and a unique 15-minute slot. A successful request must return or reload one `skipped` result with `market_closed`, `outside_regular_session`, or `market_data_runtime_disabled`, plus one scheduler-run ID and one simulator-run ID. It must not change ingestion, source health, market observations, AI budget/usage, decisions, orders, fills, positions, ledger, or portfolio/P&L state.

An exact operation retry and a different delivery in the same slot must return the original IDs and result. On a revision or eligibility conflict, reload before reconsidering the action. On an unknown network result, do not create a new operation; reload and inspect the existing operation UUID, scheduler slot/run, simulator journal, idempotency record, and redacted audit. Never enable a remote scheduler to work around a blocked manual state.

## Locked experiment lifecycle

Use the experiment detail page only after confirming its locked version, execution mode, lifecycle state, and control revision. Promotion accepts only an active shadow experiment with the simulation account active, the emergency pause clear, and scheduler/agent controls disabled. Enter `PROMOTE TO LIVE PAPER` exactly; this changes only the simulation execution mode and does not enable a runtime loop or broker capability.

Pause requires a concise operator reason and leaves the locked version and mode unchanged. Resume only a manual pause after confirming the emergency pause is clear and runtime controls remain disabled. Complete only after all simulated orders are terminal; completion closes the simulation account and is not a liquidation or brokerage action. Clone creates a disabled draft linked to its source and copies no orders, fills, positions, ledger, lifecycle, or runtime state.

If the page reports a revision conflict, reload and reassess before issuing a new operation. If the result is unknown, do not create another operation: retry from the unchanged page with the same operation UUID so the database can return durable replay evidence. Use the correlation/operation UUID to inspect the single status event and redacted audit record.

## Manual Alpaca IEX ingestion

Keep the source disabled unless a reviewed batch is intended. Confirm `MARKET_DATA_PROVIDER=alpaca`, `ALPACA_DATA_FEED=iex`, `SCHEDULER_PROVIDER=manual`, `AGENT_ENABLED=false`, and a complete server-only data credential pair. Sign in as the owner, enable the reviewed source, then submit one bounded batch from Markets. A success must show database-confirmed inserted/reused counters and availability time. An unknown result must be retried with the same operation from the existing page before starting another operation. Provider failures are stored only as allowlisted classes. Disable the source after review; no scheduler or calendar population follows automatically.

## Official 2026 market calendar

Sign in as the owner and save the fixed calendar from Markets only after its migration and pgTAP contract pass. A success must attest 522 records across XNAS/ARCX: 498 regular, 4 early-close, and 20 holiday rows in total. Confirm the Nasdaq Trader and NYSE provenance sources remain disabled, scheduler/agent controls remain off, and no provider request or ingestion run was recorded. If setup reports a conflict, inspect the existing 2026 session/source/policy evidence; never overwrite or delete immutable rows to force acceptance. If the result is unknown, retry the same operation UUID from the unchanged page. The calendar may support the reviewed owner-triggered skipped envelope, but it must not be used to enable remote scheduling until that separate activation review passes.

## Cost reconciliation

Unknown OpenAI reservations are never auto-released. Compare stored response IDs and provider usage records; settle or release through an audited owner action. If actual cost exceeds the reservation, record the overage and pause.

## Free OpenAI metadata check

`pnpm openai:models:check` calls only `GET /v1/models` through the central server gateway and never creates a response. It reports `not_configured`, `authentication_error`, `permission_error`, `model_missing`, `rate_limited`, `timeout_error`, `network_error`, or `ok`, with booleans for the three exact model IDs and no key metadata. Success proves authentication and model visibility only; it does not prove prepaid credit or inference billing readiness.

Manually verify the correct OpenAI project, approximately USD 50 active prepaid credit, credit expiry, billing/payment health, and a USD 10 monthly project hard-spend limit at [Billing overview](https://platform.openai.com/settings/organization/billing/overview). Never put an `OPENAI_ADMIN_KEY` in Vercel, Supabase, source control, logs, or this app.

## Optional paid Canary

The Canary is local CLI only. It is blocked unless agent/autonomous/web are off, paid calls and Canary are ephemerally on, the exact `MAX_0_01_USD` confirmation is present, current pricing exists, the normal database budget reservation succeeds, and an atomic operation UUID is claimed. It reserves all three fixed Luna/Terra/Sol calls before sending, enforces a combined USD 0.01 ceiling, uses no tools/files/web/context/retries, and marks possibly accepted failures unknown. Do not run it without separate approval. See the exact command in `docs/post-build/hosting-safety-audit.md`.

## Scheduler recovery and shutdown

The only reviewed remote experiment is the dedicated `no_ai_shadow_infrastructure_dry_run`; it is not a research/trading experiment. Follow `docs/post-build/activation-readiness-follow-up.md` and the versioned `activation:phase` runner. Do not copy a shortened SQL fragment into the SQL Editor. Migration, extensions, Vault verification, disabled job installation, endpoint proof, mandatory missing/invalid Bearer probes, Auth No-op, Runtime deployment proof, baseline, arming, reconciliation, and shutdown are separate checksummed phases.

The Auth No-op and no-AI Runtime use two different immutable Vercel Production deployments from the same exact commit. First, the `auth_disabled` deployment must be `READY` with `SCHEDULER_ENABLED=false`; bind its read-only Vercel API proof, complete exactly one missing-Bearer and one invalid-Bearer 401 probe, and reconcile the one-shot Auth No-op. Only then create and independently prove the `no_ai_runtime_enabled` deployment with `SCHEDULER_ENABLED=true` and every other dangerous flag false. Never change a mock environment while retaining a deployment ID, and never use the Auth deployment ID for a Runtime request. Both proofs must use the checksummed project identity contract and stay outside the repository.

Every expected request is POST-only, bearer-protected, uncached, Production-only, correlated, and awaited. Two complete regular XNAS sessions contain 52 preregistered 15-minute slots and 104 dispatcher/reconciler events. Every dispatcher must have one Cron trigger, one pg_net request ID, a known 2xx response, one authenticated route request, one claimed terminal no-AI cycle, and exact zero model, budget, order, fill, and ledger counters. Missing or duplicate evidence is failure.

On any unknown result, run the DB-first emergency kill immediately; Vercel availability, audit writes, Cron alteration, and unscheduling are not prerequisites. Then prove a new shutdown-disabled Production deployment `READY`, retry the separately identified exact-ID Cron-disable operation, drain/reconcile, and unschedule only after terminal evidence. Never create a new operation identity to bypass an unknown result and never release an unknown AI reservation automatically.

### Break-glass DB-first kill

The minimal runner deliberately accepts unrelated dirty files and needs no Campaign manifest, deployment proof, Vercel access, or phase contract. It verifies its own committed runner/helper/SQL bytes against `HEAD`, requires the exact TLS-verified project boundary and campaign-scoped phrase, commits the nine false controls and experiment pause first, then reads them back. It does not alter or unschedule Cron jobs.

```powershell
$campaignId = '<exact-campaign-uuid>'
$env:CAPITAL_LAB_DATABASE_URL = '<redacted exact project URL with sslmode=verify-full>'
try {
  pnpm activation:emergency-kill -- `
    --campaign-id=$campaignId `
    --confirm="EMERGENCY KILL CAPITAL LAB CAMPAIGN $campaignId"
} finally {
  Remove-Item Env:\CAPITAL_LAB_DATABASE_URL -ErrorAction SilentlyContinue
}
```

Exit `0` means the committed Phase-1 transaction and immediate readback both completed. Exit `3` is an unknown process/signal/timeout outcome: reconcile the same campaign state directly and do not infer failure or run a replacement campaign. The checksummed `emergency-disable-jobs` phase is a later, independently retryable operation over the persisted exact job IDs.

## Storage and backups

The AI-free Reconciler captures at most one storage snapshot per UTC day. At 60% it warns, 75% identifies archival pressure, 85% blocks nonessential raw ingestion, and 90% disables scheduler/agent controls and emergency-pauses experiments. Cleanup only compacts regenerable raw payloads that already have an external storage path and an effective retention policy; hashes, source/time metadata, ledger, orders, fills, decisions, budget, and comparison evidence remain immutable.

Follow `docs/BACKUP_AND_RESTORE.md` weekly. A backup is not valid until a local/disposable restore test passes, and it must be stored outside the Capital Lab Supabase project.

## Ledger reconciliation

Rebuild cash, lots, positions, realized P&L, fees, exposure, and margin from immutable fills/ledger/action events. Any exact mismatch pauses the experiment. Administrative repair may rebuild only materialized projections; never rewrite history.

## Incident data

Use correlation ID, experiment ID, scheduler run ID, agent run ID, provider, operation, and error class. Logs must not contain tokens, authorization headers, API keys, or full environment values.
