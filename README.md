# Capital Lab

> **PAPER TRADING ONLY — scientific and entertainment use, not financial advice.**

Capital Lab is a private, single-owner AI paper-trading research laboratory. It combines deterministic simulated execution, point-in-time market/event evidence, strict risk and OpenAI budget controls, persistent research/memory, and a dense observability dashboard. It contains no broker execution path and is safe-by-default in synthetic mock mode.

## Safe local start

Requirements: Node.js 22+ and pnpm 10. Docker is optional unless you want the local Supabase stack.

```powershell
Copy-Item .env.example .env.local
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). With the example defaults, Supabase, Alpaca, and OpenAI credentials are not required. The interface is visibly labeled `SYNTHETIC MOCK DATA`, the agent is disabled, and no paid call is made.

## Quality gates

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:safety
pnpm build
```

Database verification additionally requires Docker Desktop and the Supabase CLI:

```powershell
supabase start
pnpm test:db
```

Playwright requires a browser binary:

```powershell
pnpm exec playwright install chromium
pnpm test:e2e
```

## Architecture at a glance

- `src/domain` — pure deterministic finance, simulation, risk, budget, agent-schema, point-in-time, and memory rules.
- `src/features` — application use cases and orchestration.
- `src/providers` — mock/live ports for market data, events, embeddings, and the single OpenAI gateway.
- `src/app` — Next.js App Router pages, authenticated actions, health/manual/cron handlers.
- `supabase` — forward-only migrations, explicit grants/RLS, seed fixtures, and pgTAP assertions.
- `research` — import templates; external text remains untrusted evidence.
- `docs` — architecture, rules, security, point-in-time, cost, deployment, and operations details.

## Environment configuration

See `.env.example`. Never expose server credentials through `NEXT_PUBLIC_` variables.

Live Supabase auth requires the public URL/publishable key pair. The first-owner flow uses server-only `OWNER_EMAIL` plus `OWNER_BOOTSTRAP_ENABLED=true`: the pre-authorized person creates an email/password account, confirms the email, and signs in. A guarded database RPC then atomically binds that confirmed Auth identity to the singleton `app_users` row. Set the expected email separately in `private.owner_bootstrap_config`, turn the bootstrap flag off after the first successful sign-in, and disable new-user signups in the hosted Supabase Auth settings. The application flag only hides and rejects its own registration action; it does not change the project-level Auth setting. Ongoing authorization comes from `app_users`, never editable user metadata. The Supabase secret key is not required by this flow and must never be exposed through a `NEXT_PUBLIC_` variable.

The Alpaca integration is a data-only latest-quote and completed raw one-minute-bar adapter restricted to `https://data.alpaca.markets`; it has no brokerage client or order-forwarding endpoint. Hosted setup creates a disabled `alpaca_iex` reference source. A separately authenticated owner action may enable that exact IEX source and run one bounded five-symbol batch when server-only Alpaca Market Data credentials are present, `MARKET_DATA_PROVIDER=alpaca`, `ALPACA_DATA_FEED=iex`, `SCHEDULER_PROVIDER=manual`, and the agent is disabled. A separate owner-reviewed calendar action persists the fixed official 2026 XNAS/ARCX regular-session manifest from the Nasdaq Trader and NYSE calendars; its two provenance sources stay disabled and it performs no runtime website request. Mock remains the default, page loads never contact Alpaca or an exchange site, and neither action enables a scheduler, AI, account, or order API.

OpenAI remains off until all of the following are deliberately configured:

```dotenv
OPENAI_API_KEY=...
AGENT_ENABLED=true
AGENT_EXECUTION_MODE=shadow
```

Keep `AGENT_EXECUTION_MODE=shadow`, `SOL_ENABLED=false`, and `OPENAI_WEB_SEARCH_ENABLED=false` during initial review. All model calls reserve worst-case cost before leaving the database and settle actual usage afterward.

## Research imports

- Markdown research documents use `research/templates/research-note.md`.
- Strategy cards use `research/templates/strategy-card.json`.
- Source allowlists use `research/templates/source-registry.csv`.

Imports support preview before commit, content hashes, deterministic chunks, duplicate detection, provenance, corpus versions, and `available_at` filtering. Synthetic fixtures are never displayed as live evidence.

## Scheduler

Exactly one provider may be active: `manual`, `vercel`, or `supabase`. The checked-in deployment keeps remote scheduling disabled. An authenticated owner may explicitly submit the reviewed manual hosted envelope for an active replay/shadow experiment; the database checks the locked 2026 XNAS/ARCX session, serializes one 15-minute slot, and persists only a skipped scheduler/simulator journal because provider runtime, AI, orders, fills, positions, and financial writes remain off. Vercel or Supabase scheduling requires a later reviewed activation; never enable both.

## Important limitations

The initial build is deliberately review-first: no remote deployment, no remote database mutation, no paid AI call, no live broker integration, and no complex asset trading. See `docs/KNOWN_LIMITATIONS.md` for the complete list.
