# Known limitations

- Docker and the Supabase CLI are required to execute local database/pgTAP tests; application mock mode does not require them.
- The mock weekday calendar is for local fixtures only. Live scheduling must query versioned official market-session rows, including holidays and shortened sessions.
- Vercel snapshot polling is bounded to scheduled decision points and is not a low-latency feed.
- Free Alpaca IEX coverage is a single exchange and may not represent the full US market.
- Official-source adapters are allowlisted foundations; operators must review each source's current terms, licensing, rate limits, retention, and user-agent requirements before activation.
- Social/political platform adapters, Sol escalation, controlled web research, and weekly AI meta-review are disabled.
- Options, futures, crypto, FX speculation, and other complex assets are non-tradable placeholders.
- Mock embeddings are deterministic test fixtures, not production semantic embeddings.
- The hosted Supabase schema and generated types are connected, but no live experiment, real OpenAI call, market-data call, or broker call is enabled.
- Protected live Supabase authentication is wired, but the first hosted Auth user and matching `app_users` owner row must still be provisioned. Dashboard reads and interactive UI controls continue to use the deterministic mock repository until reviewed database use-case adapters replace them.
- The checked-in cron route runs the bounded mock-safe cycle. The database contains official-session, scheduler-lock, idempotency, budget, and pause primitives, but those durable functions must be wired into the runtime cycle after database tests pass. Do not enable a remote scheduler before that review.
- The Luna/Terra/Sol orchestrator, deterministic risk engine, and simulator are tested as separate safe boundaries. Live-paper proposal-to-simulated-order composition is intentionally not enabled until the durable database adapters are connected and reviewed.
- The in-memory manual rate limiter is for single-process local development; a distributed deployment needs database- or platform-backed enforcement.
