# Architecture

Capital Lab is a single Next.js 16 application with ports-and-adapters boundaries.

```text
App Router / Server Actions / Route Handlers
                    |
             feature use cases
                    |
     pure domain rules and typed ports
          /         |          \
   Supabase     data sources    OpenAI gateway
```

Pure domain modules do not import frameworks or providers. Supabase is the durable event store and policy engine; materialized positions are projections that can be rebuilt from immutable fills and ledger entries. Market/event/research records are immutable revisions with provenance and availability timestamps.

Reads default to Server Components. UI mutations use authenticated Server Actions. Cron, health, and provider-facing boundaries use Route Handlers. `proxy.ts` refreshes Supabase sessions but is not an authorization boundary; protected actions and reads verify the current owner again.

Critical singleton boundaries:

- Only `src/providers/openai/gateway.ts` imports the OpenAI SDK.
- Only the simulation execution service may emit paper fills.
- Exactly one scheduler provider may be active.
- All agent/replay reads flow through point-in-time ports requiring a decision timestamp.

Numeric PostgreSQL values cross the data boundary as strings. Exact calculations use a 50-digit cloned `decimal.js` constructor. Numbers are permitted for UI geometry, token counts, timestamps, and statistical basis-point integers, never financial state.
