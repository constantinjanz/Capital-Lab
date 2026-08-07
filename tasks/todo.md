# Capital Lab task tracker

The authoritative design and acceptance criteria are in `IMPLEMENTATION_PLAN.md`.

## Plan

### Owner lock and hosted experiment detail

- [x] Verify the confirmed hosted identity is the single active application owner and the database bootstrap is consumed.
- [x] Disable the application owner-setup flag, deploy the locked Preview, and verify sign-in remains while setup is absent.
- [x] Merge the verified owner/bootstrap revision through GitHub PR #1 and synchronize `main`.
- [x] Disable project-level public signup in Supabase Auth and verify after reload that signup, manual linking, and anonymous sign-in remain off while email confirmation remains on.
- [x] Add an owner-RLS-backed `security_invoker` experiment-detail read view with exact decimal/bigint strings, explicit grants, and its supporting index.
- [x] Replace the hosted experiment-detail 404 with a read-only Supabase repository, strict mapper, honest empty states, persisted status timeline, and mock-mode preservation.
- [x] Remove adjacent hosted fabrications: unknown AI spend, missing controls shown as off, mock-specific 404 copy, and hosted manual-cycle execution.
- [x] Extend SQL/application/browser contracts, apply and audit the hosted migration, and publish a protected Preview for the next review PR.

### Hosted owner and first live database slice

- [x] Add a server-controlled, one-time owner bootstrap path that uses `OWNER_EMAIL`, never persists a privileged Supabase key in the application, and leaves ongoing authorization in `app_users`.
- [x] Add a safe email/password owner registration state and keep all non-owner identities denied.
- [x] Replace the protected shell, dashboard landing state, and experiment reads with owner-scoped Supabase data when hosted Auth is configured; retain deterministic fixtures only in explicit mock mode.
- [x] Make live empty/read-only states honest: no synthetic experiment, portfolio, scheduler, spend, or control state may be presented as hosted data.
- [x] Extend application, SQL contract, and browser coverage for owner bootstrap, RLS, live mapping, and mock-mode regressions.
- [x] Apply and audit the hosted migration, configure only the non-secret owner bootstrap environment, and verify the protected preview.
- [x] Publish the verified revision and complete the private confirmation-email owner handoff.

### GitHub, Supabase, and Vercel connection

- [x] Inspect connected accounts/projects and local CLI/Git state without mutations.
- [x] Initialize a project-local Git repository for `constantinjanz/Capital-Lab` without touching the unrelated parent repository.
- [x] Apply the hosted Supabase schema, align migration history, generate typed clients, and clear security/unindexed-foreign-key advisor findings.
- [x] Provision the first hosted owner identity; do not apply the development auth seed to the hosted project.
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
- [ ] Infrastructure follow-up: execute the same reset/pgTAP path locally when Docker/Supabase CLI is available (the hosted rollback-only contract passed 700 assertions).
- [ ] Integration follow-up: continue replacing the remaining mock-only use cases after owner provisioning; the protected shell, dashboard landing, and experiment list now have owner-scoped Supabase reads.
- [ ] Approve the initial GitHub Actions workflow through an authenticated GitHub web session; GitHub's public-repository workflow protection held the Codex-authored run before any job steps executed.

## Review

- Status: GitHub, hosted Supabase, and protected Vercel previews are connected; the confirmed identity is the single active owner, both application bootstrap and project-level signup are disabled, PRs #1 and #2 are merged, and production promotion remains intentionally pending while the remaining hosted adapters and write paths are built and reviewed.
- Starting state: empty directory, no Git repository.
- Available: Node.js 24, corepack, pnpm 10, npm 11, Git.
- Unavailable: Docker and Supabase CLI; local database test execution will require installation.
- External mutations: 15 hosted Supabase migrations, the GitHub root history plus merged PR #1 on `main`, one Vercel project/Git connection, scoped public environment variables, a preview-only non-secret owner email/bootstrap/base URL configuration, and six READY previews. No privileged Supabase key, broker, live-market-data, paid OpenAI, agent, scheduler, or production deployment was enabled.
- `pnpm verify`: passed after the exact-string hosted experiment-detail slice was wired (Prettier, ESLint with zero warnings, strict TypeScript, 22 Vitest files / 69 tests, safety and secret scan, Next.js production build with all required routes).
- `pnpm test:e2e`: passed (4 Chromium critical-flow tests).
- `pnpm audit --prod`: passed with no known production vulnerabilities.
- Hosted database contract: passed `1..700` against rollback-only seed fixtures; the run verified singleton owner binding, exact confirmed-email enforcement, and RLS, then left zero Auth users, owner rows, experiments, or pgTAP extension state behind.
- Hosted database audit: 15 transaction-framed migrations, 78 tables, RLS on all 63 public tables, a `security_invoker` experiment-detail view with explicit grants, exact decimal/bigint rollback checks, and only expected unused-index information. The owner bootstrap configuration is consumed by the one confirmed active owner. The Auth advisor still warns that leaked-password protection is disabled.
- Vercel preview: deployment `dpl_2bbGoCxcY23LNjGE1uZbxHWXF4Y1` is READY as Next.js at `capital-juq9mv4u7-constantinjanz-7876s-projects.vercel.app`; Vercel Authentication protects workspace probes, the application owner-setup flow remains absent, and deployment-specific error logs are empty. Automatic Git deployments remain disabled pending deliberate production approval.
- GitHub CI: repository Actions are enabled, but the initial public-repository run was held in the queue and canceled before any steps; GitHub requires a collaborator to approve this protected workflow in an authenticated web session.
