# Capital Lab repository instructions

## Safety first

- This repository is permanently PAPER TRADING ONLY.
- Never add broker order endpoints, brokerage account linking, trading SDK clients, or real brokerage credential variables.
- Only `src/providers/openai/gateway.ts` may import the OpenAI SDK.
- Only a simulation execution service may create fills or ledger entries.
- Keep paid AI, Sol, web search, and live market data disabled by default.
- Never use JavaScript numbers for money, prices, quantities, P&L, fees, FX, margin, or AI cost. Use canonical decimal strings and the financial decimal wrapper.
- Every historical context query must require `decisionAt` and enforce `availableAt <= decisionAt`.

## Workflow

1. Read `IMPLEMENTATION_PLAN.md` and `tasks/lessons.md` before non-trivial changes.
2. Track work in `tasks/todo.md` and record exact verification results.
3. Preserve domain boundaries: pure `src/domain` code cannot import React, Next.js, Supabase, or OpenAI.
4. Treat Route Handlers and Server Actions as public security boundaries and verify the owner inside them.
5. Use migrations as the Supabase schema source of truth. Exposed tables require RLS and explicit grants.
6. Run the narrowest relevant test while iterating, then `pnpm verify` before handoff.
7. After a user correction, add the reusable prevention rule to `tasks/lessons.md`.

## Commands

- `pnpm dev` — local app with deterministic mock defaults.
- `pnpm lint` — zero-warning ESLint gate.
- `pnpm typecheck` — strict TypeScript gate.
- `pnpm test` — Vitest unit/integration suite.
- `pnpm test:safety` — forbidden broker path scan.
- `pnpm test:db` — local Supabase reset and pgTAP tests; requires Docker and Supabase CLI.
- `pnpm test:e2e` — Playwright critical flows; install Chromium first.
- `pnpm build` — production Next.js build.
- `pnpm verify` — application quality gates excluding infrastructure-dependent DB/E2E tests.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
