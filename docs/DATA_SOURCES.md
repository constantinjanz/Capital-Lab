# Data sources

## Market data

The live v1 adapter is restricted to Alpaca's Market Data origin for stock quotes, bars, and snapshots. It does not install Alpaca's combined trading SDK and has no broker method. Free IEX data is suitable for initial validation but represents a single exchange; SIP access and recent historical availability depend on the user's separate market-data subscription.

Vercel functions fetch snapshots at bounded decision cycles. They do not maintain long-lived WebSockets. This adds sampling latency and can miss intracycle changes; every record stores provider event time, first seen time, availability time, ingestion time, source identifier, and revision.

The hosted market screen is a database reader, not an ingestion trigger. One database-stamped statement atomically captures the current universe, configured sources, and all displayed owner-scoped observations available at that frozen boundary. It labels persisted synthetic sources and leaves missing quote, bar, current-day session, or health values unavailable. Provider health is described as a past observation rather than a live status unless a separate freshness policy is introduced. Loading the page never contacts Alpaca or another external provider.

## Public information

Allowlisted import/connector definitions exist for SEC EDGAR, Federal Reserve, BLS, White House releases, explicitly configured company IR feeds, and licensed news. Connectors require HTTPS, a declared user agent, rate limits, licensing/retention metadata, and one fixed origin; discovered links are not crawled automatically.

Public social data is disabled by default and has no scraping implementation. A future official/licensed adapter must restrict verified account IDs and topical filters.

All external content is sanitized, provenance-bearing, and wrapped as untrusted evidence. It cannot override system, risk, budget, source, or execution rules.
