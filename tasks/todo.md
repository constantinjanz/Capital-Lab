# Capital Lab task tracker

The authoritative design and acceptance criteria are in `IMPLEMENTATION_PLAN.md`.

## Plan

### Owner-reviewed hosted market configuration

- [x] Define one fixed, bounded manifest for XNAS/ARCX, SPY/QQQ/AAPL/MSFT/NVDA, exact Alpaca aliases, locked append-only owner universe versions that reuse the exact current version, and one initially disabled Alpaca IEX data-only source/policy.
- [x] Add an atomic owner-only configuration RPC that derives identity from `auth.uid()`, uses a private `SECURITY DEFINER` implementation with a fixed empty search path and public invoker wrapper, serializes setup, records durable idempotency and redacted audit evidence, and rejects conflicting reference metadata.
- [x] Cover owner/non-owner/anonymous access, direct-write denial, same-operation replay, changed-input rejection, conflict rollback, immutable prior universe versions, explicit grants, and a zero-observation post-state with rollback-only pgTAP.
- [x] Add a typed Supabase repository, re-authorizing Server Action, and hosted-only `/markets` setup control with precise failure states while preserving the deterministic mock page unchanged.
- [x] Reconcile generated database types and the implementation/data-source/limitation/security documentation with the already implemented direct Alpaca adapter and the deliberately deferred ingestion/runtime boundaries.
- [ ] Apply and verify the additive migration against the hosted project, confirm the exact five-member disabled-source state and zero quote/bar/session/health/ingestion/scheduler evidence, and review Supabase advisors.
- [ ] Run formatting, lint, strict typecheck, focused/full tests, pgTAP, paper-only/secret scans, production build, mock Playwright journeys, protected Preview verification, and merge only through a green reviewed PR.

Scope guard: this slice makes no Alpaca request, stores no Alpaca or Supabase secret, grants no direct table writes, creates no calendar or market observation, enables no scheduler/agent/provider, and does not promote production. Manual owner-triggered data-only ingestion remains the next separate review slice.

#### Review

- The fixed configuration, owner-only idempotent RPC, typed Server Action/repository, hosted setup control, and database-attested `reviewed_manifest_id` are implemented. The attestation fails closed on reference/member/alias/source/policy/audit drift while remaining separate from future runtime activation authorization.
- Local application verification is green: changed-file formatting, ESLint with zero warnings, strict TypeScript, 33 Vitest files / 185 tests, the paper-only scan, and the Next.js production build. Independent application, SQL, and contract-consistency reviews were addressed.
- Hosted migration validation/application, Supabase post-state/advisor review, clean CI database execution, protected Preview verification, and PR merge remain pending.

### Hosted point-in-time market snapshot

- [x] Add owner-only, read-only Supabase functions for an atomic current configuration scope, universe instruments, completed quote/bar revisions, recent sessions, and provider health at one database-stamped decision timestamp; return every market decimal as exact text and deny anonymous callers explicitly.
- [x] Cover the database contract with pgTAP for owner/non-owner/anonymous access, latest-correction selection, cancelled-record removal, future availability/receipt and incomplete-bar exclusion, exact decimal output, bounded session/source reads, and zero mutations.
- [x] Add strict hosted snapshot mappers and a server-only repository that requests one database-stamped aggregate snapshot, rejects malformed/partial/future or cross-exchange rows, emits sanitized failure classifications, and never falls back to fixtures or calls an external provider.
- [x] Route `/markets` by authenticated data mode and add a separate hosted view with truthful unconfigured/empty/current-day-session/provider-observation states while preserving the deterministic mock page byte-for-byte.
- [x] Apply and verify the additive migration with rollback-only hosted fixtures, regenerate/check database types, review Supabase advisors, and confirm the empty project remains unchanged.
- [x] Run formatting, lint, strict typecheck, focused/full unit and database tests, paper-only/secret scans, the production build, and all mock Playwright journeys.
- [x] Publish through a reviewed GitHub PR, verify CI and a protected Vercel Preview, and merge only if every gate is green.

#### Review

- The additive hosted market migration was exercised against rollback-only fixtures with `1..73` pgTAP assertions, then applied as hosted migration `20260807140239`. The owner receives one database-stamped aggregate row, non-owners fail with `42501`, all five RPCs remain stable security invokers with fixed empty search paths, and anonymous/PUBLIC execution is revoked.
- The hosted database remains empty across universes, instruments, sources, quotes, bars, sessions, and health evidence. Generated types were reconciled with SQL-correct nullable fields. Supabase security advisors remain unchanged with only leaked-password protection disabled; performance advisors contain only expected unused-index information on the empty database.
- Full application verification passed: Prettier, ESLint with zero warnings, strict TypeScript, 29 Vitest files / 144 tests, the paper-only and literal-secret scans, the Next.js production build, four mock Playwright journeys, a visual `/markets` browser check with no overlay/console/page errors, and the production dependency audit with no known vulnerabilities.
- GitHub PR #7 passed the application, database, and browser jobs for both push and pull-request events at application commit `7acb0a0`. Protected Vercel Preview `dpl_Dkcm52JGA3zmznHajSwGwA8FVCp7` is READY at that exact commit after a cold-cache build; health is paper-only with the external market-data feed and agent disabled, the Supabase owner form renders with bootstrap absent, unauthenticated `/markets` access fails closed, and browser/runtime error logs are empty. Production remains unpromoted.

### Hosted draft metadata editing

- [x] Add an owner-only, revision-checked draft-update contract that changes only the normalized name and objective, preserves every execution/configuration field, and uses durable idempotency plus one redacted audit record.
- [x] Expose the exact draft revision in the hosted detail read model and add SQL contract coverage for authorization, validation, stale writes, retries, immutable replay results, direct-write denial, and atomic rollback.
- [x] Add a protected Server Action, typed repository boundary, and hosted-only editor with precise validation and conflict messaging while preserving the deterministic mock experience.
- [x] Apply the additive migration after rollback-only hosted validation, regenerate/check database types, and review Supabase security and performance advisors.
- [x] Run formatting, lint, strict typecheck, unit/database/browser tests, paper-only and secret scans, dependency audit, and the production build.
- [x] Publish through a reviewed GitHub PR, verify CI and the Vercel preview, and merge only if all gates are green.

#### Review

- Additive metadata migration and the reviewed controls-before-experiment lock-order correction applied to Capital-Lab after rollback-only compile/behavior probes. A focused hosted pgTAP transaction passed `1..28`, then rolled back its temporary experiment, audit/idempotency rows, and pgTAP extension; the project remains at zero experiments.
- The hosted contract exposes `draft_revision` as exact text, grants the public security-invoker RPC only to authenticated/service roles, and leaves direct table mutation denied. Same-operation replay, replay after a later edit, stale-write rollback, changed-body rejection, redacted auditing, and preservation of every execution side table were verified.
- Full application verification passed: Prettier, ESLint with zero warnings, strict TypeScript, 27 Vitest files / 127 tests, paper-only safety scan, and the Next.js production build. Four mock Playwright journeys and the production dependency audit also passed. Independent reviews cleared the database security boundary, ambiguous-result reconciliation, and UUID normalization/version handling.
- Supabase generated types match the checked-in revision/view/RPC fields. Security advisors remain unchanged with only the Free-plan leaked-password warning; performance advisors contain only expected unused-index information on the empty database.
- GitHub PR #5 passed both push and pull-request application, database, and browser jobs, then merged as `c4cf042`. Vercel Preview `dpl_6tVtueNuiKawxfkuSjhGDzmim8Vv` is READY at the reviewed source commit after a cold-cache build; hosted owner login renders with setup disabled, unauthenticated experiment access redirects to login, and no runtime warnings or errors were found. The final hosted snapshot retains the controls-before-experiment lock order and zero experiment, update-idempotency, or update-audit rows.

### Hosted draft experiment creation

- [x] Define an owner-only, atomic Supabase draft-creation contract with explicit grants, an exact decimal default, safe paper-only settings, durable idempotency, audit evidence, and an initialized disabled control row.
- [x] Add SQL contract coverage for valid owner creation, anonymous/non-owner denial, invalid input rollback, and persisted read-model precision.
- [x] Add a protected Next.js Server Action and hosted form that validate input, create the draft, surface safe field errors, and redirect to the persisted detail route.
- [x] Preserve the existing deterministic mock flow and update hosted list/detail copy so the new write boundary is truthful.
- [x] Apply the migration to Capital-Lab, regenerate/check database types, run advisors, and verify the hosted owner authorization and protected browser boundaries.
- [x] Run formatting, lint, typecheck, unit, database, browser, audit, and production-build gates; document the review results before publishing.

#### Review

- Hosted creation and idempotent-replay migrations applied after rollback-only validation. A create/edit/retry verification returned the original UUID with one lifecycle event and one audit record, then rolled back; the project remains at zero experiments.
- Focused boundary tests: 4 files and 23 tests passed. Full application suite: 26 files and 92 tests passed. Lint, typecheck, paper-only safety scan, production build, production dependency audit, and four mock Playwright journeys passed.
- Hosted generated types match the checked-in RPC contract. Authenticated execution remains granted, anonymous execution is denied, and no verification experiment, idempotency row, or audit row remains.
- Post-migration security advisors remain unchanged: only the Supabase Pro-plan leaked-password warning is open.
- GitHub PR #4 passed both application, database, and browser jobs for the push and pull-request events. Vercel preview `dpl_82Gowd43b66Z9NzrPMSbe6c3ajMT` is READY at the reviewed commit with no runtime errors; the owner login rendered and an unauthenticated experiment request failed closed. No privileged sign-in link was generated and no permanent draft was created for visual testing.

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
