# Data sources

## Market data

Capital Lab starts with `MARKET_DATA_PROVIDER=mock`. The deterministic mock path needs no provider credential, makes no external market-data request, and remains the only runnable decision-cycle path. The hosted Alpaca path is an explicit owner-triggered ingestion control, not a decision cycle.

The owner-reviewed hosted manifest is fixed and bounded:

- XNAS (`Nasdaq Stock Market`): AAPL, MSFT, and NVDA equities.
- ARCX (`NYSE Arca`): SPY and QQQ exchange-traded funds.
- Both exchanges use `America/New_York` and country code `US`. Every instrument uses its exact Alpaca symbol alias, USD currency, a `0.01` price increment, and a `1` quantity increment. Tradability means simulation/paper eligibility only; shorting is disabled.
- Locked, append-only `Capital Lab US Core` owner-universe versions with all five active members. The exact current version is reused; if another universe later becomes current, setup appends a new immutable reviewed version instead of editing history.
- One non-mock `alpaca_iex` / `Alpaca IEX Market Data` source at the exact data origin. Its v1 authenticated-IEX policy is limited to paper research with no brokerage-account or order access. Initial setup creates both source and policy disabled; a later universe-only reconfiguration never changes separately reviewed lifecycle state.

Applying this manifest is configuration only. It derives the owner from the authenticated session, stores no Alpaca or Supabase secret, contacts no provider, enables no runtime provider or scheduler, and creates no quote, bar, market-session, source-health, ingestion-run, or scheduler record. Those observation tables therefore remain empty immediately after setup.

The hosted snapshot exposes `reviewed_manifest_id` only after the database verifies the exact current universe, five open-ended members, instrument and exchange references, current Alpaca aliases, source origin, reviewed v1 policy evidence, and matching immutable audit record. The attestation deliberately excludes source enablement and later policy-lifecycle state so a separately reviewed activation does not erase the configured foundation. A later universe-only reconfiguration may preserve that lifecycle state only when an earlier audited manifest still attests successfully; an initially enabled or otherwise unreviewed source remains rejected. The attestation proves configuration provenance only: it does not authorize provider access, indicate ingestion readiness, or replace the separate runtime checks required by any future ingestion slice.

A hardened direct Alpaca HTTP adapter serves stock latest quotes and completed historical bars at exactly `https://data.alpaca.markets`. It does not install Alpaca's combined trading SDK and has no broker method. The hosted surface is fixed to SPY, QQQ, AAPL, MSFT, and NVDA on IEX; requests use raw/as-of semantics, ascending pagination, exact decimal strings, redirect refusal, per-request and aggregate deadlines, byte/page/record bounds, provider request IDs, and sanitized typed failures. Free IEX coverage represents a single exchange and may not reflect the full US market.

Manual ingestion has two deliberate owner actions. Source activation appends an audited effective-dated policy without fetching data. The batch action then re-authorizes the owner, verifies the safe server environment, begins an idempotent database run, performs provider HTTP outside the transaction, and atomically commits validated revisions or a sanitized failure. PostgreSQL stamps `available_at`, appends corrections, reuses exact content hashes, records normalized raw evidence, source health, counters, and redacted audit evidence, and leaves direct table writes denied. Credentials remain server-only and are never stored in Supabase. Adding credentials alone does not enable the source or fetch data.

The separate official-calendar manifest is fixed to 2026 XNAS and ARCX core regular sessions. Its reviewed sources are the Nasdaq Trader calendar and NYSE hours/calendar page. The database derives every Monday-Friday date in `America/New_York`, stores exact UTC windows, marks the ten official exchange holidays closed, and marks November 27 and December 24 as 13:00 early closes. That produces 261 records per exchange: 249 regular, 2 early-close, and 10 holiday rows. Both provenance sources and policies remain disabled with `runtime_fetch=false`; applying or replaying the manifest contacts no website and creates no scheduler, AI, experiment, order, fill, ledger, ingestion, quote, bar, or health row. Any conflicting or extra 2026 exchange session makes the owner-only transaction fail rather than rewrite evidence.

The manual hosted paper-cycle envelope now consumes the locked 2026 sessions only to select `market_closed`, `outside_regular_session`, or `market_data_runtime_disabled` and persist skipped journals. It does not call Alpaca or either calendar source. Calendars beyond 2026, remote scheduling, decision-context persistence, proposal/order composition, and production activation remain deferred. The manual Alpaca batch still does not call Alpaca's calendar because that endpoint is on a trading host and cannot create or alter a market-session row.

The hosted market screen reads one database-stamped market snapshot plus a separate owner-only official-calendar attestation. It exposes the fixed calendar setup only while that exact 522-row manifest is unconfigured, and exposes source lifecycle/manual ingestion only when the reviewed market manifest attests. It labels persisted synthetic sources and leaves missing quote, bar, current-day session, or health values unavailable. Provider health is described as a past observation rather than a live status unless a separate freshness policy is introduced. Loading the page never contacts Alpaca or an exchange website; only the enabled owner-submitted market-data batch action can make a provider request.

The same read-only snapshot supplies bounded deterministic feature inputs: at most 21 completed one-minute logical bars per configured instrument/source after point-in-time revision collapse. `market-technical-v1` derives exact-string spread, return, relative-volume, realized-volatility, SMA-distance, and typical-price-VWAP-distance values in normal code. Feature generation performs no provider request, persists no duplicate financial fact, and does not invoke a scheduler, model, order, fill, or ledger path. Missing or non-contiguous history remains visibly unavailable.

## Public information

Allowlisted import/connector definitions exist for SEC EDGAR, Federal Reserve, BLS, White House releases, explicitly configured company IR feeds, and licensed news. Connectors require HTTPS, a declared user agent, rate limits, licensing/retention metadata, and one fixed origin; discovered links are not crawled automatically.

Public social data is disabled by default and has no scraping implementation. A future official/licensed adapter must restrict verified account IDs and topical filters.

All external content is sanitized, provenance-bearing, and wrapped as untrusted evidence. It cannot override system, risk, budget, source, or execution rules.
