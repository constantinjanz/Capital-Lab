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

## Locked experiment lifecycle

Use the experiment detail page only after confirming its locked version, execution mode, lifecycle state, and control revision. Promotion accepts only an active shadow experiment with the simulation account active, the emergency pause clear, and scheduler/agent controls disabled. Enter `PROMOTE TO LIVE PAPER` exactly; this changes only the simulation execution mode and does not enable a runtime loop or broker capability.

Pause requires a concise operator reason and leaves the locked version and mode unchanged. Resume only a manual pause after confirming the emergency pause is clear and runtime controls remain disabled. Complete only after all simulated orders are terminal; completion closes the simulation account and is not a liquidation or brokerage action. Clone creates a disabled draft linked to its source and copies no orders, fills, positions, ledger, lifecycle, or runtime state.

If the page reports a revision conflict, reload and reassess before issuing a new operation. If the result is unknown, do not create another operation: retry from the unchanged page with the same operation UUID so the database can return durable replay evidence. Use the correlation/operation UUID to inspect the single status event and redacted audit record.

## Manual Alpaca IEX ingestion

Keep the source disabled unless a reviewed batch is intended. Confirm `MARKET_DATA_PROVIDER=alpaca`, `ALPACA_DATA_FEED=iex`, `SCHEDULER_PROVIDER=manual`, `AGENT_ENABLED=false`, and a complete server-only data credential pair. Sign in as the owner, enable the reviewed source, then submit one bounded batch from Markets. A success must show database-confirmed inserted/reused counters and availability time. An unknown result must be retried with the same operation from the existing page before starting another operation. Provider failures are stored only as allowlisted classes. Disable the source after review; no scheduler or calendar population follows automatically.

## Cost reconciliation

Unknown OpenAI reservations are never auto-released. Compare stored response IDs and provider usage records; settle or release through an audited owner action. If actual cost exceeds the reservation, record the overage and pause.

## Ledger reconciliation

Rebuild cash, lots, positions, realized P&L, fees, exposure, and margin from immutable fills/ledger/action events. Any exact mismatch pauses the experiment. Administrative repair may rebuild only materialized projections; never rewrite history.

## Incident data

Use correlation ID, experiment ID, scheduler run ID, agent run ID, provider, operation, and error class. Logs must not contain tokens, authorization headers, API keys, or full environment values.
