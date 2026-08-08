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

## Ledger reconciliation

Rebuild cash, lots, positions, realized P&L, fees, exposure, and margin from immutable fills/ledger/action events. Any exact mismatch pauses the experiment. Administrative repair may rebuild only materialized projections; never rewrite history.

## Incident data

Use correlation ID, experiment ID, scheduler run ID, agent run ID, provider, operation, and error class. Logs must not contain tokens, authorization headers, API keys, or full environment values.
