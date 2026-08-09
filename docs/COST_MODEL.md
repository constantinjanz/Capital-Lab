# OpenAI cost model

Budget periods use `America/New_York`. Defaults:

- lifetime hard limit: USD 50.00
- three-month experiment hard limit: USD 30.00
- monthly soft target: USD 8.00
- monthly hard limit: USD 10.00
- trading-day soft target: USD 0.25
- trading-day hard limit: USD 0.40

Effective-dated short-context pricing was rechecked on 2026-08-09 against the official [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), and [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) pages. The verified input/cached-input/cache-write/output USD-per-million values are Luna 0.20/0.02/0.25/1.20, Terra 2.00/0.20/2.50/12.00, and Sol 5.00/0.50/6.25/30.00. The cache-write values apply the documented 1.25x uncached-input multiplier. Pricing records carry exact model IDs, source URL, verification time, expiry, version, and checksum. Unknown, unverified, overlapping, or expired pricing blocks the reservation and therefore the call.

Before a call, a short transaction locks lifetime, month, trading-day, and quota rows in deterministic order, checks settled + reserved + unknown spend, and reserves worst-case cost. The network call happens after commit. Success settles actual usage in a second transaction. A definite pre-send failure releases; an uncertain outcome becomes `unknown` and continues consuming the limit until manual reconciliation.

Daily exhaustion skips paid calls. Monthly and experiment exhaustion pause the agent. Lifetime exhaustion remains charged until a manual decision. Alerts at 70%, 90%, and 100% are persistent and deduplicated across day, month, experiment, and lifetime. USD 0.40 is a ceiling, never a spend target.

The OpenAI SDK has `maxRetries: 0`. Provider timeouts after a possibly accepted request become `unknown`; the conservative reservation remains charged and the request is not blindly retried. `pnpm pricing:verify` is a local, non-mutating official-page verifier and must be run before the current price record expires on 2026-09-08.
