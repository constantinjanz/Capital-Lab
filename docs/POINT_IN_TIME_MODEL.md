# Point-in-time model

Publication time is not enough. Every context query requires a non-null `decision_at` and returns only versions where `available_at <= decision_at`.

Provider facts record event time, provider receipt when available, first-seen time, agent-availability time, ingestion time, source ID, content hash, and revision. Corrections are new rows; prior facts are never overwritten. Universe membership and corporate actions are versioned too.

The system keeps two clocks:

- `decisionAt`: immutable cutoff for information the agent may see.
- `simulationAsOf`: forward-moving execution/outcome clock after the decision.

An event published at 10:02 but first available at 10:14 cannot inform a 10:10 decision. A decision at 10:15 cannot fill before its configured processing and order latency; execution selects the first eligible later opportunity. Web results without verifiable timing are background context only. Stale/missing prices or FX block execution.

Fills pin the exact quote/bar/FX IDs used. Replays select the newest revision that was actually available at their timestamp, preventing later corrections from leaking backward.
