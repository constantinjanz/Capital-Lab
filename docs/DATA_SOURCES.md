# Data sources

## Market data

The live v1 adapter is restricted to Alpaca's Market Data origin for stock quotes, bars, and snapshots. It does not install Alpaca's combined trading SDK and has no broker method. Free IEX data is suitable for initial validation but represents a single exchange; SIP access and recent historical availability depend on the user's separate market-data subscription.

Vercel functions fetch snapshots at bounded decision cycles. They do not maintain long-lived WebSockets. This adds sampling latency and can miss intracycle changes; every record stores provider event time, first seen time, availability time, ingestion time, source identifier, and revision.

## Public information

Allowlisted import/connector definitions exist for SEC EDGAR, Federal Reserve, BLS, White House releases, explicitly configured company IR feeds, and licensed news. Connectors require HTTPS, a declared user agent, rate limits, licensing/retention metadata, and one fixed origin; discovered links are not crawled automatically.

Public social data is disabled by default and has no scraping implementation. A future official/licensed adapter must restrict verified account IDs and topical filters.

All external content is sanitized, provenance-bearing, and wrapped as untrusted evidence. It cannot override system, risk, budget, source, or execution rules.
