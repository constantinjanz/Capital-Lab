begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions;
select no_plan();

select ok(
  has_function_privilege(
    'authenticated',
    'public.hosted_manual_cycle_state(uuid)',
    'EXECUTE'
  )
    and has_function_privilege(
      'authenticated',
      'public.run_hosted_manual_cycle(uuid,uuid,text,timestamptz,text)',
      'EXECUTE'
    ),
  'authenticated owners may inspect and request the manual paper-cycle envelope'
);
select ok(
  not has_function_privilege(
    denied_role,
    'public.hosted_manual_cycle_state(uuid)',
    'EXECUTE'
  )
    and not has_function_privilege(
      denied_role,
      'public.run_hosted_manual_cycle(uuid,uuid,text,timestamptz,text)',
      'EXECUTE'
    ),
  format('%s cannot inspect or request a manual paper cycle', denied_role)
)
from (values ('anon'::text), ('public'::text), ('service_role'::text))
  as denied(denied_role);
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
        'hosted_manual_cycle_scope',
        'hosted_manual_cycle_state',
        'run_hosted_manual_cycle'
      )
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute any manual-cycle function'
);
select ok(
  not procedure.prosecdef
    and procedure.provolatile = 's'
    and coalesce(array_to_string(procedure.proconfig, ',') like '%search_path=%', false),
  'the public state projection is a stable fixed-search-path invoker'
)
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'hosted_manual_cycle_state';
select ok(
  procedure.prosecdef
    and procedure.provolatile = 's'
    and coalesce(array_to_string(procedure.proconfig, ',') like '%search_path=%', false),
  'the private state projection is a stable fixed-search-path definer'
)
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'private'
  and procedure.proname = 'hosted_manual_cycle_state';
select ok(
  not public_procedure.prosecdef
    and public_procedure.provolatile = 'v'
    and private_procedure.prosecdef
    and private_procedure.provolatile = 'v'
    and coalesce(array_to_string(public_procedure.proconfig, ',') like '%search_path=%', false)
    and coalesce(array_to_string(private_procedure.proconfig, ',') like '%search_path=%', false),
  'the volatile public invoker wraps one fixed-search-path private definer'
)
from pg_proc as public_procedure
join pg_namespace as public_namespace
  on public_namespace.oid = public_procedure.pronamespace
cross join pg_proc as private_procedure
join pg_namespace as private_namespace
  on private_namespace.oid = private_procedure.pronamespace
where public_namespace.nspname = 'public'
  and public_procedure.proname = 'run_hosted_manual_cycle'
  and private_namespace.nspname = 'private'
  and private_procedure.proname = 'run_hosted_manual_cycle';
select ok(
  not has_table_privilege('authenticated', 'private.scheduler_slots', 'INSERT')
    and not has_table_privilege('authenticated', 'private.scheduler_runs', 'INSERT')
    and not has_table_privilege('authenticated', 'public.simulator_runs', 'INSERT'),
  'authenticated callers cannot forge scheduler or simulator evidence directly'
);
select ok(
  (
    with definition as (
      select substring(
        pg_get_functiondef(
          'private.run_hosted_manual_cycle(uuid,uuid,text,timestamptz,text)'::regprocedure
        )
        from strpos(
          pg_get_functiondef(
            'private.run_hosted_manual_cycle(uuid,uuid,text,timestamptz,text)'::regprocedure
          ),
          '-- Shared global lifecycle order'
        )
      ) as body
    )
    select strpos(body, 'select controls.*') < strpos(body, 'select experiment.*')
      and strpos(body, 'select experiment.*') < strpos(body, 'select account.*')
      and strpos(body, 'select account.*') < strpos(body, 'pg_advisory_xact_lock')
    from definition
  ),
  'manual cycles lock controls, experiment, account, then the deterministic slot'
);

-- Remove only the two legacy synthetic calendar fixtures for this rollback-only
-- rehearsal, then configure the exact reviewed hosted market and calendar data.
alter table public.market_sessions disable trigger market_sessions_reject_mutation;
delete from public.market_sessions
where id in (
  '80000000-0000-0000-0000-000000000001',
  '80000000-0000-0000-0000-000000000002'
);
alter table public.market_sessions enable trigger market_sessions_reject_mutation;

create temporary table hosted_cycle_test_owner as
select user_id
from public.app_users
where role = 'owner'
  and is_active
order by created_at, user_id
limit 1;
create temporary table hosted_cycle_experiments (
  label text primary key,
  experiment_id uuid not null unique
);
create temporary table hosted_cycle_results (
  label text primary key,
  scheduler_run_id uuid not null,
  simulator_run_id uuid not null,
  slot_key text not null,
  decision_at timestamptz not null,
  status text not null,
  reason text not null,
  model_calls integer not null,
  paper_orders_created integer not null,
  paper_fills_created integer not null,
  replayed boolean not null
);
grant select on hosted_cycle_test_owner to authenticated;
grant all on hosted_cycle_experiments, hosted_cycle_results to authenticated;

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
    'sub', (select user_id from hosted_cycle_test_owner),
    'role', 'authenticated'
  )::text,
  true
);

insert into hosted_cycle_experiments(label, experiment_id)
values
  (
    'eligible',
    public.create_draft_experiment(
      '95000000-0000-4000-8000-000000000001',
      'Durable eligible cycle fixture',
      'Prove one official-session paper-only scheduler envelope.'
    )
  ),
  (
    'closed',
    public.create_draft_experiment(
      '95000000-0000-4000-8000-000000000002',
      'Durable closed cycle fixture',
      'Prove a reviewed market-closed scheduler envelope.'
    )
  );

select ok(
  (
    select result.status = 'configured'
    from public.configure_hosted_market_manifest(
      '95000000-0000-4000-8000-000000000011'
    ) as result
  ),
  'the exact disabled-runtime market manifest is configured'
);
select ok(
  (
    select result.status = 'configured' and result.session_count = 522
    from public.configure_hosted_official_calendar_manifest(
      '95000000-0000-4000-8000-000000000012'
    ) as result
  ),
  'the exact official 2026 XNAS and ARCX sessions are configured'
);

select ok(
  (
    select result.lifecycle_status = 'active'
      and result.execution_mode = 'replay'
      and result.control_state_version = '1'
    from public.start_hosted_draft_experiment(
      '95000000-0000-4000-8000-000000000021',
      (select experiment_id from hosted_cycle_experiments where label = 'eligible'),
      '0', '0', 'replay', 'START REPLAY'
    ) as result
  ),
  'the eligible fixture starts with locked replay controls'
);
select ok(
  (
    select result.lifecycle_status = 'active'
      and result.execution_mode = 'replay'
      and result.control_state_version = '1'
    from public.start_hosted_draft_experiment(
      '95000000-0000-4000-8000-000000000022',
      (select experiment_id from hosted_cycle_experiments where label = 'closed'),
      '0', '0', 'replay', 'START REPLAY'
    ) as result
  ),
  'the market-closed fixture starts with an independent locked replay version'
);
reset role;

-- The official configuration is reviewed now. For deterministic historical
-- replay assertions, make that evidence available from the beginning of the
-- reviewed year only inside this transaction.
alter table public.market_sessions disable trigger market_sessions_reject_mutation;
update public.market_sessions as session
set available_at = timestamptz '2026-01-01 00:00:00+00'
from public.market_calendar_manifests as manifest
where manifest.id = session.calendar_manifest_id
  and manifest.manifest_id = 'capital_lab_us_equities_calendar_2026_v1';
alter table public.market_sessions enable trigger market_sessions_reject_mutation;

create temporary table hosted_cycle_baseline as
select
  (select count(*) from private.ingestion_runs) as ingestion_runs,
  (select count(*) from public.source_health) as source_health,
  (select count(*) from public.market_quotes) as market_quotes,
  (select count(*) from public.market_bars) as market_bars,
  (select count(*) from public.agent_runs) as agent_runs,
  (select count(*) from public.agent_decisions) as agent_decisions,
  (select count(*) from private.ai_budget_reservations) as ai_budget_reservations,
  (select count(*) from private.ai_usage_events) as ai_usage_events,
  (select count(*) from public.orders) as orders,
  (select count(*) from public.fills) as fills,
  (select count(*) from private.cash_ledger_entries) as ledger_entries,
  (select count(*) from public.position_lots) as position_lots,
  (select count(*) from public.positions) as positions,
  (select count(*) from public.portfolio_snapshots) as portfolio_snapshots,
  (select count(*) from private.scheduler_slots) as scheduler_slots,
  (select count(*) from private.scheduler_runs) as scheduler_runs,
  (select count(*) from public.simulator_runs) as simulator_runs,
  (select count(*) from private.audit_log) as audit_rows,
  (select count(*) from private.idempotency_records) as idempotency_rows;
grant select on hosted_cycle_baseline to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select user_id from hosted_cycle_test_owner),
    'role', 'authenticated'
  )::text,
  true
);

select ok(
  (
    select state.ready
      and state.scheduler_provider = 'manual'
      and state.reason is null
      and state.control_state_version = '1'
      and state.last_scheduler_run_id is null
      and state.last_simulator_run_id is null
    from public.hosted_manual_cycle_state(
      (select experiment_id from hosted_cycle_experiments where label = 'eligible')
    ) as state
  ),
  'the owner sees one sanitized ready state without invented run evidence'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select throws_ok(
  format(
    'select * from public.hosted_manual_cycle_state(%L)',
    (select experiment_id from hosted_cycle_experiments where label = 'eligible')
  ),
  '42501',
  'hosted manual cycle state is unavailable',
  'a non-owner cannot inspect owner cycle state'
);
select throws_ok(
  format(
    'select * from public.run_hosted_manual_cycle(%L,%L,%L,%L,%L)',
    '95000000-0000-4000-8000-000000000030',
    (select experiment_id from hosted_cycle_experiments where label = 'eligible'),
    '1', '2026-08-06 15:00:01+00', 'RUN PAPER CYCLE'
  ),
  '42501',
  'hosted manual cycle is unavailable',
  'a non-owner cannot request the owner cycle'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select user_id from hosted_cycle_test_owner),
    'role', 'authenticated'
  )::text,
  true
);
select throws_ok(
  format(
    'select * from public.run_hosted_manual_cycle(%L,%L,%L,%L,%L)',
    '95000000-0000-4000-8000-000000000031',
    (select experiment_id from hosted_cycle_experiments where label = 'eligible'),
    '1', '2026-08-06 15:00:01+00', 'run paper cycle'
  ),
  '22023',
  'exact paper cycle confirmation is required',
  'the owner confirmation is exact and case-sensitive'
);
select throws_ok(
  format(
    'select * from public.run_hosted_manual_cycle(%L,%L,%L,%L,%L)',
    '95000000-0000-4000-8000-000000000032',
    (select experiment_id from hosted_cycle_experiments where label = 'eligible'),
    '01', '2026-08-06 15:00:01+00', 'RUN PAPER CYCLE'
  ),
  '22023',
  'expected control state version must be a canonical nonnegative integer',
  'noncanonical control revisions are rejected before mutation'
);
select throws_ok(
  format(
    'select * from public.run_hosted_manual_cycle(%L,%L,%L,%L,%L)',
    '95000000-0000-4000-8000-000000000033',
    (select experiment_id from hosted_cycle_experiments where label = 'eligible'),
    '2', '2026-08-06 15:00:01+00', 'RUN PAPER CYCLE'
  ),
  '40001',
  'experiment controls changed; reload before running a cycle',
  'a stale control revision cannot enter the cycle envelope'
);
select throws_ok(
  format(
    'select * from public.run_hosted_manual_cycle(%L,%L,%L,%L,%L)',
    '95000000-0000-4000-8000-000000000034',
    (select experiment_id from hosted_cycle_experiments where label = 'eligible'),
    '1', '2027-01-01 00:00:00+00', 'RUN PAPER CYCLE'
  ),
  '22023',
  'decision timestamp must be an eligible reviewed 2026 boundary',
  'decision boundaries outside the reviewed calendar fail closed'
);

insert into hosted_cycle_results
select 'eligible', result.*
from public.run_hosted_manual_cycle(
  '95000000-0000-4000-8000-000000000101',
  (select experiment_id from hosted_cycle_experiments where label = 'eligible'),
  '1',
  '2026-08-06 15:00:01+00',
  'RUN PAPER CYCLE'
) as result;

select is(
  (
    select status || ':' || reason || ':' || model_calls::text || ':'
      || paper_orders_created::text || ':' || paper_fills_created::text || ':'
      || replayed::text
    from hosted_cycle_results where label = 'eligible'
  ),
  'skipped:market_data_runtime_disabled:0:0:0:false',
  'an eligible official session records only a safe runtime-disabled skip'
);
select is(
  (select slot_key from hosted_cycle_results where label = 'eligible'),
  (
    select 'hosted-paper-cycle:' || experiment_id::text
      || ':2026-08-06T15:00:00Z'
    from hosted_cycle_experiments where label = 'eligible'
  ),
  'the decision is assigned to one deterministic 15-minute experiment slot'
);
select ok(
  (
    select retry.scheduler_run_id = stored.scheduler_run_id
      and retry.simulator_run_id = stored.simulator_run_id
      and retry.slot_key = stored.slot_key
      and retry.decision_at = stored.decision_at
      and retry.reason = stored.reason
      and retry.replayed
    from public.run_hosted_manual_cycle(
      '95000000-0000-4000-8000-000000000101',
      (select experiment_id from hosted_cycle_experiments where label = 'eligible'),
      '1', '2026-08-06 15:00:01+00', 'RUN PAPER CYCLE'
    ) as retry
    cross join hosted_cycle_results as stored
    where stored.label = 'eligible'
  ),
  'an exact operation retry returns the immutable first result'
);
select ok(
  (
    select duplicate.scheduler_run_id = stored.scheduler_run_id
      and duplicate.simulator_run_id = stored.simulator_run_id
      and duplicate.slot_key = stored.slot_key
      and duplicate.decision_at = stored.decision_at
      and duplicate.reason = stored.reason
      and duplicate.replayed
    from public.run_hosted_manual_cycle(
      '95000000-0000-4000-8000-000000000102',
      (select experiment_id from hosted_cycle_experiments where label = 'eligible'),
      '1', '2026-08-06 15:05:01+00', 'RUN PAPER CYCLE'
    ) as duplicate
    cross join hosted_cycle_results as stored
    where stored.label = 'eligible'
  ),
  'a distinct delivery in the same slot reuses the exact terminal result'
);
select throws_ok(
  format(
    'select * from public.run_hosted_manual_cycle(%L,%L,%L,%L,%L)',
    '95000000-0000-4000-8000-000000000101',
    (select experiment_id from hosted_cycle_experiments where label = 'eligible'),
    '1', '2026-08-06 15:15:01+00', 'RUN PAPER CYCLE'
  ),
  '23505',
  'manual cycle operation id was reused with different input',
  'an operation UUID cannot be reused with a changed decision boundary'
);

insert into hosted_cycle_results
select 'closed', result.*
from public.run_hosted_manual_cycle(
  '95000000-0000-4000-8000-000000000103',
  (select experiment_id from hosted_cycle_experiments where label = 'closed'),
  '1',
  '2026-07-03 15:00:01+00',
  'RUN PAPER CYCLE'
) as result;
select is(
  (
    select status || ':' || reason || ':' || replayed::text
    from hosted_cycle_results where label = 'closed'
  ),
  'skipped:market_closed:false',
  'an official closed session records only a market-closed skip'
);

select ok(
  (
    select state.ready
      and state.last_scheduler_run_id = stored.scheduler_run_id
      and state.last_simulator_run_id = stored.simulator_run_id
      and state.last_slot_key = stored.slot_key
      and state.last_status = 'skipped'
      and state.last_reason = stored.reason
      and state.last_decision_at = stored.decision_at
    from public.hosted_manual_cycle_state(
      (select experiment_id from hosted_cycle_experiments where label = 'eligible')
    ) as state
    cross join hosted_cycle_results as stored
    where stored.label = 'eligible'
  ),
  'the state projection exposes only the latest sanitized skipped-run evidence'
);

reset role;
update public.experiment_controls
set scheduler_enabled = true
where experiment_id = (
  select experiment_id from hosted_cycle_experiments where label = 'eligible'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select user_id from hosted_cycle_test_owner),
    'role', 'authenticated'
  )::text,
  true
);
select ok(
  (
    select not state.ready
      and state.reason = 'remote_scheduler_must_remain_disabled'
    from public.hosted_manual_cycle_state(
      (select experiment_id from hosted_cycle_experiments where label = 'eligible')
    ) as state
  ),
  'the manual control fails closed if the remote scheduler is enabled'
);
select throws_ok(
  format(
    'select * from public.run_hosted_manual_cycle(%L,%L,%L,%L,%L)',
    '95000000-0000-4000-8000-000000000104',
    (select experiment_id from hosted_cycle_experiments where label = 'eligible'),
    '1', '2026-08-06 15:15:01+00', 'RUN PAPER CYCLE'
  ),
  '55000',
  'experiment is not eligible for a manual paper cycle',
  'the mutation also rejects remote-scheduler drift atomically'
);
reset role;
update public.experiment_controls
set scheduler_enabled = false
where experiment_id = (
  select experiment_id from hosted_cycle_experiments where label = 'eligible'
);

select is(
  (select count(*) from private.scheduler_slots),
  (select scheduler_slots + 2 from hosted_cycle_baseline),
  'two distinct slots create exactly two durable scheduler slots'
);
select is(
  (select count(*) from private.scheduler_runs),
  (select scheduler_runs + 2 from hosted_cycle_baseline),
  'two distinct slots create exactly two skipped scheduler runs'
);
select is(
  (select count(*) from public.simulator_runs),
  (select simulator_runs + 2 from hosted_cycle_baseline),
  'two distinct slots create exactly two skipped simulator journals'
);
select is(
  (select count(*) from private.audit_log),
  (select audit_rows + 3 from hosted_cycle_baseline),
  'fresh slots and one duplicate delivery append three owner audit attestations'
);
select is(
  (select count(*) from private.idempotency_records),
  (select idempotency_rows + 3 from hosted_cycle_baseline),
  'fresh slots and one duplicate delivery finalize three idempotency records'
);
select is(
  (
    select count(*)
    from private.scheduler_runs as run
    join hosted_cycle_experiments as experiment
      on experiment.experiment_id = run.experiment_id
    where run.status = 'skipped'
      and run.retry_eligible = false
      and run.metadata ->> 'contract_id' = 'capital_lab_hosted_manual_cycle_v1'
      and run.metadata ->> 'paper_only' = 'true'
      and run.metadata ->> 'provider_request_made' = 'false'
      and run.metadata ->> 'agent_enabled' = 'false'
      and run.metadata ->> 'model_calls' = '0'
      and run.metadata ->> 'paper_orders_created' = '0'
      and run.metadata ->> 'paper_fills_created' = '0'
  ),
  2::bigint,
  'scheduler journals attest paper-only zero-side-effect execution'
);
select is(
  (
    select count(*)
    from public.simulator_runs as run
    join hosted_cycle_experiments as experiment
      on experiment.experiment_id = run.experiment_id
    where run.status = 'skipped'
      and run.metadata ->> 'contract_id' = 'capital_lab_hosted_manual_cycle_v1'
      and run.metadata ->> 'paper_only' = 'true'
      and run.metadata ->> 'orders_created' = '0'
      and run.metadata ->> 'fills_created' = '0'
      and run.metadata ->> 'ledger_entries_created' = '0'
  ),
  2::bigint,
  'simulator journals attest zero orders, fills, and ledger entries'
);
select is(
  (
    select count(*)
    from private.audit_log as audit
    join hosted_cycle_experiments as experiment
      on experiment.experiment_id = audit.experiment_id
    where audit.action = 'scheduler.hosted_manual_cycle_requested'
      and audit.metadata ->> 'contract_id' = 'capital_lab_hosted_manual_cycle_v1'
      and audit.metadata ->> 'paper_only' = 'true'
      and audit.metadata ->> 'provider_request_made' = 'false'
      and audit.metadata ->> 'agent_enabled' = 'false'
      and audit.metadata ->> 'remote_scheduler_enabled' = 'false'
      and audit.metadata ->> 'model_calls' = '0'
      and audit.metadata ->> 'paper_orders_created' = '0'
      and audit.metadata ->> 'paper_fills_created' = '0'
      and audit.metadata ->> 'ledger_entries_created' = '0'
  ),
  3::bigint,
  'every accepted request has one redacted zero-side-effect audit record'
);

select is(
  (select count(*) from private.ingestion_runs),
  (select ingestion_runs from hosted_cycle_baseline),
  'manual cycles create no ingestion run'
);
select is(
  (select count(*) from public.source_health),
  (select source_health from hosted_cycle_baseline),
  'manual cycles perform no provider request or source-health mutation'
);
select is(
  (select count(*) from public.market_quotes),
  (select market_quotes from hosted_cycle_baseline),
  'manual cycles create no market quote'
);
select is(
  (select count(*) from public.market_bars),
  (select market_bars from hosted_cycle_baseline),
  'manual cycles create no market bar'
);
select is(
  (select count(*) from public.agent_runs),
  (select agent_runs from hosted_cycle_baseline),
  'manual cycles create no agent run'
);
select is(
  (select count(*) from public.agent_decisions),
  (select agent_decisions from hosted_cycle_baseline),
  'manual cycles create no agent decision'
);
select is(
  (select count(*) from private.ai_budget_reservations),
  (select ai_budget_reservations from hosted_cycle_baseline),
  'manual cycles reserve no AI budget'
);
select is(
  (select count(*) from private.ai_usage_events),
  (select ai_usage_events from hosted_cycle_baseline),
  'manual cycles record no AI usage'
);
select is(
  (select count(*) from public.orders),
  (select orders from hosted_cycle_baseline),
  'manual cycles create no paper order'
);
select is(
  (select count(*) from public.fills),
  (select fills from hosted_cycle_baseline),
  'manual cycles create no paper fill'
);
select is(
  (select count(*) from private.cash_ledger_entries),
  (select ledger_entries from hosted_cycle_baseline),
  'manual cycles create no cash-ledger entry'
);
select is(
  (select count(*) from public.position_lots),
  (select position_lots from hosted_cycle_baseline),
  'manual cycles create no position lot'
);
select is(
  (select count(*) from public.positions),
  (select positions from hosted_cycle_baseline),
  'manual cycles create or mutate no position'
);
select is(
  (select count(*) from public.portfolio_snapshots),
  (select portfolio_snapshots from hosted_cycle_baseline),
  'manual cycles create no P&L or portfolio snapshot'
);
select is(
  (
    select count(*)
    from public.experiment_controls as controls
    join hosted_cycle_experiments as experiment
      on experiment.experiment_id = controls.experiment_id
    where not controls.scheduler_enabled
      and not controls.agent_enabled
      and not controls.emergency_paused
  ),
  2::bigint,
  'both autonomous runtime controls remain disabled after the cycle rehearsal'
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
  'all reviewed market and calendar data sources remain runtime-disabled'
);
select is(
  (
    select setting.value
    from private.application_settings as setting
    where setting.owner_id = (select user_id from hosted_cycle_test_owner)
      and setting.setting_key = 'scheduler_provider'
      and not setting.is_secret
  ),
  '"manual"'::jsonb,
  'the reviewed scheduler provider remains manual'
);

select * from finish();
rollback;
