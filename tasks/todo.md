# Capital Lab task tracker

The authoritative design and acceptance criteria are in `IMPLEMENTATION_PLAN.md`.

## Plan

### Hosted evidence statistics and reviewed pattern gates

- [x] Define one owner-only, bounded `decisionAt` learning snapshot for confidence calibration, decision categories, evidence kinds, evaluated outcome horizons, and current pattern/strategy readiness.
- [x] Return every rate, return, excursion, allocation, and threshold as an exact decimal string; exclude decisions, citations, outcomes, patterns, and assignments that were not available at the requested decision boundary.
- [x] Replace JavaScript financial-number promotion inputs with exact decimal values and a fixed versioned policy; require independent linked outcomes, positive benchmark-relative evidence, bounded adverse excursion, and an explicit holdout result before eligibility.
- [x] Add owner-reviewed pattern lifecycle actions with durable idempotency and audit evidence, while preventing self-promotion, direct table writes, active strategy assignment, or allocation changes.
- [x] Add strict application mapping, a server-only repository, and truthful hosted `/memory` statistics/review states while preserving deterministic mock mode.
- [x] Cover owner/non-owner/anonymous access, grants/search paths, point-in-time exclusion, exact decimals, sparse/empty evidence, idempotent review, deterministic gate failure reasons, and zero AI/provider/scheduler/order/fill/ledger side effects with pgTAP and application tests.
- [x] Run complete application/database/browser release gates, reconcile hosted types/advisors, and publish through a protected Preview and reviewed PR without enabling agents, paid calls, providers, scheduling, strategy allocation, or Production.

Scope guard: this slice measures immutable hosted paper evidence and records explicit owner review of pattern lifecycle only. It cannot call a model/provider, create or modify a strategy assignment, allocate capital, enable a runtime control, create an order/fill, mutate positions/ledger/P&L, or promote Production.

#### Review

- Existing schema audit: authenticated owners can read owner-scoped pattern, evidence, strategy-version, and assignment rows through forced RLS, but cannot write them directly. No hosted pattern review RPC or point-in-time aggregate existed, and the prior pure promotion helper accepted financial evidence as JavaScript basis-point numbers.
- The additive migration compiles against the hosted Capital-Lab schema. Its combined rollback-only rehearsal passes all 39 pgTAP assertions, including a regression check that a later lifecycle review cannot leak into an earlier learning snapshot. A post-rollback audit confirms that the functions and index are absent, so no rehearsal state persisted.
- Focused application verification passes 10 files / 64 tests. Repository-wide zero-warning lint, strict TypeScript, 61 files / 491 tests, the PAPER TRADING ONLY scan, and the Next.js 16.3 production build all pass.
- The exact `pnpm verify` sequence reaches only the known local OneDrive formatting condition: Prettier reports 17 unrelated market-ingestion files whose line endings differ in this Windows working tree while Git reports no content diff. Intended-slice formatting and `git diff --check` pass; clean-checkout CI remains the full formatter authority.
- Next.js and React boundary review keeps both independent historical reads parallel, authenticates and authorizes inside the Server Action, retains server-only Supabase access, and serializes only strings, booleans, bounded arrays, and lifecycle-available operation IDs to the client.
- GitHub PR #18 CI run 96 is green at exact application commit `4d8854b`: clean-checkout formatting, zero-warning lint, strict TypeScript, all 491 Vitest tests, the paper-only scan, the Next.js build, all Chromium journeys, a fresh Supabase start/reset, and every pgTAP file passed.
- Hosted migration `20260808204019` is applied to Capital-Lab. Its rollback-only rehearsal and hosted pgTAP suite pass all 39 assertions; generated types match, the five functions retain fixed empty search paths and least-privilege grants, security advisors retain only the known leaked-password-protection warning, and performance findings remain informational unused-index notices.
- Protected Vercel Preview `dpl_6GhNStW2ddTcnJHV78PzUvw6uKjp` is READY as Next.js at exact application commit `4d8854b` with no Production target. The authenticated owner `/memory` route renders the hosted decision boundary, exact-decimal statistics, and honest zero-data states; browser diagnostics are empty and exact-deployment runtime logs contain only successful `200`/`204` requests with no warning, error, or fatal entries.
- The hosted project still has zero pattern hypotheses, strategy assignments, agent runs, agent decisions, orders, and fills. The one pre-existing opening cash-ledger entry is unchanged; market ingestion, scheduler, agents, paid calls, providers, brokerage connections, strategy allocation, and Production remain disabled.

### Immutable hosted decision memory

- [x] Enforce owner, experiment, version, portfolio, run, and decision-time alignment for every new immutable decision context and decision.
- [x] Enforce deterministic outcome chronology and exact excursion-sign invariants without weakening append-only evidence.
- [x] Add one bounded owner-only `decisionAt` read contract that returns exact financial values as text and excludes future evidence at every layer.
- [x] Add strict application mapping, a server-only repository, and a truthful hosted `/memory` view while preserving deterministic mock mode.
- [x] Cover authorization, grants, fixed search paths, lookahead exclusion, exact decimals, immutability, scope drift, and empty hosted state with pgTAP and application tests.
- [x] Run complete application/database/browser release gates, reconcile hosted types/advisors, and publish through a protected Preview and reviewed PR without enabling agents, AI, providers, orders, fills, or Production.

Scope guard: this slice reads and validates persisted paper-only decision evidence. It cannot create a decision, call a model/provider, promote a pattern or strategy, enable a runtime control, or create an order, fill, position, ledger entry, or P&L mutation.

#### Review

- The additive migration and self-contained pgTAP test pass all 33 assertions against the hosted Capital-Lab schema inside a rollback-only transaction. A post-rollback audit confirms that the read function and new indexes are absent, so the rehearsal retained no schema or fixture state.
- The application boundary is green: slice formatting, zero-warning repository ESLint, strict TypeScript, 54 Vitest files / 442 tests, the PAPER TRADING ONLY scan, and the Next.js 16.3 production build all pass. The repository-wide formatter reports only the same 17 untouched OneDrive line-ending files recorded by the prior release.
- The hosted page remains a Server Component with a server-only repository and a strict second owner/time/link/exact-decimal validation layer. React best-practices review found no client state, hydration boundary, serialized credential, or render waterfall.
- The public read is stable, security-invoker, fixed-search-path, bounded to 100 contexts and 100 citations per decision, executable only by `authenticated`, and backed by forced RLS. It provides no mutation or pattern-promotion action.
- GitHub PR #17 CI run 91 is green at exact application commit `f5ccae9`: clean-checkout formatting, zero-warning lint, strict TypeScript, all 442 Vitest tests, the paper-only scan, the Next.js build, all Chromium journeys, a fresh Supabase start/reset, and every pgTAP file passed. The first database run exposed the synthetic experiment version's default present-day `created_at`; the seed now records its canonical historical creation time without weakening the production point-in-time invariant.
- Hosted migration `20260808193957` is applied to Capital-Lab. Generated hosted types match the checked-in memory RPC signature; the function remains stable, security-invoker, fixed-empty-search-path, granted only to `authenticated`, and backed by all four owner/timeline indexes. Security advisors retain only the known leaked-password-protection warning, and performance findings remain informational unused-index notices.
- Protected Vercel Preview `dpl_8oQ4DZ6bsiMrTHjKbKxidGqwUPSf` is READY as Next.js at exact commit `f5ccae9` with no Production target. The authenticated owner `/memory` route renders the database decision boundary and honest zero contexts, decisions, citations, and outcomes; browser diagnostics are empty and deployment runtime logs contain only successful `200`/`204` requests with no warning/error entries.
- The hosted project still has zero decision contexts, agent decisions, decision evidence, trade outcomes, orders, and fills. The one pre-existing opening cash-ledger entry is unchanged; market ingestion, scheduler, agents, paid calls, broker connections, and pattern promotion remain disabled, and Production remains unpromoted.

### Durable owner-triggered paper cycle envelope

- [x] Define one manual-only hosted scheduler contract with a database-stamped decision boundary, fixed 15-minute slots, official-calendar checks, overlap exclusion, and exact duplicate-result reuse.
- [x] Require the authenticated owner, current control revision, active replay/shadow lifecycle, active paper account, locked reviewed manifests, and scheduler/agent/emergency controls off.
- [x] Persist only sanitized scheduler and skipped-simulator evidence while provider requests, ingestion, AI reservations/calls, decisions, orders, fills, positions, and ledger writes remain impossible.
- [x] Add a strict state/read projection, typed repository, re-authorizing Server Action, and hosted experiment control with exact confirmation and unknown-result guidance.
- [x] Cover grants, owner/non-owner/anonymous access, stale inputs, same-operation and same-slot retries, market-closed/runtime-disabled paths, immutable evidence, and zero financial/AI/provider side effects with pgTAP and application tests.
- [x] Reconcile generated types and scheduling/security/runbook/limitation documentation, then run complete application/database/browser release gates before a protected Preview and reviewed merge.

Scope guard: this slice finalizes only the durable manual scheduling envelope and a skipped simulator-run journal. It cannot enable a remote scheduler, fetch market data, call a model, reserve AI budget, create a proposal/order/fill, or mutate cash, positions, or P&L.

#### Review

- The additive migration compiles against the hosted Capital-Lab schema, and the combined rollback-only rehearsal passes all 55 pgTAP assertions without retaining a function, row, or fixture.
- Application gates pass: zero-warning ESLint, strict TypeScript, 52 Vitest files / 429 tests, the PAPER TRADING ONLY scan, the Next.js 16.3 production build, all four mock Chromium journeys, slice formatting, and `git diff --check`. The repository-wide local formatter reports only 17 untouched Windows-checkout line-ending files; clean-checkout CI remains the authoritative full formatting gate. Docker is unavailable locally, so the fresh reset/every-pgTAP gate remains for CI; the hosted-schema rollback rehearsal covers all 55 new assertions.
- The public functions are fixed-search-path security invokers over private fixed-search-path definers. Authenticated callers retain no direct scheduler/simulator inserts, and anonymous/PUBLIC/service-role function execution is denied.
- Two reviewed replay boundaries create exactly two skipped slots/runs and two skipped simulator journals. Exact operation retries and same-slot duplicate deliveries reuse immutable IDs; ingestion, source health, quotes, bars, agents, AI reservations/usage, decisions, orders, fills, ledger, position, and portfolio/P&L counts remain unchanged.
- Hosted migration `20260808181247` is applied to Capital-Lab. Generated hosted RPC types match the checked-in state/run contracts; all five functions retain fixed empty search paths, the public wrappers remain security invokers, and only `authenticated` has execution while owner identity is rechecked inside the private definers. Supabase advisors report no new schema security finding: leaked-password protection remains the one project-level warning, and unused-index notices remain informational.
- GitHub PR #16 passed the clean-checkout application, browser, database, Vercel, and Preview-comment checks for both push and pull-request events at commit `d2ded11`. Vercel Preview `dpl_41gZPMB3o7Tvv7XTaccew5sVfVja` is READY as Next.js at that exact commit; the protected owner UI renders with scheduler, agent, market ingestion, paid calls, and broker connections disabled.
- The authenticated Preview action recorded scheduler run `cfac7702-d0b5-4a19-8ece-76309d962661`, simulator journal `c8c63901-b38b-49d3-b8fa-0db2c2b9ae60`, and one manual slot at the database-stamped `2026-08-08T18:26:37.796476Z` boundary. The closed Saturday session returned `market_closed`; the UI and database agree on the durable IDs and safe-skip result.
- The immediate before/after hosted audit changed only scheduler slots/runs, simulator journals, idempotency, and redacted audit rows from zero/four baselines by exactly one. Ingestion, source health, quotes, bars, agent runs/decisions, AI reservations/usage, orders, fills, position lots/positions, cash-ledger entries, and portfolio snapshots remained unchanged; metadata attests zero provider requests, model calls, orders, fills, and ledger entries. Browser diagnostics are empty, the action POST/refresh are HTTP 200, deployment runtime errors are empty, and Production remains unpromoted.

### Owner-reviewed hosted experiment start

- [x] Define one fixed paper-only start manifest covering the simulator, risk, disabled model routing, reviewed data sources, Luna prompt, empty corpus, AI budget, hosted universe, and official calendar.
- [x] Add one atomic owner-only, draft/control-revision-checked, idempotent replay/shadow start contract that locks an immutable experiment version and creates the paper simulation account, opening cash entry, and initial portfolio snapshot.
- [x] Keep provider runtime fetches, scheduler, agent, Sol, web search, broker capabilities, orders, and fills disabled; expose no credential or environment state to the client.
- [x] Cover readiness, exact owner authorization, direct-write denial, concurrent/stale inputs, retries, manifest drift, immutable evidence, exact decimals, and zero out-of-scope side effects with pgTAP and application tests.
- [x] Add a strict readiness projection, repository boundary, re-authorizing Server Action, and hosted-only draft controls with explicit replay/shadow confirmation.
- [x] Reconcile generated types and lifecycle/security/runbook/limitation documentation, then run the complete application/database/browser release gates before a protected Preview and reviewed merge.

Scope guard: starting creates only deterministic paper-simulation initialization evidence. It cannot call a provider or model, enable ingestion/cron/agent controls, create an order or fill, add a broker integration, or promote Production.

#### Review

- The additive migration and the complete start test passed all 55 pgTAP assertions against the hosted Capital-Lab schema inside one rollback-only transaction. A post-rollback audit confirmed that the rehearsal left no start table, function, or draft fixture behind.
- Local application gates are green: repository-wide zero-warning ESLint, strict TypeScript, 50 Vitest files / 390 tests, the PAPER TRADING ONLY safety scan, the Next.js 16.3 production build, slice formatting, and `git diff --check`.
- GitHub PR #15 CI run 79 is green at application commit `17f79bc`: formatting, lint, strict TypeScript, 390 Vitest tests, the paper-only scan, the production build, all Chromium journeys, a fresh Supabase reset, and every pgTAP file passed. Run 77 exposed the deterministic seed's older AAPL metadata; the rollback-only fixture was aligned without weakening the production conflict check.
- Hosted migration `20260808150423` was applied only after green exact-commit CI. Supabase-generated types match the checked table, version/view, and start-RPC contract; the four readiness identifiers remain intentionally nullable in the client because the function can return an unconfigured state that PostgreSQL function metadata cannot express.
- Protected Vercel Preview `dpl_4gMfCv7mSpEi8CHsUAKsKQytF1At` is READY at exact application commit `17f79bc` with no Production target. The authenticated owner created experiment `c01b2400-0fd4-4242-a932-62f2563db96f`, confirmed `START REPLAY`, and reloaded the persisted Active/Replay detail with locked version `2153e382-04dd-40ad-bac1-d0bf39c20023`; browser and deployment warning/error scans are empty.
- The hosted start created one immutable version, one active paper simulation account, one EUR `100000.00000000` opening ledger entry, and one opening snapshot with EUR `200000.00000000` buying power and zero exposure/P&L. Completed idempotency and redacted audit evidence reference the reviewed start, market, and 2026 calendar manifests.
- Provider runtime fetches and every source/policy, scheduler slot, simulator/ingestion/agent run, agent decision, AI usage event, order, and fill remain zero or disabled. Forced RLS, direct-write denial, narrow authenticated start execution, anonymous/PUBLIC/service-role denial, and the fixed empty search path were rechecked. Security advisors retain only the known leaked-password-protection warning; performance advice is informational unused-index output. Production remains unpromoted.

### Owner-reviewed 2026 official market calendar

- [x] Define one fixed 2026 XNAS/ARCX regular-session manifest from the official Nasdaq Trader and NYSE/NYSE Arca calendars, including the ten exchange holidays and the November 27 / December 24 early closes.
- [x] Add an atomic, owner-only, idempotent Supabase contract that persists disabled provenance sources and exact UTC session evidence, rejects conflicts, and attests the complete manifest without enabling a provider or scheduler.
- [x] Add strict application mapping, a re-authorizing Server Action, a hosted-only `/markets` setup control, and truthful configured/unavailable states while preserving mock mode.
- [x] Cover owner/non-owner/anonymous access, grants/search paths, manifest completeness, DST conversion, holiday/early-close rows, retries, conflict rollback, and zero ingestion/scheduler/agent/order/fill side effects with unit and pgTAP tests.
- [x] Reconcile generated database types and calendar/security/runbook/limitation documentation; run the complete application/database/browser gates and publish through a protected Preview and green reviewed PR without promoting Production.

Scope guard: this slice checks in fixed calendar evidence only. It makes no external runtime request, stores no credentials, enables no data source, cron, agent, AI, experiment, or trading control, and cannot create orders, fills, or ledger entries.

#### Review

- Official-source review fixes the 2026 XNAS and ARCX core calendar at 261 weekday records per exchange: 249 regular sessions, the November 27 / December 24 13:00 early closes, and ten holiday closures. The contract stores New York-local windows as exact UTC timestamps and rejects any extra or conflicting 2026 row.
- The additive migration and combined rollback-only rehearsal passed all 55 pgTAP assertions against hosted PostgreSQL, then migration `20260808115951` was applied only after a green exact-commit CI cycle. Hosted-generated types match the checked contract, including the intentional nullable unconfigured state.
- The complete clean-mirror `pnpm verify` pass is green: formatting, zero-warning ESLint, strict TypeScript, 47 Vitest files / 349 tests, the PAPER TRADING ONLY safety scan, and the Next.js 16.3 production build. The final regression specifically covers the `+00:00` timestamp shape emitted by hosted PostgREST.
- GitHub PR #14 CI run 72 is green at application commit `6b8687e`: application, a fresh Supabase reset plus every pgTAP file, and all four Chromium journeys passed. Earlier CI runs exposed the two append-only synthetic seed sessions, and protected Preview exposed the PostgREST offset mismatch; both were corrected without weakening production conflict checks or authorization.
- Protected Vercel Preview `dpl_25FFkeCUobJ4JVSqc9LxjrHankEB` is READY at exact commit `6b8687e`. The authenticated owner used the real Markets control to attest the manifest, and a full reload persisted the configured UI with the latest eligible XNAS/ARCX sessions; browser and deployment runtime warning/error scans are empty.
- Hosted state contains one manifest and 522 unique weekday rows: each exchange has 249 regular, two early-close, and ten closed sessions. The official Nasdaq/NYSE reference sources and policies remain disabled with `runtime_fetch=false`, Alpaca remains disabled, and scheduler runs/slots, agents, experiments, ingestion runs, orders, fills, and ledger entries remain zero.
- Forced RLS, narrow authenticated RPC access, direct-write denial, anonymous/service-role denial, exact owner attestation, and one redacted audit were rechecked after configuration. Security advisors retain only the known leaked-password-protection warning; performance advice is informational unused-index output on empty or newly populated low-traffic tables. Production remains unpromoted.

### Preview deployment control

- [x] Diagnose the missing Vercel Git deployment without changing production, domains, billing, or environment secrets.
- [x] Replace the repository-wide deployment shutdown with a branch rule that keeps `main` disabled and permits non-production Preview branches.
- [x] Verify the configuration, publish only the scoped config/tracker change, and confirm Vercel creates a protected Preview from the Git push.
- [x] Run the protected browser and runtime checks, merge only through green required checks, and leave Production unpromoted.

#### Review

- Root cause: the connected Git integration was healthy, but `vercel.json` explicitly disabled every Git-triggered deployment. The branch rule now disables only `main`, leaving normal non-production Preview branches enabled.
- Git push `8f38550` automatically created protected Preview `dpl_ArTMWe7K4nqnqHqCZu1Rz5Qo2yk2` from the exact commit. It reached `READY` with no Production target and no build errors.
- The owner gate rendered with meaningful content, no Next.js error overlay, and no browser warnings/errors. Preview runtime logs returned `200` for `/`, `/dashboard`, `/login`, `/experiments`, and `/api/health`, with no warning/error entries.
- Both the push and pull-request CI runs passed the application, fresh Supabase reset/pgTAP, and Chromium browser jobs before merge approval. No environment variable, credential, domain, billing, Supabase data, or Production alias was changed.

### Hosted locked-experiment lifecycle controls

- [x] Define one owner-only, revision-checked, idempotent lifecycle contract for explicit shadow-to-live-paper simulation promotion, pause, resume, completion, and clone-to-draft; keep scheduler, agent, and all broker capabilities disabled.
- [x] Preserve the immutable locked experiment/version, simulation ledger, orders, fills, and historical status evidence; clone only configuration references and paper capital into a new disabled draft.
- [x] Add strict application inputs, a re-authorizing Server Action, typed Supabase repository mapping, and hosted detail controls with explicit confirmation and truthful conflict/unknown-result states.
- [x] Cover owner/non-owner/anonymous access, allowed and forbidden transitions, revision conflicts, retries, evidence integrity, clone isolation, and zero financial/order/AI/scheduler side effects with unit and pgTAP tests.
- [x] Reconcile generated types and lifecycle/security/runbook/limitation documentation, then run the complete application/database/browser release gates before a protected Preview and reviewed merge.

#### Scope note

Draft-to-replay/shadow start was completed in the separate owner-reviewed slice above. It locks the exact simulator, risk, routing, data-source, prompt/corpus, budget, universe, and calendar references without changing the independent locked-experiment lifecycle contract.

#### Review in progress

- The migration and all 43 lifecycle pgTAP assertions passed against the hosted Capital-Lab schema in rollback-only transactions; no fixture state was retained. The rehearsals caught and corrected the canonical open-order state set, result-column qualification, fixture portability, and owner-scoped provenance index coverage before release.
- Clean-mirror application gates pass: Prettier, zero-warning ESLint, strict TypeScript, 43 Vitest files / 308 tests, the paper-only safety scan, and the Next.js 16.3 production build.
- GitHub PR #12 CI run 56 is green: the application, fresh Supabase reset/pgTAP, and Chromium browser jobs all passed.
- Hosted lifecycle and provenance-index migrations were applied only after CI passed. Hosted-generated TypeScript types were reconciled. The project remains at zero experiments, orders, fills, agent runs, scheduler runs, enabled controls, and enabled Alpaca sources. Authenticated execution is granted only through the narrow lifecycle RPC; anonymous/PUBLIC execution and direct authenticated experiment updates are denied, and both lifecycle functions have fixed search paths.
- Supabase security advisors report only the known Free-plan leaked-password warning. The new foreign key is fully indexed; performance advisors otherwise report informational unused-index findings on the empty/low-traffic schema.

### Deterministic point-in-time market features

- [x] Define `market-technical-v1` in pure domain code with canonical Decimal.js inputs/outputs, bounded one-minute history, strict continuity, and explicit unavailable states for missing samples or zero denominators.
- [x] Add an owner-only, read-only Supabase feature-input function that selects at most 21 eligible latest logical bar revisions per feed at a required decision timestamp and returns every financial value as exact text.
- [x] Extend the atomic hosted market snapshot and strict mapper so configuration, quotes/bars, feature inputs, sessions, and source health share one PostgreSQL statement boundary; reject owner/time/scope/latest-bar drift again in the application.
- [x] Render spread, one/five-minute returns, 20-minute relative volume, five-minute realized volatility, SMA5 distance, and typical-price-VWAP20 distance with truthful history coverage on hosted `/markets`.
- [x] Cover deterministic math, malformed/gapped/zero-denominator inputs, owner/grant/search-path boundaries, correction/cancellation/future-receipt behavior, exact-text precision, bounded reads, and zero mutations with unit and pgTAP tests.
- [x] Run the complete application/database/browser release gates, reconcile hosted generated types and advisors, publish a protected Preview through a green PR, apply the migration, and merge without enabling Alpaca, scheduler, AI, or production.

Scope guard: feature generation is a read-only derivation from persisted evidence. It cannot contact Alpaca, add credentials, enable a source, create a scheduler/agent/order/fill/ledger row, or promote production. Missing market history remains unavailable.

#### Review

- The generated migration compiled on the hosted PostgreSQL schema and the bound rollback-only pgTAP rehearsal completed `1..17`; a post-check confirmed the new function, temporary feature bars, and pgTAP extension were all absent afterward.
- Focused pure/application verification passes in the clean workspace (4 files / 30 tests plus strict TypeScript). The complete application gate is green: Prettier, zero-warning ESLint, strict TypeScript, 42 Vitest files / 282 tests, the PAPER TRADING ONLY safety scan, and the Next.js 16.3 production build. The repository-pinned pnpm download wrapper stalled after the bundled pnpm 11 tried to replace the mirror's dependency tree, so the same six scripts were executed directly with the already installed project binaries.
- GitHub PR #11 CI runs 49 and 51 are green through application commit `2f002b4`: the application gate, four mock Playwright journeys, a fresh Supabase reset, and every pgTAP file passed.
- Hosted migration `20260807222906` is applied to Capital-Lab. Generated hosted types match the checked-in feature-input and aggregate RPC contracts. The feature function is stable, security-invoker, fixed-search-path, executable by authenticated callers, and denied to anonymous/PUBLIC. Alpaca IEX and its policy remain disabled; quote, bar, health, raw-event, ingestion, scheduler, agent, order, fill, and cash-ledger counts remain zero. Security advisors remain unchanged with only leaked-password protection disabled; performance advice is informational unused-index output on the empty runtime tables.
- Protected Vercel Preview `dpl_EkLcDF1hwwiL4oKduMBYrEhnFh6n` is READY as Next.js at exact application commit `2f002b4`. Health reports PAPER TRADING ONLY with mock data and the agent disabled; owner sign-in renders with owner setup absent, unauthenticated `/markets` access fails closed, and deployment runtime error/warning scans are empty. Production remains unpromoted.

### Owner-triggered Alpaca IEX ingestion

- [x] Harden the data-only Alpaca HTTP adapter around the exact `data.alpaca.markets` quote and stock-bar endpoints with five-symbol bounds, raw/as-of historical semantics, pagination, byte/page/record limits, redirect refusal, per-request and aggregate timeouts, exact decimal parsing, provider request IDs, and sanitized typed failures.
- [x] Define a fixed manual batch: the reviewed SPY/QQQ/AAPL/MSFT/NVDA aliases, latest IEX quotes, and bounded completed raw one-minute bars. Do not call Alpaca calendar, account, broker, or order hosts; market-session ingestion remains a later official-calendar slice.
- [x] Add owner-only, idempotent source activation plus short begin/commit/fail/result database RPCs. Derive identity from `auth.uid()`, keep provider calls outside database transactions, stamp availability in PostgreSQL, append revisions rather than overwrite, record raw normalized evidence, source health, ingestion counters, and redacted audits, and deny direct writes.
- [x] Add a re-authorizing Server Action, typed repository/orchestration boundary, and hosted `/markets` controls with truthful credential/source/readiness, success, replay, failure, and unknown-result states. Keep mock mode unchanged and scheduler/agent/order creation disabled.
- [x] Cover adapter, mapper, repository, action, RLS/grants, owner/non-owner/anonymous access, retry/idempotency, correction history, malformed/future/oversized payloads, source lifecycle, zero scheduler/agent/order side effects, and failure recording with unit and pgTAP tests.
- [x] Reconcile generated database types and update data-source, security, deployment, runbook, limitation, implementation-plan, and task-review documentation.
- [x] Run formatting, lint, strict typecheck, focused/full tests, database reset/pgTAP, paper-only and secret scans, production build, mock browser journeys, protected Preview verification, Supabase advisors, and merge only through a green reviewed PR. Do not promote production or enable a scheduler/agent.

Scope guard: this slice may contact only Alpaca Market Data after an authenticated owner explicitly enables the reviewed IEX source and invokes a manual batch with server-only credentials. It cannot call the Alpaca calendar because the documented calendar endpoint is on a trading host, cannot place or forward an order, cannot enable cron or AI, and cannot store credentials in Supabase.

#### Review

- Implementation is complete locally. Focused ingestion tests pass (9 files / 92 tests), and the clean-mirror `pnpm verify` pass is green: formatting, zero-warning lint, strict TypeScript, 41 Vitest files / 275 tests, paper-only scan, and Next.js 16.3 production build.
- Pull request #9 CI run 40 is green at commit `14f31bf`: application formatting/lint/typecheck/test/safety/build passed, Playwright passed, a fresh Supabase reset applied every migration, and all four database files / 1084 pgTAP assertions passed.
- Hosted migration `20260807195503` was applied to Capital-Lab only after clean CI. Generated hosted TypeScript types were reconciled and independently passed the complete clean-mirror gate again. The source and current policy remain disabled; quote, bar, health, raw-event, ingestion-run, scheduler-run, agent-run, order, and fill counts are all zero. Authenticated roles retain no direct inserts, anonymous function execution is denied, and all reviewed mutation functions have fixed empty search paths.
- Supabase security advisors report only the known Free-plan leaked-password warning; performance advisors report informational unused-index findings on the empty/low-traffic schema. Protected Vercel Preview `capital-8dp3fj7d2-constantinjanz-7876s-projects.vercel.app` is READY: remote build/typecheck passed, `/api/health` reports paper-only mock mode with the agent disabled, and unauthenticated `/markets` redirects to the owner login. No production promotion or Alpaca request occurred.

### Owner-reviewed hosted market configuration

- [x] Define one fixed, bounded manifest for XNAS/ARCX, SPY/QQQ/AAPL/MSFT/NVDA, exact Alpaca aliases, locked append-only owner universe versions that reuse the exact current version, and one initially disabled Alpaca IEX data-only source/policy.
- [x] Add an atomic owner-only configuration RPC that derives identity from `auth.uid()`, uses a private `SECURITY DEFINER` implementation with a fixed empty search path and public invoker wrapper, serializes setup, records durable idempotency and redacted audit evidence, and rejects conflicting reference metadata.
- [x] Cover owner/non-owner/anonymous access, direct-write denial, same-operation replay, changed-input rejection, conflict rollback, immutable prior universe versions, explicit grants, and a zero-observation post-state with rollback-only pgTAP.
- [x] Add a typed Supabase repository, re-authorizing Server Action, and hosted-only `/markets` setup control with precise failure states while preserving the deterministic mock page unchanged.
- [x] Reconcile generated database types and the implementation/data-source/limitation/security documentation with the already implemented direct Alpaca adapter and the deliberately deferred ingestion/runtime boundaries.
- [x] Apply and verify the additive migration against the hosted project, confirm the exact five-member disabled-source state and zero quote/bar/session/health/ingestion/scheduler evidence, and review Supabase advisors.
- [x] Run formatting, lint, strict typecheck, focused/full tests, pgTAP, paper-only/secret scans, production build, mock Playwright journeys, protected Preview verification, and merge only through a green reviewed PR.

Scope guard: this slice makes no Alpaca request, stores no Alpaca or Supabase secret, grants no direct table writes, creates no calendar or market observation, enables no scheduler/agent/provider, and does not promote production. Manual owner-triggered data-only ingestion remains the next separate review slice.

#### Review

- The fixed configuration, owner-only idempotent RPC, typed Server Action/repository, hosted setup control, and database-attested `reviewed_manifest_id` are implemented. The attestation fails closed on reference/member/alias/source/policy/audit drift while remaining separate from future runtime activation authorization.
- Local application verification is green: changed-file formatting, ESLint with zero warnings, strict TypeScript, 33 Vitest files / 185 tests, the paper-only scan, and the Next.js production build. Independent application, SQL, and contract-consistency reviews were addressed.
- Hosted migration `20260807172041` was applied to Capital-Lab after both push and pull-request CI passed the full database reset and all 118 pgTAP assertions. Owner operation `884debf6-cc53-4e09-bc15-4c2c0b7d14aa` created one locked five-member universe, exact Alpaca aliases, and one disabled data-only source/policy; replay is idempotent and the snapshot attests `capital_lab_us_core_alpaca_iex_v1`.
- Hosted grant checks are all green: only authenticated owners can invoke configuration, anonymous/service-role configuration is denied, the public wrapper is a fixed-search-path invoker over a private fixed-search-path definer, authenticated roles retain no direct writes, and attestation has the intended authenticated/service grants. The audit is redacted, and quotes, bars, FX, corporate actions, sessions, health, raw events, ingestion, and scheduler evidence all remain at zero.
- Supabase security advisors remain unchanged with only leaked-password protection disabled; performance advisors contain informational unused-index findings on the still-empty runtime tables. Generated hosted RPC types match the checked-in contract, retaining the intentional SQL-correct nullable snapshot override.
- GitHub CI is green for both push and pull-request events at application commit `d9e9112`: application formatting/lint/typecheck/tests/safety/build, database reset/pgTAP, and four mock browser journeys all passed. The initial database failure was isolated to two same-statement pgTAP snapshot joins plus one earlier valid fail-closed message and was corrected without changing the migration.
- Protected Vercel Preview `dpl_Gt1TKUTwWkrsHL34W1otyPfzFs5L` is READY at exact commit `d9e9112` as Next.js. Health reports paper-only with the market provider in safe mock mode and the agent disabled; the owner login renders without an application error overlay, protected `/markets` fails closed for the unavailable browser identity, and deployment runtime/browser-console error scans are empty. Production remains unpromoted.

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
