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

## Manual Alpaca IEX ingestion

Keep the source disabled unless a reviewed batch is intended. Confirm `MARKET_DATA_PROVIDER=alpaca`, `ALPACA_DATA_FEED=iex`, `SCHEDULER_PROVIDER=manual`, `AGENT_ENABLED=false`, and a complete server-only data credential pair. Sign in as the owner, enable the reviewed source, then submit one bounded batch from Markets. A success must show database-confirmed inserted/reused counters and availability time. An unknown result must be retried with the same operation from the existing page before starting another operation. Provider failures are stored only as allowlisted classes. Disable the source after review; no scheduler or calendar population follows automatically.

## Cost reconciliation

Unknown OpenAI reservations are never auto-released. Compare stored response IDs and provider usage records; settle or release through an audited owner action. If actual cost exceeds the reservation, record the overage and pause.

## Ledger reconciliation

Rebuild cash, lots, positions, realized P&L, fees, exposure, and margin from immutable fills/ledger/action events. Any exact mismatch pauses the experiment. Administrative repair may rebuild only materialized projections; never rewrite history.

## Incident data

Use correlation ID, experiment ID, scheduler run ID, agent run ID, provider, operation, and error class. Logs must not contain tokens, authorization headers, API keys, or full environment values.
