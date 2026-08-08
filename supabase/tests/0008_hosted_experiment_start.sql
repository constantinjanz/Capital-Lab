begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions;
select no_plan();

select ok(
  has_function_privilege(
    'authenticated',
    'public.start_hosted_draft_experiment(uuid,uuid,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticated owners may request a hosted paper experiment start'
);
select ok(
  not has_function_privilege(
    denied_role,
    'public.start_hosted_draft_experiment(uuid,uuid,text,text,text,text)',
    'EXECUTE'
  ),
  format('%s cannot start a hosted paper experiment', denied_role)
)
from (values ('anon'::text), ('public'::text), ('service_role'::text))
  as denied(denied_role);
select ok(
  has_function_privilege(
    'authenticated',
    'public.hosted_experiment_start_readiness(uuid)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'anon',
      'public.hosted_experiment_start_readiness(uuid)',
      'EXECUTE'
    ),
  'readiness is authenticated-only at the exposed boundary'
);
select ok(
  not exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as acl
    where namespace.nspname in ('public', 'private')
      and procedure.proname in (
        'hosted_experiment_start_scope',
        'hosted_experiment_start_readiness',
        'start_hosted_draft_experiment'
      )
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute any hosted-start function'
);
select ok(
  not procedure.prosecdef
    and procedure.provolatile = 'v'
    and coalesce(array_to_string(procedure.proconfig, ',') like '%search_path=%', false),
  'the public start wrapper is a volatile invoker with fixed search_path'
)
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'start_hosted_draft_experiment';
select ok(
  procedure.prosecdef
    and procedure.provolatile = 'v'
    and coalesce(array_to_string(procedure.proconfig, ',') like '%search_path=%', false),
  'the private atomic start implementation is a fixed-search-path definer'
)
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'private'
  and procedure.proname = 'start_hosted_draft_experiment';
select ok(
  not procedure.prosecdef
    and procedure.provolatile = 's'
    and coalesce(array_to_string(procedure.proconfig, ',') like '%search_path=%', false),
  'the readiness projection is a stable fixed-search-path invoker'
)
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'hosted_experiment_start_readiness';

select ok(
  relation.relrowsecurity and relation.relforcerowsecurity,
  'start manifests have forced row-level security'
)
from pg_class as relation
join pg_namespace as namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relname = 'experiment_start_manifests';
select ok(
  has_table_privilege(
    'authenticated', 'public.experiment_start_manifests', 'SELECT'
  )
    and not has_table_privilege(
      'authenticated', 'public.experiment_start_manifests', 'INSERT'
    )
    and not has_table_privilege(
      'authenticated', 'public.experiment_start_manifests', 'UPDATE'
    )
    and not has_table_privilege(
      'authenticated', 'public.experiment_start_manifests', 'DELETE'
    ),
  'authenticated callers have read-only start-manifest privileges'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'experiment_versions_start_manifest_idx'
  )
    and exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and indexname = 'experiment_versions_market_calendar_manifest_idx'
    ),
  'both immutable experiment-version manifest references are indexed'
);
select is(
  (
    select string_agg(
      column_name::text || ':' || data_type::text,
      ',' order by column_name::text
    )
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'experiment_detail_read_view'
      and column_name in ('market_calendar_manifest_id', 'start_manifest_id')
  ),
  'market_calendar_manifest_id:uuid,start_manifest_id:uuid'::text,
  'the security-invoker detail view exposes both immutable manifest references'
);
select ok(
  (
    with definition as (
      select substring(
        pg_get_functiondef(
          'private.start_hosted_draft_experiment(uuid,uuid,text,text,text,text)'::regprocedure
        )
        from strpos(
          pg_get_functiondef(
            'private.start_hosted_draft_experiment(uuid,uuid,text,text,text,text)'::regprocedure
          ),
          '-- Shared mutation order'
        )
      ) as body
    )
    select strpos(body, 'select controls.*') < strpos(body, 'select experiment.*')
      and strpos(body, 'select experiment.*')
        < strpos(body, 'pg_catalog.pg_advisory_xact_lock')
    from definition
  ),
  'start mutations lock controls, then experiment, then the owner manifest scope'
);

-- The seed has two synthetic XNAS rows used by older contracts. Remove only
-- those transaction-local fixtures so the reviewed 2026 calendar can attest.
alter table public.market_sessions disable trigger market_sessions_reject_mutation;
delete from public.market_sessions
where id in (
  '80000000-0000-0000-0000-000000000001',
  '80000000-0000-0000-0000-000000000002'
);
alter table public.market_sessions enable trigger market_sessions_reject_mutation;

create temporary table hosted_start_test_owner as
select user_id
from public.app_users
where role = 'owner'
order by created_at, user_id
limit 1;

create temporary table hosted_start_drafts (
  label text primary key,
  experiment_id uuid not null unique
);
create temporary table hosted_start_results (
  label text primary key,
  experiment_id uuid not null,
  experiment_version_id uuid not null,
  simulation_account_id uuid not null,
  lifecycle_status text not null,
  execution_mode text not null,
  control_state_version text not null,
  replayed boolean not null
);
grant select on hosted_start_test_owner to authenticated;
grant all on hosted_start_drafts, hosted_start_results to authenticated;

-- The deterministic local seed predates the reviewed hosted manifest. Align
-- its reused AAPL reference only inside this rollback-only test. The hosted
-- project already has the exact reviewed instrument evidence.
update public.instruments as instrument
set is_shortable = false,
    active_from = null
from public.exchanges as exchange
where exchange.id = instrument.primary_exchange_id
  and exchange.mic = 'XNAS'
  and instrument.symbol = 'AAPL';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select user_id from hosted_start_test_owner),
    'role', 'authenticated'
  )::text,
  true
);

insert into hosted_start_drafts(label, experiment_id)
values
  (
    'replay',
    public.create_draft_experiment(
      '94000000-0000-4000-8000-000000000001',
      'Hosted replay start fixture',
      'Lock the complete reviewed paper-only replay manifest atomically.'
    )
  ),
  (
    'shadow',
    public.create_draft_experiment(
      '94000000-0000-4000-8000-000000000002',
      'Hosted shadow start fixture',
      'Lock the complete reviewed paper-only shadow manifest atomically.'
    )
  );

select ok(
  (
    select result.status = 'configured' and not result.replayed
    from public.configure_hosted_market_manifest(
      '94000000-0000-4000-8000-000000000011'
    ) as result
  ),
  'the owner configures the exact reviewed hosted market manifest'
);
select ok(
  (
    select result.status = 'configured'
      and result.session_count = 522
      and not result.replayed
    from public.configure_hosted_official_calendar_manifest(
      '94000000-0000-4000-8000-000000000012'
    ) as result
  ),
  'the owner configures the exact reviewed official 2026 calendar'
);
select ok(
  (
    select readiness.ready
      and readiness.draft_ready
      and readiness.market_manifest_id = 'capital_lab_us_core_alpaca_iex_v1'
      and readiness.universe_id is not null
      and readiness.calendar_manifest_id = 'capital_lab_us_equities_calendar_2026_v1'
      and readiness.calendar_manifest_record_id is not null
    from public.hosted_experiment_start_readiness(
      (select experiment_id from hosted_start_drafts where label = 'replay')
    ) as readiness
  ),
  'readiness attests the exact disabled-source market and calendar evidence'
);

-- Prove the gate independently of whether a rehearsal target was already
-- configured by an earlier release. This drift is transaction-local and is
-- rolled back before any successful start.
reset role;
savepoint missing_reviewed_scope;
update public.sources set is_enabled = true where code = 'alpaca_iex';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select user_id from hosted_start_test_owner),
    'role', 'authenticated'
  )::text,
  true
);
select ok(
  (
    select
      not readiness.ready
      and readiness.draft_ready
      and readiness.draft_revision = '0'
      and readiness.control_state_version = '0'
      and readiness.start_manifest_id = 'capital_lab_disabled_runtime_start_v1'
    from public.hosted_experiment_start_readiness(
      (select experiment_id from hosted_start_drafts where label = 'replay')
    ) as readiness
  ),
  'a clean draft is blocked whenever reviewed source state drifts'
);
select throws_ok(
  format(
    'select * from public.start_hosted_draft_experiment(%L,%L,%L,%L,%L,%L)',
    '94000000-0000-4000-8000-000000000010',
    (select experiment_id from hosted_start_drafts where label = 'replay'),
    '0', '0', 'replay', 'START REPLAY'
  ),
  '55000',
  'reviewed market and official calendar manifests are required',
  'start fails atomically when the reviewed market prerequisite drifts'
);
reset role;
rollback to savepoint missing_reviewed_scope;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select user_id from hosted_start_test_owner),
    'role', 'authenticated'
  )::text,
  true
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select throws_ok(
  format(
    'select * from public.start_hosted_draft_experiment(%L,%L,%L,%L,%L,%L)',
    '94000000-0000-4000-8000-000000000013',
    (select experiment_id from hosted_start_drafts where label = 'replay'),
    '0', '0', 'replay', 'START REPLAY'
  ),
  '42501',
  'hosted experiment start is unavailable',
  'a non-owner cannot start the owner draft'
);
select throws_ok(
  format(
    'select * from public.hosted_experiment_start_readiness(%L)',
    (select experiment_id from hosted_start_drafts where label = 'replay')
  ),
  '42501',
  'hosted experiment start readiness is unavailable',
  'a non-owner cannot inspect owner start readiness'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select user_id from hosted_start_test_owner),
    'role', 'authenticated'
  )::text,
  true
);
select throws_ok(
  format(
    'select * from public.start_hosted_draft_experiment(%L,%L,%L,%L,%L,%L)',
    '94000000-0000-4000-8000-000000000014',
    (select experiment_id from hosted_start_drafts where label = 'replay'),
    '0', '0', 'live_paper', 'START LIVE PAPER'
  ),
  '22023',
  'a draft may start only in replay or shadow mode',
  'live-paper mode is impossible at the draft start boundary'
);
select throws_ok(
  format(
    'select * from public.start_hosted_draft_experiment(%L,%L,%L,%L,%L,%L)',
    '94000000-0000-4000-8000-000000000015',
    (select experiment_id from hosted_start_drafts where label = 'replay'),
    '0', '0', 'replay', 'yes'
  ),
  '22023',
  'exact owner start confirmation is required',
  'replay start requires the exact owner confirmation phrase'
);
select throws_ok(
  format(
    'select * from public.start_hosted_draft_experiment(%L,%L,%L,%L,%L,%L)',
    '94000000-0000-4000-8000-000000000016',
    (select experiment_id from hosted_start_drafts where label = 'replay'),
    '01', '0', 'replay', 'START REPLAY'
  ),
  '22023',
  'expected revisions must be canonical nonnegative integers',
  'noncanonical revision text is rejected before any mutation'
);
select throws_ok(
  format(
    'select * from public.start_hosted_draft_experiment(%L,%L,%L,%L,%L,%L)',
    '94000000-0000-4000-8000-000000000017',
    (select experiment_id from hosted_start_drafts where label = 'replay'),
    '1', '0', 'replay', 'START REPLAY'
  ),
  '40001',
  'experiment changed; reload before starting',
  'a stale draft revision fails closed'
);
select throws_ok(
  $$insert into public.experiment_start_manifests(
      owner_id, manifest_id, definition, content_hash, reviewed_at
    ) values (
      (select user_id from hosted_start_test_owner),
      'forged_start_manifest', '{}'::jsonb, repeat('a', 64), statement_timestamp()
    )$$,
  '42501',
  'permission denied for table experiment_start_manifests',
  'authenticated owners cannot bypass the reviewed start RPC with direct writes'
);
reset role;

create temporary table hosted_start_evidence_baseline as
select
  (select count(*) from private.ingestion_runs) as ingestion_runs,
  (select count(*) from public.source_health) as source_health,
  (select count(*) from private.scheduler_slots) as scheduler_slots,
  (select count(*) from private.scheduler_runs) as scheduler_runs,
  (select count(*) from public.agent_runs) as agent_runs,
  (select count(*) from public.orders) as orders,
  (select count(*) from public.fills) as fills,
  (select count(*) from private.cash_ledger_entries) as ledger_entries,
  (select count(*) from public.portfolio_snapshots) as portfolio_snapshots,
  (select count(*) from public.experiment_versions) as experiment_versions,
  (select count(*) from public.simulation_accounts) as simulation_accounts;
grant select on hosted_start_evidence_baseline to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select user_id from hosted_start_test_owner),
    'role', 'authenticated'
  )::text,
  true
);

insert into hosted_start_results
select 'replay', result.*
from public.start_hosted_draft_experiment(
  '94000000-0000-4000-8000-000000000101',
  (select experiment_id from hosted_start_drafts where label = 'replay'),
  '0',
  '0',
  'replay',
  'START REPLAY'
) as result;

select is(
  (
    select lifecycle_status || ':' || execution_mode || ':'
      || control_state_version || ':' || replayed::text
    from hosted_start_results where label = 'replay'
  ),
  'active:replay:1:false',
  'the first replay start returns exact active paper-only lock evidence'
);
select ok(
  (
    select result.experiment_version_id = stored.experiment_version_id
      and result.simulation_account_id = stored.simulation_account_id
      and result.control_state_version = stored.control_state_version
      and result.replayed
    from public.start_hosted_draft_experiment(
      '94000000-0000-4000-8000-000000000101',
      (select experiment_id from hosted_start_drafts where label = 'replay'),
      '0', '0', 'replay', 'START REPLAY'
    ) as result
    join hosted_start_results as stored on stored.label = 'replay'
  ),
  'an exact retry returns the same immutable version and account IDs'
);
select throws_ok(
  format(
    'select * from public.start_hosted_draft_experiment(%L,%L,%L,%L,%L,%L)',
    '94000000-0000-4000-8000-000000000101',
    (select experiment_id from hosted_start_drafts where label = 'replay'),
    '0', '1', 'replay', 'START REPLAY'
  ),
  '23505',
  'experiment start operation id was reused with different input',
  'a start operation UUID cannot be reused with changed input'
);

insert into hosted_start_results
select 'shadow', result.*
from public.start_hosted_draft_experiment(
  '94000000-0000-4000-8000-000000000102',
  (select experiment_id from hosted_start_drafts where label = 'shadow'),
  '0',
  '0',
  'shadow',
  'START SHADOW'
) as result;

select is(
  (
    select lifecycle_status || ':' || execution_mode || ':'
      || control_state_version || ':' || replayed::text
    from hosted_start_results where label = 'shadow'
  ),
  'active:shadow:1:false',
  'the second draft locks independently into proposal-only shadow mode'
);
reset role;

select is(
  (select count(*) from public.experiment_start_manifests),
  1::bigint,
  'replay and shadow starts reuse one exact append-only start manifest'
);
select ok(
  (
    select manifest.manifest_id = 'capital_lab_disabled_runtime_start_v1'
      and manifest.content_hash = encode(
        extensions.digest(manifest.definition::text, 'sha256'), 'hex'
      )
      and manifest.definition ->> 'paper_trading_only' = 'true'
      and manifest.definition #>> '{runtime,agent_enabled}' = 'false'
      and manifest.definition #>> '{runtime,scheduler_enabled}' = 'false'
      and manifest.definition #>> '{runtime,runtime_fetch_enabled}' = 'false'
      and manifest.definition #>> '{runtime,broker_integration_present}' = 'false'
    from public.experiment_start_manifests as manifest
  ),
  'the immutable manifest hashes exact paper-only disabled-runtime rules'
);
select is(
  (
    select count(*)
    from public.experiment_versions as version
    join hosted_start_results as result
      on result.experiment_version_id = version.id
    join public.experiment_start_manifests as start_manifest
      on start_manifest.id = version.start_manifest_id
    join public.market_calendar_manifests as calendar_manifest
      on calendar_manifest.id = version.market_calendar_manifest_id
    where version.version = 1
      and start_manifest.manifest_id = 'capital_lab_disabled_runtime_start_v1'
      and calendar_manifest.manifest_id = 'capital_lab_us_equities_calendar_2026_v1'
      and version.content_hash ~ '^[0-9a-f]{64}$'
      and version.resolved_rules ->> 'paper_trading_only' = 'true'
      and version.resolved_rules #>> '{runtime,scheduler_enabled}' = 'false'
      and version.resolved_rules #>> '{runtime,agent_enabled}' = 'false'
      and version.resolved_rules #>> '{runtime,runtime_fetch_enabled}' = 'false'
  ),
  2::bigint,
  'both immutable versions reference exact start/calendar manifests and runtime-off rules'
);
select results_eq(
  $$
    select config.config_kind, config.config
    from public.configuration_versions as config
    join public.experiment_versions as version on config.id in (
      version.simulator_config_version_id,
      version.risk_config_version_id,
      version.model_routing_version_id,
      version.data_source_config_version_id
    )
    join hosted_start_results as result
      on result.experiment_version_id = version.id
    where result.label = 'replay'
    order by config.config_kind
  $$,
  $$values
    (
      'data_sources'::text,
      '{"calendarManifestId":"capital_lab_us_equities_calendar_2026_v1","manualIngestionOnly":true,"marketManifestId":"capital_lab_us_core_alpaca_iex_v1","marketProvider":"alpaca_iex","runtimeFetchEnabled":false}'::jsonb
    ),
    (
      'model_routing'::text,
      '{"agentEnabled":false,"executionMode":"shadow","paidCallsEnabled":false,"solEnabled":false,"webSearchEnabled":false}'::jsonb
    ),
    (
      'risk'::text,
      '{"dailyLossPauseFraction":"0.200000000000","drawdownPauseFraction":"0.500000000000","longEnabled":true,"maxGrossLeverage":"2.000000000000","maxNewRiskFraction":"0.050000000000","maxSingleNameFraction":"0.250000000000","shortEnabled":false,"staleQuoteSeconds":300}'::jsonb
    ),
    (
      'simulator'::text,
      '{"latencyMs":250,"paperTradingOnly":true,"partialFills":true,"regularHoursOnly":true}'::jsonb
    )
  $$,
  'the replay version locks exact simulator, risk, routing, and source rules'
);
select ok(
  (
    select prompt.agent_role = 'luna'
      and prompt.system_prompt like 'Capital Lab paper-only analysis is disabled%'
      and corpus.name = 'Capital Lab reviewed empty corpus'
      and not exists (
        select 1 from public.knowledge_corpus_members as member
        where member.corpus_version_id = corpus.id
      )
      and budget.currency = 'USD'
      and budget.timezone = 'America/New_York'
      and budget.trading_day_hard_limit::text = '0.30000000'
      and budget.monthly_soft_limit::text = '6.30000000'
      and budget.monthly_hard_limit::text = '10.00000000'
      and budget.lifetime_hard_limit::text = '50.00000000'
    from public.experiment_versions as version
    join hosted_start_results as result
      on result.experiment_version_id = version.id
    join public.prompt_versions as prompt on prompt.id = version.agent_prompt_version_id
    join public.knowledge_corpus_versions as corpus
      on corpus.id = version.knowledge_corpus_version_id
    join public.ai_budget_policies as budget on budget.id = version.budget_policy_id
    where result.label = 'replay'
  ),
  'the version locks a disabled prompt, empty corpus, and exact bounded USD budget'
);
select is(
  (
    select count(*)
    from public.experiments as experiment
    join public.experiment_controls as controls
      on controls.experiment_id = experiment.id
      and controls.owner_id = experiment.owner_id
    join hosted_start_results as result on result.experiment_id = experiment.id
    where experiment.lifecycle_status = 'active'
      and experiment.execution_mode in ('replay', 'shadow')
      and experiment.locked_version_id = result.experiment_version_id
      and controls.state_version = 1
      and not controls.scheduler_enabled
      and not controls.agent_enabled
      and not controls.emergency_paused
      and controls.pause_reason is null
  ),
  2::bigint,
  'both experiments lock active while every autonomous runtime control stays off'
);
select is(
  (
    select count(*)
    from private.cash_ledger_entries as ledger
    join hosted_start_results as result
      on result.simulation_account_id = ledger.simulation_account_id
    where ledger.entry_type = 'opening_cash'
      and ledger.source_type = 'experiment'
      and ledger.source_id = result.experiment_id
      and ledger.source_component = 'initial_capital'
      and ledger.currency = 'EUR'
      and ledger.amount::text = '100000.00000000'
  ),
  2::bigint,
  'the simulation ledger service posts one exact EUR opening entry per start'
);
select is(
  (
    select count(*)
    from public.portfolio_snapshots as snapshot
    join hosted_start_results as result
      on result.simulation_account_id = snapshot.simulation_account_id
    where snapshot.cash_value::text = '100000.00000000'
      and snapshot.net_liquidation_value::text = '100000.00000000'
      and snapshot.buying_power::text = '200000.00000000'
      and snapshot.gross_exposure = 0::numeric
      and snapshot.net_exposure = 0::numeric
      and snapshot.realized_pnl = 0::numeric
      and snapshot.unrealized_pnl = 0::numeric
  ),
  2::bigint,
  'each start creates an exact zero-exposure opening portfolio snapshot'
);
select is(
  (
    select count(*)
    from public.experiment_status_events as event
    join hosted_start_results as result on result.experiment_id = event.experiment_id
    where event.from_status = 'draft'
      and event.to_status = 'active'
      and event.from_execution_mode is null
      and event.to_execution_mode = result.execution_mode
      and event.reason_code in ('owner_started_replay', 'owner_started_shadow')
  ),
  2::bigint,
  'each start appends one explicit draft-to-active paper-mode status event'
);
select is(
  (
    select count(*)
    from private.audit_log as audit
    join hosted_start_results as result on result.experiment_id = audit.experiment_id
    where audit.action = 'experiment.started'
      and audit.metadata ->> 'paper_only' = 'true'
      and audit.metadata ->> 'scheduler_enabled' = 'false'
      and audit.metadata ->> 'agent_enabled' = 'false'
      and audit.metadata ->> 'provider_request_made' = 'false'
      and audit.metadata ->> 'broker_integration_present' = 'false'
      and audit.metadata ->> 'orders_created' = '0'
      and audit.metadata ->> 'fills_created' = '0'
  ),
  2::bigint,
  'each fresh start appends one redacted paper-only audit attestation'
);
select is(
  (
    select count(*)
    from private.idempotency_records as record
    join hosted_start_results as result on result.experiment_id = record.result_ref_id
    where record.scope = 'experiment.start_hosted_draft.v1'
      and record.status = 'completed'
      and record.result_ref_type = 'experiment_start'
  ),
  2::bigint,
  'each fresh start finalizes one durable idempotency record'
);

select is(
  (select count(*) from private.ingestion_runs),
  (select ingestion_runs from hosted_start_evidence_baseline),
  'experiment start creates no ingestion run'
);
select is(
  (select count(*) from public.source_health),
  (select source_health from hosted_start_evidence_baseline),
  'experiment start performs no provider request or source-health mutation'
);
select is(
  (select count(*) from private.scheduler_slots),
  (select scheduler_slots from hosted_start_evidence_baseline),
  'experiment start creates no scheduler slot'
);
select is(
  (select count(*) from private.scheduler_runs),
  (select scheduler_runs from hosted_start_evidence_baseline),
  'experiment start creates no scheduler run'
);
select is(
  (select count(*) from public.agent_runs),
  (select agent_runs from hosted_start_evidence_baseline),
  'experiment start creates no agent run or model call'
);
select is(
  (select count(*) from public.orders),
  (select orders from hosted_start_evidence_baseline),
  'experiment start creates no simulated order'
);
select is(
  (select count(*) from public.fills),
  (select fills from hosted_start_evidence_baseline),
  'experiment start creates no simulated fill'
);
select is(
  (select count(*) from private.cash_ledger_entries),
  (select ledger_entries + 2 from hosted_start_evidence_baseline),
  'two starts create exactly two opening ledger entries'
);
select is(
  (select count(*) from public.portfolio_snapshots),
  (select portfolio_snapshots + 2 from hosted_start_evidence_baseline),
  'two starts create exactly two opening snapshots'
);
select is(
  (select count(*) from public.experiment_versions),
  (select experiment_versions + 2 from hosted_start_evidence_baseline),
  'two starts create exactly two immutable experiment versions'
);
select is(
  (select count(*) from public.simulation_accounts),
  (select simulation_accounts + 2 from hosted_start_evidence_baseline),
  'two starts create exactly two simulation accounts'
);
select is(
  (
    select count(*)
    from public.sources as source
    join public.source_policies as policy on policy.source_id = source.id
    where source.code in (
      'alpaca_iex',
      'nasdaq_official_calendar_2026',
      'nyse_official_calendar_2026'
    )
      and not source.is_enabled
      and not policy.enabled
      and policy.effective_to is null
  ),
  3::bigint,
  'all reviewed market and calendar provenance sources remain disabled'
);

select throws_ok(
  $$update public.experiment_start_manifests set definition = definition$$,
  '55000',
  'public.experiment_start_manifests is append-only',
  'the reviewed start manifest cannot be rewritten'
);
select throws_ok(
  format(
    'update public.experiment_versions set resolved_rules = resolved_rules where id = %L',
    (select experiment_version_id from hosted_start_results where label = 'replay')
  ),
  '55000',
  'public.experiment_versions is append-only',
  'a locked experiment version cannot be rewritten'
);

select * from finish();
rollback;
