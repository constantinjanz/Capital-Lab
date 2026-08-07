begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions;
select no_plan();

select ok(
  has_function_privilege(
    'authenticated',
    'public.mutate_locked_experiment_lifecycle(uuid,uuid,text,text,text,text,uuid,text)',
    'EXECUTE'
  ),
  'authenticated owners may request locked lifecycle mutations'
);

select ok(
  not has_function_privilege(
    denied_role,
    'public.mutate_locked_experiment_lifecycle(uuid,uuid,text,text,text,text,uuid,text)',
    'EXECUTE'
  ),
  format('%s cannot request locked lifecycle mutations', denied_role)
)
from (values ('anon'::text), ('public'::text)) as denied(denied_role);

select ok(
  not procedure.prosecdef
    and coalesce(array_to_string(procedure.proconfig, ',') like '%search_path=%', false),
  'the public lifecycle function is a fixed-search-path security invoker'
)
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'mutate_locked_experiment_lifecycle';

select ok(
  procedure.prosecdef
    and coalesce(array_to_string(procedure.proconfig, ',') like '%search_path=%', false),
  'the private lifecycle implementation is a fixed-search-path security definer'
)
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'private'
  and procedure.proname = 'mutate_locked_experiment_lifecycle';

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as acl
    where namespace.nspname in ('public', 'private')
      and procedure.proname = 'mutate_locked_experiment_lifecycle'
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute either lifecycle function'
);

select has_index(
  'public',
  'experiments',
  'experiments_source_experiment_idx',
  'clone provenance has a supporting index'
);

select ok(
  (
    select pg_get_indexdef(index_class.oid)
    from pg_class as index_class
    join pg_namespace as namespace on namespace.oid = index_class.relnamespace
    where namespace.nspname = 'public'
      and index_class.relname = 'experiments_source_experiment_idx'
  ) like '%(source_experiment_id, owner_id)%',
  'clone provenance uses a covering owner-scoped index'
);

select is(
  (
    select data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'experiment_detail_read_view'
      and column_name = 'source_experiment_id'
  ),
  'uuid',
  'the hosted detail view exposes clone provenance'
);

select is(
  (
    select data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'experiment_status_events'
      and column_name = 'from_execution_mode'
  ),
  'text',
  'status evidence records the prior execution mode'
);

select ok(
  strpos(
    pg_get_functiondef(
      'private.mutate_locked_experiment_lifecycle(uuid,uuid,text,text,text,text,uuid,text)'::regprocedure
    ),
    'select controls.*'
  ) < strpos(
    pg_get_functiondef(
      'private.mutate_locked_experiment_lifecycle(uuid,uuid,text,text,text,text,uuid,text)'::regprocedure
    ),
    'select source_experiment.*'
  ),
  'lifecycle mutations lock controls before experiments'
);

-- Keep this suite self-contained when it runs against an unseeded schema.
-- The normal local seed already owns these identifiers, so every insert is an
-- idempotent no-op there. Hosted rollback rehearsals can substitute the owner
-- UUID and create the same paper-only references inside their transaction.
insert into public.exchanges(id, mic, name, timezone, country_code)
values (
  '10000000-0000-0000-0000-000000000001',
  'XTST',
  'Lifecycle test exchange',
  'Etc/UTC',
  'US'
)
on conflict do nothing;

insert into public.instruments(
  id,
  primary_exchange_id,
  symbol,
  name,
  asset_class,
  currency,
  price_increment,
  quantity_increment,
  is_tradable,
  is_shortable,
  active_from
)
values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'CLTST',
  'Capital Lab lifecycle fixture',
  'equity',
  'USD',
  '0.010000000000',
  '1.000000000000',
  true,
  false,
  '2026-01-01'
)
on conflict do nothing;

insert into public.configuration_versions(
  id,
  owner_id,
  config_kind,
  version,
  name,
  config,
  content_hash
)
values
  (
    '40000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'simulator',
    999,
    'Lifecycle simulator fixture',
    '{"paperTradingOnly":true,"fixture":true}',
    repeat('1', 64)
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'risk',
    999,
    'Lifecycle risk fixture',
    '{"paperTradingOnly":true,"fixture":true}',
    repeat('2', 64)
  ),
  (
    '40000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'model_routing',
    999,
    'Lifecycle routing fixture',
    '{"agentEnabled":false,"paperTradingOnly":true}',
    repeat('3', 64)
  ),
  (
    '40000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000001',
    'data_sources',
    999,
    'Lifecycle data fixture',
    '{"marketProvider":"mock","paperTradingOnly":true}',
    repeat('4', 64)
  )
on conflict do nothing;

insert into public.market_universes(
  id,
  owner_id,
  name,
  version,
  description,
  content_hash,
  locked_at
)
values (
  '50000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Lifecycle fixture universe',
  999,
  'Transaction-local lifecycle fixture',
  repeat('5', 64),
  '2026-01-01'
)
on conflict do nothing;

insert into public.ai_budget_policies(
  id,
  owner_id,
  version,
  trading_day_hard_limit,
  monthly_soft_limit,
  monthly_hard_limit,
  lifetime_hard_limit,
  quota_config,
  effective_from
)
values (
  '60000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  999,
  '0.01000000',
  '0.01000000',
  '0.01000000',
  '0.01000000',
  '{"luna":0,"terra":0,"sol":0,"web_search":0}',
  '2026-01-01'
)
on conflict do nothing;

insert into public.prompt_versions(
  id,
  owner_id,
  agent_role,
  version,
  system_prompt,
  output_schema,
  content_hash
)
values (
  '61000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'luna',
  999,
  'Lifecycle fixture prompt. Do not call any model.',
  '{"type":"object"}',
  repeat('6', 64)
)
on conflict do nothing;

insert into public.knowledge_corpus_versions(
  id,
  owner_id,
  version,
  name,
  content_hash,
  available_at
)
values (
  '62000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  999,
  'Lifecycle empty corpus fixture',
  repeat('7', 64),
  '2026-01-01'
)
on conflict do nothing;

-- Two immutable paper experiments exercise the full state machine and the
-- open-order completion guard without touching the seeded experiment history.
insert into public.experiments (
  id,
  owner_id,
  name,
  lifecycle_status,
  execution_mode,
  base_currency,
  initial_capital,
  objective,
  starts_at,
  locked_at,
  locked_version_id
) values
  (
    '73000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'Lifecycle shadow fixture',
    'draft',
    null,
    'EUR',
    '100000.00000000',
    'Exercise owner lifecycle transitions without any real trading capability.',
    null,
    null,
    null
  ),
  (
    '73000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'Completion guard fixture',
    'draft',
    null,
    'EUR',
    '100000.00000000',
    'Prove open simulated orders prevent terminal lifecycle completion.',
    null,
    null,
    null
  );

insert into public.experiment_versions (
  id,
  experiment_id,
  owner_id,
  version,
  market_universe_id,
  simulator_config_version_id,
  risk_config_version_id,
  model_routing_version_id,
  data_source_config_version_id,
  agent_prompt_version_id,
  knowledge_corpus_version_id,
  budget_policy_id,
  initial_capital,
  base_currency,
  objective,
  resolved_rules,
  content_hash
) values
  (
    '73100000-0000-0000-0000-000000000001',
    '73000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    1,
    '50000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000003',
    '40000000-0000-0000-0000-000000000004',
    '61000000-0000-0000-0000-000000000001',
    '62000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    '100000.00000000',
    'EUR',
    'Exercise owner lifecycle transitions without any real trading capability.',
    '{"paperTradingOnly":true,"fixture":true}',
    repeat('9', 64)
  ),
  (
    '73100000-0000-0000-0000-000000000002',
    '73000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    1,
    '50000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000003',
    '40000000-0000-0000-0000-000000000004',
    '61000000-0000-0000-0000-000000000001',
    '62000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    '100000.00000000',
    'EUR',
    'Prove open simulated orders prevent terminal lifecycle completion.',
    '{"paperTradingOnly":true,"fixture":true}',
    repeat('a', 64)
  );

update public.experiments
set lifecycle_status = 'active',
    execution_mode = 'shadow',
    starts_at = '2026-01-02 13:30:00+00',
    locked_at = '2026-01-02 13:29:00+00',
    locked_version_id = case id
      when '73000000-0000-0000-0000-000000000001'::uuid
        then '73100000-0000-0000-0000-000000000001'::uuid
      else '73100000-0000-0000-0000-000000000002'::uuid
    end
where id in (
  '73000000-0000-0000-0000-000000000001',
  '73000000-0000-0000-0000-000000000002'
);

insert into public.experiment_controls (
  experiment_id,
  owner_id,
  scheduler_enabled,
  agent_enabled,
  emergency_paused,
  state_version
) values
  (
    '73000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    false,
    false,
    false,
    0
  ),
  (
    '73000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    false,
    false,
    false,
    0
  );

insert into public.simulation_accounts (
  id,
  experiment_id,
  owner_id,
  base_currency,
  status,
  opened_at
) values
  (
    '73200000-0000-0000-0000-000000000001',
    '73000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'EUR',
    'active',
    '2026-01-02 13:29:00+00'
  ),
  (
    '73200000-0000-0000-0000-000000000002',
    '73000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'EUR',
    'active',
    '2026-01-02 13:29:00+00'
  );

insert into public.orders (
  id,
  simulation_account_id,
  experiment_id,
  owner_id,
  experiment_version_id,
  instrument_id,
  idempotency_key,
  side,
  order_type,
  time_in_force,
  quantity,
  filled_quantity,
  decision_at,
  submitted_at,
  eligible_at,
  current_status
) values (
  '73300000-0000-0000-0000-000000000001',
  '73200000-0000-0000-0000-000000000002',
  '73000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  '73100000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001',
  'lifecycle-open-order-fixture',
  'buy',
  'market',
  'day',
  '1.000000000000',
  '0.000000000000',
  '2026-01-02 13:30:00+00',
  '2026-01-02 13:30:01+00',
  '2026-01-02 13:30:01.250+00',
  'accepted'
);

create temporary table lifecycle_out_of_scope_baseline as
select
  (select count(*) from private.cash_ledger_entries) as cash_ledger_count,
  (select count(*) from public.fills) as fills_count,
  (select count(*) from public.position_lots) as lots_count,
  (select count(*) from public.positions) as positions_count,
  (select count(*) from public.portfolio_snapshots) as portfolio_snapshot_count,
  (select count(*) from private.ai_usage_events) as ai_usage_count,
  (select count(*) from public.agent_runs) as agent_run_count,
  (select count(*) from private.scheduler_slots) as scheduler_slot_count,
  (select count(*) from private.scheduler_runs) as scheduler_run_count;

grant select on lifecycle_out_of_scope_baseline to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000099","role":"authenticated"}',
  true
);

select throws_ok(
  $$select * from public.mutate_locked_experiment_lifecycle(
    '73400000-0000-0000-0000-000000000001',
    '73000000-0000-0000-0000-000000000001',
    '0',
    'pause',
    'Non-owner attempt'
  )$$,
  '42501',
  'locked experiment lifecycle is unavailable',
  'a non-owner cannot mutate an owner experiment'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select throws_ok(
  $$select * from public.mutate_locked_experiment_lifecycle(
    '73400000-0000-0000-0000-000000000002',
    '73000000-0000-0000-0000-000000000001',
    '0',
    'promote_live_paper',
    null,
    'yes',
    '73100000-0000-0000-0000-000000000001'
  )$$,
  '22023',
  'exact live-paper confirmation and locked version are required',
  'live-paper promotion requires the exact phrase'
);

select is(
  (
    select result.execution_mode || ':' || result.control_state_version || ':' || result.replayed::text
    from public.mutate_locked_experiment_lifecycle(
      '73400000-0000-0000-0000-000000000003',
      '73000000-0000-0000-0000-000000000001',
      '0',
      'promote_live_paper',
      null,
      'PROMOTE TO LIVE PAPER',
      '73100000-0000-0000-0000-000000000001'
    ) as result
  ),
  'live_paper:1:false',
  'an explicitly confirmed shadow experiment promotes only to live-paper simulation mode'
);

select ok(
  exists (
    select 1
    from public.experiments as experiment
    join public.experiment_controls as controls
      on controls.experiment_id = experiment.id
      and controls.owner_id = experiment.owner_id
    join public.simulation_accounts as account
      on account.experiment_id = experiment.id
      and account.owner_id = experiment.owner_id
    where experiment.id = '73000000-0000-0000-0000-000000000001'
      and experiment.lifecycle_status = 'active'
      and experiment.execution_mode = 'live_paper'
      and experiment.locked_version_id = '73100000-0000-0000-0000-000000000001'
      and controls.state_version = 1
      and not controls.scheduler_enabled
      and not controls.agent_enabled
      and not controls.emergency_paused
      and account.status = 'active'
  ),
  'promotion preserves the lock and leaves every runtime control disabled'
);

select ok(
  exists (
    select 1
    from public.experiment_status_events as event
    where event.experiment_id = '73000000-0000-0000-0000-000000000001'
      and event.from_status = 'active'
      and event.to_status = 'active'
      and event.from_execution_mode = 'shadow'
      and event.to_execution_mode = 'live_paper'
      and event.reason_code = 'live_paper_promoted'
      and event.correlation_id = '73400000-0000-0000-0000-000000000003'
  ),
  'promotion records the execution-mode transition explicitly'
);

select is(
  (
    select result.execution_mode || ':' || result.control_state_version || ':' || result.replayed::text
    from public.mutate_locked_experiment_lifecycle(
      '73400000-0000-0000-0000-000000000003',
      '73000000-0000-0000-0000-000000000001',
      '0',
      'promote_live_paper',
      null,
      'PROMOTE TO LIVE PAPER',
      '73100000-0000-0000-0000-000000000001'
    ) as result
  ),
  'live_paper:1:true',
  'an exact promotion retry returns immutable replay evidence'
);

select is(
  (
    select count(*)
    from private.audit_log as audit
    where audit.correlation_id = '73400000-0000-0000-0000-000000000003'
      and audit.action = 'experiment.promoted_live_paper'
  ),
  1::bigint,
  'a promotion retry does not duplicate audit evidence'
);

select throws_ok(
  $$select * from public.mutate_locked_experiment_lifecycle(
    '73400000-0000-0000-0000-000000000003',
    '73000000-0000-0000-0000-000000000001',
    '1',
    'pause',
    'Changed input'
  )$$,
  '23505',
  'lifecycle operation id was reused with different input',
  'an operation UUID cannot be reused with changed lifecycle input'
);

select throws_ok(
  $$select * from public.mutate_locked_experiment_lifecycle(
    '73400000-0000-0000-0000-000000000004',
    '73000000-0000-0000-0000-000000000001',
    '0',
    'pause',
    'Owner review'
  )$$,
  '40001',
  'experiment controls changed; reload before trying again',
  'a stale control revision fails closed'
);

select is(
  (
    select result.lifecycle_status || ':' || result.control_state_version
    from public.mutate_locked_experiment_lifecycle(
      '73400000-0000-0000-0000-000000000005',
      '73000000-0000-0000-0000-000000000001',
      '1',
      'pause',
      'Owner review'
    ) as result
  ),
  'paused:2',
  'the owner may pause an active live-paper simulation'
);

select ok(
  exists (
    select 1
    from public.experiments as experiment
    join public.experiment_controls as controls on controls.experiment_id = experiment.id
    join public.simulation_accounts as account on account.experiment_id = experiment.id
    where experiment.id = '73000000-0000-0000-0000-000000000001'
      and experiment.lifecycle_status = 'paused'
      and experiment.execution_mode = 'live_paper'
      and experiment.pause_reason = 'Owner review'
      and controls.pause_reason = 'Owner review'
      and controls.state_version = 2
      and not controls.scheduler_enabled
      and not controls.agent_enabled
      and account.status = 'paused'
  ),
  'pause preserves execution mode and synchronizes disabled controls and simulation account state'
);

select is(
  (
    select result.lifecycle_status || ':' || result.control_state_version
    from public.mutate_locked_experiment_lifecycle(
      '73400000-0000-0000-0000-000000000006',
      '73000000-0000-0000-0000-000000000001',
      '2',
      'resume'
    ) as result
  ),
  'active:3',
  'a manual pause resumes to the exact prior live-paper simulation mode'
);

select ok(
  exists (
    select 1
    from public.experiments as experiment
    join public.experiment_controls as controls on controls.experiment_id = experiment.id
    join public.simulation_accounts as account on account.experiment_id = experiment.id
    where experiment.id = '73000000-0000-0000-0000-000000000001'
      and experiment.lifecycle_status = 'active'
      and experiment.execution_mode = 'live_paper'
      and experiment.pause_reason is null
      and controls.pause_reason is null
      and controls.state_version = 3
      and account.status = 'active'
  ),
  'resume clears only the manual pause and preserves the immutable mode'
);

select throws_ok(
  $$select * from public.mutate_locked_experiment_lifecycle(
    '73400000-0000-0000-0000-000000000007',
    '73000000-0000-0000-0000-000000000002',
    '0',
    'complete'
  )$$,
  '55000',
  'experiment is not eligible for completion',
  'an experiment with an open simulated order cannot complete'
);

reset role;

update public.orders
set current_status = 'cancelled'
where id = '73300000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select is(
  (
    select result.lifecycle_status || ':' || result.control_state_version
    from public.mutate_locked_experiment_lifecycle(
      '73400000-0000-0000-0000-000000000007',
      '73000000-0000-0000-0000-000000000002',
      '0',
      'complete'
    ) as result
  ),
  'completed:1',
  'completion succeeds after every simulated order is terminal'
);

select ok(
  exists (
    select 1
    from public.experiments as experiment
    join public.experiment_controls as controls on controls.experiment_id = experiment.id
    join public.simulation_accounts as account on account.experiment_id = experiment.id
    where experiment.id = '73000000-0000-0000-0000-000000000002'
      and experiment.lifecycle_status = 'completed'
      and experiment.ends_at is not null
      and controls.state_version = 1
      and not controls.scheduler_enabled
      and not controls.agent_enabled
      and not controls.emergency_paused
      and account.status = 'closed'
      and account.closed_at is not null
  ),
  'completion closes only the paper simulation lifecycle and account'
);

create temporary table clone_result as
select *
from public.mutate_locked_experiment_lifecycle(
  '73400000-0000-0000-0000-000000000008',
  '73000000-0000-0000-0000-000000000001',
  '3',
  'clone',
  null,
  null,
  null,
  'Cloned lifecycle draft'
);

select is(
  (
    select result.lifecycle_status || ':' || coalesce(result.execution_mode, 'null') || ':' || result.control_state_version
    from clone_result as result
  ),
  'draft:null:0',
  'cloning returns a new disabled draft result'
);

select ok(
  exists (
    select 1
    from clone_result as result
    join public.experiments as clone on clone.id = result.experiment_id
    join public.experiment_controls as controls on controls.experiment_id = clone.id
    join public.experiments as source on source.id = result.source_experiment_id
    where clone.owner_id = '00000000-0000-0000-0000-000000000001'
      and clone.source_experiment_id = source.id
      and clone.lifecycle_status = 'draft'
      and clone.execution_mode is null
      and clone.locked_at is null
      and clone.locked_version_id is null
      and clone.initial_capital = '100000.00000000'::numeric(24,8)
      and clone.base_currency = 'EUR'
      and clone.objective = 'Exercise owner lifecycle transitions without any real trading capability.'
      and clone.draft_revision = 0
      and controls.state_version = 0
      and not controls.scheduler_enabled
      and not controls.agent_enabled
      and not controls.emergency_paused
      and source.locked_version_id = '73100000-0000-0000-0000-000000000001'
  ),
  'clone copies immutable paper metadata with provenance and cannot inherit a lock or runtime controls'
);

select is(
  (
    select controls.state_version
    from public.experiment_controls as controls
    where controls.experiment_id = '73000000-0000-0000-0000-000000000001'
  ),
  4::bigint,
  'clone advances the source control revision without changing source configuration'
);

select is(
  (
    select replay.experiment_id = original.experiment_id and replay.replayed
    from public.mutate_locked_experiment_lifecycle(
      '73400000-0000-0000-0000-000000000008',
      '73000000-0000-0000-0000-000000000001',
      '3',
      'clone',
      null,
      null,
      null,
      'Cloned lifecycle draft'
    ) as replay
    cross join clone_result as original
  ),
  true,
  'an exact clone retry returns the original draft instead of creating another'
);

select is(
  (
    select count(*)
    from public.experiments as experiment
    where experiment.source_experiment_id = '73000000-0000-0000-0000-000000000001'
      and experiment.name = 'Cloned lifecycle draft'
  ),
  1::bigint,
  'clone replay creates exactly one draft'
);

select is(
  (
    select count(*)
    from public.experiment_status_events as event
    join clone_result as result on result.experiment_id = event.experiment_id
    where event.reason_code = 'cloned_to_draft'
      and event.from_status is null
      and event.to_status = 'draft'
      and event.actor_type = 'owner'
      and event.correlation_id = '73400000-0000-0000-0000-000000000008'
  ),
  1::bigint,
  'the clone receives one immutable draft-origin status event'
);

reset role;

select ok(
  not exists (
    select 1
    from private.audit_log as audit
    where audit.action in (
      'experiment.promoted_live_paper',
      'experiment.paused',
      'experiment.resumed',
      'experiment.completed',
      'experiment.cloned'
    )
      and (
        audit.metadata ? 'reason'
        or audit.metadata ? 'objective'
        or audit.metadata ? 'initial_capital'
        or audit.metadata ? 'credentials'
        or audit.metadata ? 'order'
      )
  ),
  'lifecycle audit metadata contains only redacted state evidence'
);

select is(
  (select count(*) from private.cash_ledger_entries),
  (select cash_ledger_count from lifecycle_out_of_scope_baseline),
  'lifecycle actions never write cash ledger entries'
);
select is(
  (select count(*) from public.fills),
  (select fills_count from lifecycle_out_of_scope_baseline),
  'lifecycle actions never create fills'
);
select is(
  (select count(*) from public.position_lots),
  (select lots_count from lifecycle_out_of_scope_baseline),
  'lifecycle actions never create lots'
);
select is(
  (select count(*) from public.positions),
  (select positions_count from lifecycle_out_of_scope_baseline),
  'lifecycle actions never mutate positions'
);
select is(
  (select count(*) from public.portfolio_snapshots),
  (select portfolio_snapshot_count from lifecycle_out_of_scope_baseline),
  'lifecycle actions never create valuation snapshots'
);
select is(
  (select count(*) from private.ai_usage_events),
  (select ai_usage_count from lifecycle_out_of_scope_baseline),
  'lifecycle actions never create AI usage'
);
select is(
  (select count(*) from public.agent_runs),
  (select agent_run_count from lifecycle_out_of_scope_baseline),
  'lifecycle actions never create agent runs'
);
select is(
  (select count(*) from private.scheduler_slots),
  (select scheduler_slot_count from lifecycle_out_of_scope_baseline),
  'lifecycle actions never create scheduler slots'
);
select is(
  (select count(*) from private.scheduler_runs),
  (select scheduler_run_count from lifecycle_out_of_scope_baseline),
  'lifecycle actions never create scheduler runs'
);

reset role;
select * from finish();
rollback;
