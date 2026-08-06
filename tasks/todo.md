# Capital Lab task tracker

The authoritative design and acceptance criteria are in `IMPLEMENTATION_PLAN.md`.

## Plan

### GitHub, Supabase, and Vercel connection

- [x] Inspect connected accounts/projects and local CLI/Git state without mutations.
- [x] Initialize a project-local Git repository for `constantinjanz/Capital-Lab` without touching the unrelated parent repository.
- [x] Apply the hosted Supabase schema, align migration history, generate typed clients, and clear security/unindexed-foreign-key advisor findings.
- [ ] Provision the first hosted owner identity; do not apply the development auth seed to the hosted project.
- [x] Create and link the Vercel project, configure scoped public Supabase variables without installing the unused secret key, and connect GitHub.
- [x] Bootstrap the empty GitHub default branch with the verified code and no committed credentials.
- [x] Deploy and verify a protected preview; leave production unpromoted until the owner identity and reviewed database adapters are ready.

- [x] Inspect workspace, toolchain, governing instructions, and master brief.
- [x] Verify current official platform guidance and package baseline.
- [x] Phase 0: architecture and operating documents.
- [x] Phase 1: Next.js foundation, environment, auth, health, styling, and CI.
- [x] Phase 2: Supabase migrations, ownership/RLS/grants, fixtures, and SQL tests authored.
- [x] Phase 3: decimal simulator, risk, point-in-time integrity, and reconciliation tests.
- [x] Phase 4: mock and data-only provider adapters, ingestion, provenance, and features.
- [x] Phase 5: all dashboard/control-plane routes and accessible UI states.
- [x] Phase 6: AI pricing/budgets, scheduler, idempotency, and fake gateway.
- [x] Phase 7: research import/retrieval, memory, outcomes, and strategy gates.
- [x] Phase 8: Luna/Terra/Sol orchestration with disabled safe defaults.
- [x] Phase 9: application quality gates, security/docs review, and handoff.
- [ ] Infrastructure follow-up: execute the same reset/pgTAP path locally when Docker/Supabase CLI is available (the hosted rollback-only contract passed 686 assertions).
- [ ] Integration follow-up: wire live database use cases after owner provisioning; generated Supabase TypeScript types are already connected to the auth clients.

## Review

- Status: GitHub, hosted Supabase, and a protected Vercel preview are connected; production promotion and owner provisioning remain intentionally pending.
- Starting state: empty directory, no Git repository.
- Available: Node.js 24, corepack, pnpm 10, npm 11, Git.
- Unavailable: Docker and Supabase CLI; local database test execution will require installation.
- External mutations: 12 hosted Supabase migrations, one GitHub root commit on `main`, one Vercel project/Git connection, scoped public environment variables, and one READY preview. No broker, live-market-data, paid OpenAI, agent, scheduler, or production deployment was enabled.
- `pnpm verify`: passed after generated types were wired (Prettier, ESLint with zero warnings, strict TypeScript, 19 Vitest files / 58 tests, safety and secret scan, Next.js production build with all required routes).
- `pnpm test:e2e`: passed (4 Chromium critical-flow tests).
- `pnpm audit --prod`: passed with no known production vulnerabilities.
- Hosted database contract: passed `1..686` against rollback-only seed fixtures; the run left zero Auth users, owner rows, experiments, or pgTAP extension state behind.
- Hosted database audit: 12 transaction-framed migrations, 78 tables, RLS on all 63 public tables, zero security advisor findings, and no unindexed foreign-key findings. The contract run exposed and verified a forward fix for ambiguous quota-counter updates.
- Vercel preview: READY as Next.js; health reports paper-only/mock/agent-disabled, login renders, protected content emits its unauthorized redirect, cron rejects requests, and runtime errors are empty. Automatic Git deployments remain disabled pending deliberate production approval.
