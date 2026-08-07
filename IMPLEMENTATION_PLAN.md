# Capital Lab implementation plan

## Mission and safety envelope

Capital Lab is a private, single-owner paper-trading research laboratory. It must run locally with deterministic mock data and no paid credentials. The repository must never contain broker execution code, real brokerage credential variables, or a path that can create a real trade. AI, web research, and live market data remain disabled by default.

Safe defaults:

```dotenv
AGENT_ENABLED=false
AGENT_EXECUTION_MODE=shadow
SOL_ENABLED=false
OPENAI_WEB_SEARCH_ENABLED=false
MARKET_DATA_PROVIDER=mock
```

All financial quantities use `decimal.js` in TypeScript and `numeric` in PostgreSQL. All point-in-time reads require a decision timestamp and enforce `available_at <= decision_at`. External content is sanitized, delimited, provenance-bearing untrusted evidence.

## Verified implementation baseline

- Empty starting workspace; no existing user files to preserve.
- Node.js 24 and pnpm 10 are available.
- Docker is not available for a local Supabase reset, so local application verification uses deterministic mock mode. Hosted migrations and rollback-only pgTAP probes are recorded separately from the infrastructure-dependent local database gate.
- Next.js App Router with Node runtime, strict TypeScript, Tailwind CSS, shadcn/ui source components, Supabase SSR, OpenAI Responses API behind one gateway, Vitest, and Playwright.
- Checked-in manual and cron routes run only the bounded mock-safe cycle. Hosted market-cycle routes fail closed until reviewed ingestion, calendar, idempotency, and concurrency wiring exists; no remote scheduler is enabled.

## Architecture boundaries

- `src/domain/**`: pure deterministic financial, budget, risk, point-in-time, and memory rules; no React, Next.js, Supabase, or OpenAI imports.
- `src/providers/**`: typed external-service adapters. Alpaca adapters use only `data.alpaca.markets` and never import a brokerage client.
- `src/lib/**`: environment, auth, persistence, logging, security, time, and application composition.
- `src/features/**`: use cases that orchestrate domain ports.
- `src/app/**`: Server Component reads, authenticated Server Actions for UI mutations, and Route Handlers for cron/provider APIs.
- `supabase/**`: reproducible schema, seed data, grants/RLS, private privileged functions, and SQL tests.
- `research/**`: untrusted import staging and documented templates.

## Phases and acceptance criteria

### Phase 0 — discovery and design

- [x] Inspect repository state and toolchain.
- [x] Read governing instructions and applicable skills.
- [x] Review current official Next.js, Supabase, Vercel Cron, OpenAI, and Alpaca guidance.
- [x] Record the phased plan and acceptance criteria.
- [x] Create architecture, experiment rules, point-in-time, security, cost, research, deployment, runbook, data-source, and limitation documents.

Acceptance: build decisions, safety boundaries, dependency baseline, and known local constraints are explicit before implementation.

### Phase 1 — application foundation

- [x] Initialize Next.js App Router with strict TypeScript, Tailwind CSS, pnpm lockfile, ESLint, and Prettier.
- [x] Add shadcn-style accessible primitives, Geist typography, Lucide icons, and dark research-lab tokens.
- [x] Add Zod environment validation with separated public/server variables and safe mock defaults.
- [x] Add Supabase browser/server clients, session refresh proxy, owner authorization checks, login/logout, protected routes, and a public minimal health endpoint.
- [x] Add structured logging, error/loading/not-found surfaces, GitHub Actions, and repository safety scans.

Acceptance: the app boots without credentials, public routes are limited to login and health, protected mutations verify ownership server-side, and basic lint/typecheck/build gates exist.

### Phase 2 — schema, ownership, and persistence

- [x] Create normalized tables for users, experiments, market state, events, simulation accounting, AI cost/routing, knowledge/memory, audit, and operations.
- [x] Create private schemas/functions for atomic budget reservation, experiment lifecycle, append-only ledger enforcement, reconciliation helpers, and scheduler locking.
- [x] Enable RLS on every exposed table; add owner predicates, paired `USING`/`WITH CHECK`, explicit grants, security-invoker views, revoked default function execute rights, and indexed foreign keys/filters.
- [x] Add idempotency/immutability constraints and effective-dated model pricing.
- [x] Add deterministic seed fixtures and SQL tests for schema, grants, RLS, functions, concurrency, and immutability.

Acceptance: migrations are reproducible and auditable; anonymous and non-owner access is denied; no privileged function is exposed by default.

### Phase 3 — deterministic simulator and point-in-time core

- [x] Implement typed money/price/quantity primitives and rounding/FX rules with `decimal.js`.
- [x] Implement order state transitions, quote-first fills, conservative bar fills, latency, partial fills, commissions/fees, slippage, and market/session checks.
- [x] Implement long/short lots, realized/unrealized P&L, cash ledger entries, positions, exposure, buying power, margin, borrow costs, dividends, splits, margin calls, and paper liquidation.
- [x] Implement proposal sizing and risk checks outside the model.
- [x] Implement reusable point-in-time filters and reconciliation.
- [x] Add table-driven unit/integration tests including anti-lookahead and duplicate-delivery attempts.

Acceptance: the ledger reconciles; impossible/stale/lookahead fills are rejected; deterministic inputs produce deterministic outputs.

### Phase 4 — market and public-event data

- [x] Define market/news/research provider ports and deterministic mock implementations.
- [x] Add a direct Alpaca Market Data HTTP adapter skeleton restricted to the data host and stock latest-quote and historical-bar endpoints; it has no broker client or order method.
- [x] Add one owner-reviewed hosted reference manifest for XNAS/ARCX and SPY/QQQ/AAPL/MSFT/NVDA with exact Alpaca aliases, locked append-only owner universe versions, and one initially disabled Alpaca IEX source/policy. An exact current version is reused; a later unrelated current universe causes a new immutable version to be appended without changing separately reviewed lifecycle state. Configuration stores no provider credential and creates no observation, session, ingestion, or scheduler evidence.
- [x] Harden the Alpaca adapter for hosted use with raw/as-of historical semantics, pagination, redirect/timeout policy, bounded input and response validation, provider request IDs, persistence-stamped availability times, and sanitized typed failures.
- [x] Add allowlisted SEC/Fed/BLS/White House/company-RSS adapter scaffolds with explicit user-agent, rate-limit, provenance, retention, and sanitization policy.
- [x] Add disabled official social-provider interface; no authenticated scraping.
- [x] Add ingestion idempotency, revision history, source health, content hashing/deduplication, and deterministic features. Hosted feature inputs are the latest 21 eligible completed one-minute logical bar revisions per configured feed at the snapshot decision timestamp; pure Decimal.js code emits versioned exact-string spread, return, relative-volume, realized-volatility, SMA-distance, and typical-price-VWAP-distance values without a provider request.

Acceptance: deterministic mock mode remains the default. Initial application of the hosted manifest performs no provider request and creates Alpaca disabled with zero market observations; later universe-only application preserves rather than changes activation state. Manual owner-triggered IEX ingestion is a separate explicit action with server-only credentials, bounded provider access, idempotent persistence, and no scheduler/agent/order side effects. Deterministic feature reads share the hosted snapshot's owner and database-stamped decision boundary, preserve financial values as exact text, reject correction/cancellation lookahead, and leave insufficient or non-contiguous history unavailable. Live calendar integration, scheduler finalization, decision-cycle wiring, and production activation remain separate reviewed slices.

### Phase 5 — dashboard and control plane

- [x] Implement login, dashboard, experiments/detail, markets, events, agent, memory, research, costs, and settings routes.
- [x] Add persistent PAPER TRADING ONLY badge, experiment selector/status, market/data/agent/scheduler state, budget meters, and emergency pause.
- [x] Add dashboard metrics, equity/benchmark chart, positions, decisions, fills, events, source health, risk state, and cost/runway views.
- [ ] Add lifecycle actions for draft, replay, shadow, explicit live-paper promotion, pause/resume, completion, and clone.
  - [x] Add owner-only, revision-checked, idempotent controls for explicit shadow-to-live-paper simulation promotion, pause, resume, completion, and clone-to-disabled-draft, with immutable provenance/evidence and no scheduler, agent, broker, or execution side effects.
  - [ ] Add draft-to-replay/shadow start only after the complete owner-reviewed simulator, risk, routing, data-source, prompt/corpus, budget, universe, and official-calendar manifest can be locked atomically.
- [x] Provide polished loading, empty, error, disconnected, responsive, keyboard, focus, and contrast states.

Acceptance: seeded mock data renders all required routes and control states; no control can enable real trading.

### Phase 6 — AI budget and scheduling

- [x] Implement effective-dated pricing and exact daily/monthly/lifetime decimal cost calculations.
- [x] Implement atomic worst-case reservations, settlement/release/unknown states, 70/90/100% alerts, and auto-pause rules.
- [ ] Add scheduler provider selection, secured market-cycle handler, New York market-session checks, unique 15-minute slot keys, overlap protection, and duplicate result reuse.
- [x] Add fake OpenAI gateway and scheduler integration tests without paid calls.

Acceptance: concurrent reservations cannot overspend; closed/no-event/disabled/budget-exhausted paths make no model call; retries cannot duplicate financial or AI charges.

### Phase 7 — knowledge and memory

- [x] Implement Markdown, JSON strategy-card, and CSV source-registry preview/commit importers.
- [x] Add sanitization, deterministic chunking, hashes, versioning, duplicate detection, corpus versions, full-text/vector-ready retrieval, and deterministic test embeddings.
- [ ] Add immutable decision contexts, outcome labels, confidence/source/category statistics, pattern lifecycle, and champion/challenger promotion gates.

Acceptance: retrieval is point-in-time safe and provenance-bearing; patterns cannot self-promote or rewrite controls.

### Phase 8 — structured agent orchestration

- [x] Implement exactly one OpenAI SDK gateway with fake and disabled modes.
- [x] Add versioned Luna/Terra/Sol prompts, Zod structured schemas, typed read tools, evidence IDs, and untrusted-content delimiters.
- [ ] Enforce routing caps, optional guarded web research, shadow-only proposals, and explicit live-paper simulation path.
- [ ] Persist concise rationale/scenarios/evidence without hidden chain-of-thought.

Acceptance: the model cannot write fills/ledger entries; all reads enforce owner and decision time; real calls remain disabled.

### Phase 9 — verification and handoff

- [x] Run formatting, lint, strict typecheck, unit/integration tests, build, forbidden-path scan, and secret scan.
- [x] Run database tests and Playwright critical flows when their infrastructure is available; document exact blockers otherwise.
- [x] Review dependency advisories, RLS/function security, logs, safe defaults, accessibility, and docs.
- [x] Add final results and known limitations to this plan and `tasks/todo.md`.

Acceptance: every claimed gate has an exact recorded result, mock mode is runnable, no secret is committed, and paid/runtime agent behavior stays disabled.

## Review record

Completed 2026-08-06:

- `pnpm verify` passed: formatting, zero-warning lint, strict typecheck, 19 Vitest files / 58 tests, repository safety/secret scan, and a Next.js 16.3 production build with every required route.
- `pnpm test:e2e` passed: 4 Chromium stories covering mock owner login/rejection, dashboard and experiment controls, a zero-model/zero-order manual cycle, agent/cost inspection, emergency pause, and research preview/commit.
- `pnpm audit --prod` reported no known production vulnerabilities.
- `pnpm test:db` exited 2 because Docker is unavailable. Ten transaction-framed migrations, deterministic seed data, and 46 pgTAP/static assertions were authored; no database-runtime pass is claimed.
- Static SQL review found 78 unique tables, owner-only forced RLS, no grants to `anon`, five security-invoker views, empty search paths on private security-definer functions, and revoked default execution.
- No deployment, remote database mutation, live provider call, broker call, or paid OpenAI call was made. Agent, Sol, web research, and live-paper runtime behavior remain disabled.
- See `docs/KNOWN_LIMITATIONS.md` for the deliberately deferred database adapter/type generation and durable runtime-cycle wiring that must follow the first successful local database reset.
