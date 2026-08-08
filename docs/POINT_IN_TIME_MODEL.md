# Point-in-time model

Publication time is not enough. Every context query requires a non-null `decision_at` and returns only versions where `available_at <= decision_at`.

Provider facts record event time, provider receipt when available, first-seen time, agent-availability time, ingestion time, source ID, content hash, and revision. Corrections are new rows; prior facts are never overwritten. Universe membership and corporate actions are versioned too.

The system keeps two clocks:

- `decisionAt`: immutable cutoff for information the agent may see.
- `simulationAsOf`: forward-moving execution/outcome clock after the decision.

An event published at 10:02 but first available at 10:14 cannot inform a 10:10 decision. A decision at 10:15 cannot fill before its configured processing and order latency; execution selects the first eligible later opportunity. Web results without verifiable timing are background context only. Stale/missing prices or FX block execution.

Fills pin the exact quote/bar/FX IDs used. Replays select the newest revision that was actually available at their timestamp, preventing later corrections from leaking backward.

The hosted `/markets` page calls one owner-only database function that materializes the current universe, its current members, configured market-data source IDs, quotes/completed bars, the latest 21 eligible one-minute feature-input bars per feed, exchange sessions, and source health in one PostgreSQL statement snapshot. The statement records its own decision timestamp, so configuration and evidence cannot mix MVCC versions. Mutable instrument, exchange, source, or calendar-source metadata is additionally rejected when it is not eligible at the boundary.

The separate official-calendar attestation also stamps one database decision time and returns configured only when the fixed 2026 manifest record, both disabled provenance sources/policies, immutable audit, and all 522 XNAS/ARCX weekday rows are eligible at that boundary. Sessions use an explicit `available_at`: a historical session configured later was not knowable before that configuration timestamp. Exact New York local windows are persisted as UTC, including daylight-saving changes, holidays, and early closes. The attestation authorizes no scheduler or experiment transition.

Quote and bar revisions are collapsed before cancellations, incomplete bars, future provider-event timestamps, or future provider-receipt timestamps are removed, so an ineligible latest revision cannot resurrect older evidence for the same logical record. Financial values cross the Data API as text. Configuration is deliberately current-only: universe membership is not bitemporal, so this screen is not a historical-universe browser. `source_health` also lacks an explicit `available_at`; its `created_at` is used conservatively as the current knowledge-time boundary.

`market-technical-v1` is calculated in pure domain code from those exact strings. It uses only the contiguous suffix ending at the latest completed bar: one- and five-minute close returns, prior-20-bar relative volume, non-annualized five-return root-sum-square realized volatility, distance from the five-bar simple moving average, and distance from a 20-bar volume-weighted typical-price proxy. Quote spread and spread basis points use the latest eligible bid/ask pair. A missing minute, missing quote side, insufficient sample, or zero denominator yields unavailable rather than bridging a gap or inventing zero. The feature version travels with the values so a later decision-context snapshot can pin the algorithm used.
