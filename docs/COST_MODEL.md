# OpenAI cost model

Budget periods use `America/New_York`. Defaults:

- lifetime hard limit: USD 50.00
- monthly soft target: USD 6.30
- monthly hard limit: USD 10.00
- trading-day hard limit: USD 0.30

Effective-dated short-context standard pricing is seeded from the official OpenAI pricing table. On 2026-08-06 it lists Luna at 0.20/0.02/0.25/1.20, Terra at 2.00/0.20/2.50/12.00, and Sol at 5.00/0.50/6.25/30.00 USD per million input/cached-input/cache-write/output tokens. Web search is USD 10 per 1,000 calls plus content tokens at the model rate. Pricing is data, never scattered constants.

Before a call, a short transaction locks lifetime, month, trading-day, and quota rows in deterministic order, checks settled + reserved + unknown spend, and reserves worst-case cost. The network call happens after commit. Success settles actual usage in a second transaction. A definite pre-send failure releases; an uncertain outcome becomes `unknown` and continues consuming the limit until manual reconciliation.

Daily exhaustion skips paid calls. Monthly/lifetime exhaustion pauses the agent. Alerts at 70%, 90%, and 100% are idempotent. Every skip still writes routing and scheduler records.
