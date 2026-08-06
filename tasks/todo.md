# Capital Lab task tracker

The authoritative design and acceptance criteria are in `IMPLEMENTATION_PLAN.md`.

## Plan

### Hosted owner and first live database slice

- [x] Add a server-controlled, one-time owner bootstrap path that uses `OWNER_EMAIL`, never persists a privileged Supabase key in the application, and leaves ongoing authorization in `app_users`.
- [x] Add a safe email/password owner registration state and keep all non-owner identities denied.
- [x] Replace the protected shell, dashboard landing state, and experiment reads with owner-scoped Supabase data when hosted Auth is configured; retain deterministic fixtures only in explicit mock mode.
- [x] Make live empty/read-only states honest: no synthetic experiment, portfolio, scheduler, spend, or control state may be presented as hosted data.
- [x] Extend application, SQL contract, and browser coverage for owner bootstrap, RLS, live mapping, and mock-mode regressions.
- [x] Apply and audit the hosted migration, configure only the non-secret owner bootstrap environment, and verify the protected preview.
- [ ] Publish the verified revision and complete the private confirmation-email owner handoff.

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
- [ ] Integration follow-up: continue replacing the remaining mock-only use cases after owner provisioning; the protected shell, dashboard landing, and experiment list now have owner-scoped Supabase reads.
- [ ] Approve the initial GitHub Actions workflow through an authenticated GitHub web session; GitHub's public-repository workflow protection held the Codex-authored run before any job steps executed.

## Review

- Status: GitHub, hosted Supabase, and a protected Vercel preview are connected; the confirmed-email owner bootstrap is ready but unconsumed, and production promotion remains intentionally pending.
- Starting state: empty directory, no Git repository.
- Available: Node.js 24, corepack, pnpm 10, npm 11, Git.
- Unavailable: Docker and Supabase CLI; local database test execution will require installation.
- External mutations: 14 hosted Supabase migrations, one GitHub root commit on `main`, one Vercel project/Git connection, scoped public environment variables, a preview-only non-secret owner email/bootstrap flag, and two READY previews. No privileged Supabase key, broker, live-market-data, paid OpenAI, agent, scheduler, or production deployment was enabled.
- `pnpm verify`: passed after owner bootstrap, the explicit hosted confirmation return URL, and workspace reads were wired (Prettier, ESLint with zero warnings, strict TypeScript, 21 Vitest files / 65 tests, safety and secret scan, Next.js production build with all required routes).
- `pnpm test:e2e`: passed (4 Chromium critical-flow tests).
- `pnpm audit --prod`: passed with no known production vulnerabilities.
- Hosted database contract: passed `1..700` against rollback-only seed fixtures; the run verified singleton owner binding, exact confirmed-email enforcement, and RLS, then left zero Auth users, owner rows, experiments, or pgTAP extension state behind.
- Hosted database audit: 14 transaction-framed migrations, 78 tables, RLS on all 63 public tables, zero security advisor findings, and only expected unused-index information on the empty database. The owner bootstrap configuration remains intact and unconsumed.
- Vercel preview: deployment `dpl_5G4qSHYSv6F3uTV6ht753KbcxMPY` is READY as Next.js; health reports paper-only/mock/agent-disabled, the first-time owner setup renders without console or framework errors, protected content redirects to the unauthorized login state, cron rejects with 401, and runtime errors are empty. Automatic Git deployments remain disabled pending deliberate production approval.
- GitHub CI: repository Actions are enabled, but the initial public-repository run was held in the queue and canceled before any steps; GitHub requires a collaborator to approve this protected workflow in an authenticated web session.
