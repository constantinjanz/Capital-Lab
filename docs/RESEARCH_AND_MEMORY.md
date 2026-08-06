# Research and memory

Capital Lab stores research in Supabase rather than delegating retrieval to a hosted file-search product. Importers support Markdown notes, JSON strategy cards, and CSV source registries with preview/commit modes, validation, sanitization, deterministic chunks, hashes, document versions, duplicate detection, and corpus versions.

Hybrid retrieval combines PostgreSQL full-text search and pgvector, then applies source quality and point-in-time filters. Every chunk returned to a model includes an internal evidence ID, provenance, `available_at`, and corpus/document version.

Decision context snapshots are immutable and pin prompt/model/strategy/config versions, portfolio/market/event/research IDs, routing reason, and budget reservation/usage. Code labels forward outcomes at 15 minutes, one hour, end of day, one day, and five days.

Pattern hypotheses move through proposed → shadow → eligible → active → retired/rejected. Deterministic gates require independent observations, acceptable drawdown, calibration/performance thresholds, and holdout or walk-forward validation. Models cannot rewrite prompts, risk rules, budgets, source allowlists, database policies, or promote themselves.
