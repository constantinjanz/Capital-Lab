# Capital Lab task tracker

The authoritative design and acceptance criteria are in `IMPLEMENTATION_PLAN.md`.

## Plan

### GitHub, Supabase, and Vercel connection

- [x] Inspect connected accounts/projects and local CLI/Git state without mutations.
- [x] Initialize a project-local Git repository for `constantinjanz/Capital-Lab` without touching the unrelated parent repository.
- [x] Apply the hosted Supabase schema, align migration history, generate typed clients, and clear security/unindexed-foreign-key advisor findings.
- [ ] Provision the first hosted owner identity; do not apply the development auth seed to the hosted project.
- [ ] Link or create the Vercel project, configure scoped environment variables without exposing secrets, and connect GitHub.
- [ ] Publish the verified code through an intentional branch/commit/PR or default-branch bootstrap appropriate to the remote state.
- [ ] Deploy a preview, verify health and critical routes, then report whether production promotion is safe.

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
- [ ] Infrastructure follow-up: execute `supabase db reset` and pgTAP with Docker/Supabase CLI.
- [ ] Integration follow-up: generate Supabase TypeScript types and wire live database use cases after the schema runtime check.

## Review

- Status: local mock-mode foundation complete and verified; database runtime verification remains infrastructure-blocked.
- Starting state: empty directory, no Git repository.
- Available: Node.js 24, corepack, pnpm 10, npm 11, Git.
- Unavailable: Docker and Supabase CLI; local database test execution will require installation.
- External mutations: none. No deployment, remote database mutation, broker call, or paid OpenAI call authorized or performed.
- `pnpm verify`: passed (Prettier, ESLint with zero warnings, strict TypeScript, 19 Vitest files / 58 tests, safety and secret scan, Next.js production build with all required routes).
- `pnpm test:e2e`: passed (4 Chromium critical-flow tests).
- `pnpm audit --prod`: passed with no known production vulnerabilities.
- `pnpm test:db`: exited 2 as designed because Docker is unavailable; 46 pgTAP/static assertions are authored but not runtime-executed.
- Static database audit: 10 transaction-framed migrations, 78 unique tables, owner RLS/grants, five security-invoker views, private security-definer functions with empty search paths and revoked public execution.
