-- Activation-readiness schema only. This migration deliberately installs no
-- extension, reads or writes no Vault secret, creates no Cron job, performs no
-- HTTP request, and enables no scheduler, agent, provider, or paid-model flag.
begin;

create table private.no_ai_shadow_dry_runs (
  id uuid primary key,
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  run_type text not null check (run_type = 'no_ai_shadow_infrastructure_dry_run'),
  state text not null check (state in (
    'prepared', 'infra_installed', 'vault_verified',
    'jobs_installed_disabled', 'auth_noop_verified', 'baseline_frozen',
    'armed', 'running', 'auto_stopped', 'reconciled',
    'passed', 'failed', 'aborted'
  )),
  config_version text not null check (length(btrim(config_version)) between 1 and 128),
  prepared_commit_sha text not null check (prepared_commit_sha ~ '^[0-9a-f]{40}$'),
  scheduler_control_enabled boolean not null default false,
  decision_at timestamptz,
  planned_start_at timestamptz,
  first_session_date date,
  second_session_date date,
  planned_end_at timestamptz,
  expected_slot_count integer check (expected_slot_count is null or expected_slot_count > 0),
  expected_event_count integer check (expected_event_count is null or expected_event_count > 0),
  failure_code text,
  prepared_at timestamptz not null default statement_timestamp(),
  started_at timestamptz,
  stopped_at timestamptz,
  archived_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  unique (owner_id, run_type),
  check (
    (planned_start_at is null and first_session_date is null
      and second_session_date is null and planned_end_at is null)
    or
    (planned_start_at is not null and first_session_date is not null
      and second_session_date > first_session_date
      and planned_end_at > planned_start_at)
  ),
  check (archived_at is null or state in ('passed', 'failed', 'aborted'))
);

create trigger no_ai_shadow_dry_runs_set_updated_at
before update on private.no_ai_shadow_dry_runs
for each row execute function private.set_updated_at();

create table private.no_ai_shadow_dry_run_transitions (
  id uuid primary key default gen_random_uuid(),
  dry_run_id uuid not null references private.no_ai_shadow_dry_runs(id) on delete restrict,
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  from_state text,
  to_state text not null,
  actor text not null check (actor in ('migration', 'owner', 'admin_script', 'scheduler', 'system')),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  config_version text not null,
  correlation_id uuid not null,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  occurred_at timestamptz not null default statement_timestamp(),
  unique (dry_run_id, to_state),
  unique (correlation_id, dry_run_id, to_state)
);

create trigger no_ai_shadow_dry_run_transitions_reject_mutation
before update or delete on private.no_ai_shadow_dry_run_transitions
for each row execute function private.reject_mutation();

create table private.no_ai_shadow_dry_run_events (
  id uuid primary key default gen_random_uuid(),
  dry_run_id uuid not null references private.no_ai_shadow_dry_runs(id) on delete restrict,
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  exchange_session_id uuid not null references public.market_sessions(id) on delete restrict,
  session_date date not null,
  slot_number smallint not null check (slot_number between 0 and 25),
  event_type text not null check (event_type in ('market_dispatcher', 'reconciler')),
  expected_at timestamptz not null,
  cron_trigger_count integer not null default 0 check (cron_trigger_count >= 0),
  pg_net_request_id bigint unique,
  http_status integer check (http_status is null or http_status between 100 and 599),
  timed_out boolean,
  response_error_class text,
  authenticated_count integer not null default 0 check (authenticated_count >= 0),
  claimed_cycle_count integer not null default 0 check (claimed_cycle_count >= 0),
  terminal_reason text,
  model_call_count integer not null default 0 check (model_call_count >= 0),
  budget_reservation_count integer not null default 0 check (budget_reservation_count >= 0),
  order_count integer not null default 0 check (order_count >= 0),
  fill_count integer not null default 0 check (fill_count >= 0),
  ledger_entry_count integer not null default 0 check (ledger_entry_count >= 0),
  correlation_id uuid,
  completed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  unique (dry_run_id, event_type, session_date, slot_number),
  unique (id, owner_id)
);

create index no_ai_shadow_dry_run_events_due_idx
on private.no_ai_shadow_dry_run_events(dry_run_id, event_type, expected_at);
create index no_ai_shadow_dry_run_events_owner_idx
on private.no_ai_shadow_dry_run_events(owner_id, expected_at);

create table private.no_ai_shadow_dry_run_baselines (
  dry_run_id uuid primary key references private.no_ai_shadow_dry_runs(id) on delete restrict,
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  agent_run_count bigint not null,
  budget_reservation_count bigint not null,
  ai_usage_count bigint not null,
  order_count bigint not null,
  fill_count bigint not null,
  ledger_entry_count bigint not null,
  frozen_at timestamptz not null default statement_timestamp(),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  config_version text not null
);

create table private.no_ai_shadow_dry_run_alarms (
  id uuid primary key default gen_random_uuid(),
  dry_run_id uuid not null references private.no_ai_shadow_dry_runs(id) on delete restrict,
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  alarm_key text not null,
  alarm_class text not null check (alarm_class in (
    'forbidden_delta', 'missing_slot', 'duplicate_slot', 'auth_failure',
    'http_failure', 'possibly_charged', 'stale_lease',
    'unexpected_control', 'planned_end_elapsed', 'security_boundary'
  )),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  first_seen_at timestamptz not null default statement_timestamp(),
  unique (dry_run_id, alarm_key)
);

create index no_ai_shadow_dry_run_transitions_owner_idx
on private.no_ai_shadow_dry_run_transitions(owner_id, occurred_at desc);
create index no_ai_shadow_dry_run_baselines_owner_idx
on private.no_ai_shadow_dry_run_baselines(owner_id);
create index no_ai_shadow_dry_run_alarms_owner_idx
on private.no_ai_shadow_dry_run_alarms(owner_id, first_seen_at desc);

create trigger no_ai_shadow_dry_run_alarms_reject_mutation
before update or delete on private.no_ai_shadow_dry_run_alarms
for each row execute function private.reject_mutation();

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'no_ai_shadow_dry_runs',
    'no_ai_shadow_dry_run_transitions',
    'no_ai_shadow_dry_run_events',
    'no_ai_shadow_dry_run_baselines',
    'no_ai_shadow_dry_run_alarms'
  ] loop
    execute format('alter table private.%I enable row level security', relation_name);
    execute format('alter table private.%I force row level security', relation_name);
    execute format(
      'revoke all on table private.%I from public, anon, authenticated',
      relation_name
    );
    execute format('grant all on table private.%I to service_role', relation_name);
  end loop;
end;
$$;

create function private.transition_no_ai_shadow_dry_run(
  p_dry_run_id uuid,
  p_expected_state text,
  p_target_state text,
  p_actor text,
  p_commit_sha text,
  p_config_version text,
  p_correlation_id uuid,
  p_evidence jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row private.no_ai_shadow_dry_runs%rowtype;
  transition_allowed boolean := false;
begin
  if p_dry_run_id is null or p_expected_state is null or p_target_state is null
    or p_actor not in ('migration', 'owner', 'admin_script', 'scheduler', 'system')
    or p_commit_sha !~ '^[0-9a-f]{40}$'
    or length(btrim(coalesce(p_config_version, ''))) not between 1 and 128
    or p_correlation_id is null or jsonb_typeof(p_evidence) <> 'object'
  then
    raise exception using errcode = '22023', message = 'activation transition evidence is invalid';
  end if;

  select * into strict current_row
  from private.no_ai_shadow_dry_runs
  where id = p_dry_run_id
  for update;

  if current_row.state <> p_expected_state
    or current_row.config_version <> p_config_version
  then
    raise exception using errcode = '55000', message = 'activation state or config version drifted';
  end if;

  transition_allowed := case current_row.state
    when 'prepared' then p_target_state in ('infra_installed', 'failed', 'aborted')
    when 'infra_installed' then p_target_state in ('vault_verified', 'failed', 'aborted')
    when 'vault_verified' then p_target_state in ('jobs_installed_disabled', 'failed', 'aborted')
    when 'jobs_installed_disabled' then p_target_state in ('auth_noop_verified', 'failed', 'aborted')
    when 'auth_noop_verified' then p_target_state in ('baseline_frozen', 'failed', 'aborted')
    when 'baseline_frozen' then p_target_state in ('armed', 'failed', 'aborted')
    when 'armed' then p_target_state in ('running', 'failed', 'aborted')
    when 'running' then p_target_state in ('auto_stopped', 'failed', 'aborted')
    when 'auto_stopped' then p_target_state in ('reconciled', 'failed', 'aborted')
    when 'reconciled' then p_target_state in ('passed', 'failed', 'aborted')
    else false
  end;
  if not transition_allowed then
    raise exception using errcode = '55000', message = 'activation state transition is forbidden';
  end if;

  update private.no_ai_shadow_dry_runs
  set state = p_target_state,
      scheduler_control_enabled = case
        when p_target_state in ('auto_stopped', 'reconciled', 'passed', 'failed', 'aborted') then false
        else scheduler_control_enabled
      end,
      started_at = case when p_target_state = 'running' then statement_timestamp() else started_at end,
      stopped_at = case when p_target_state in ('auto_stopped', 'failed', 'aborted') then statement_timestamp() else stopped_at end,
      archived_at = case when p_target_state in ('passed', 'failed', 'aborted') then statement_timestamp() else archived_at end,
      failure_code = case when p_target_state in ('failed', 'aborted') then p_evidence ->> 'reason_code' else failure_code end
  where id = p_dry_run_id;

  insert into private.no_ai_shadow_dry_run_transitions (
    dry_run_id, owner_id, from_state, to_state, actor, commit_sha,
    config_version, correlation_id, evidence
  ) values (
    current_row.id, current_row.owner_id, current_row.state, p_target_state,
    p_actor, p_commit_sha, p_config_version, p_correlation_id, p_evidence
  );
end;
$$;

create function private.prepare_no_ai_shadow_dry_run(
  p_commit_sha text,
  p_config_version text,
  p_correlation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  stable_id constant uuid := '6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001';
  target_owner uuid;
begin
  if p_commit_sha !~ '^[0-9a-f]{40}$'
    or length(btrim(coalesce(p_config_version, ''))) not between 1 and 128
    or p_correlation_id is null
  then
    raise exception using errcode = '22023', message = 'dry-run preparation evidence is invalid';
  end if;

  select app_user.user_id into strict target_owner
  from public.app_users as app_user
  where app_user.role = 'owner' and app_user.is_active;

  insert into private.no_ai_shadow_dry_runs (
    id, owner_id, run_type, state, config_version, prepared_commit_sha
  ) values (
    stable_id, target_owner, 'no_ai_shadow_infrastructure_dry_run',
    'prepared', p_config_version, p_commit_sha
  ) on conflict (id) do nothing;

  if not exists (
    select 1 from private.no_ai_shadow_dry_runs
    where id = stable_id and owner_id = target_owner
      and run_type = 'no_ai_shadow_infrastructure_dry_run'
      and config_version = p_config_version
      and prepared_commit_sha = p_commit_sha
  ) then
    raise exception using errcode = '55000', message = 'stable dry-run identity drifted';
  end if;

  insert into private.no_ai_shadow_dry_run_transitions (
    dry_run_id, owner_id, from_state, to_state, actor, commit_sha,
    config_version, correlation_id, evidence
  ) values (
    stable_id, target_owner, null, 'prepared', 'admin_script', p_commit_sha,
    p_config_version, p_correlation_id,
    jsonb_build_object('run_type', 'no_ai_shadow_infrastructure_dry_run')
  ) on conflict (dry_run_id, to_state) do nothing;
  return stable_id;
end;
$$;

create function private.plan_no_ai_shadow_dry_run(
  p_dry_run_id uuid,
  p_activated_at timestamptz,
  p_decision_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  dry_run private.no_ai_shadow_dry_runs%rowtype;
  first_session public.market_sessions%rowtype;
  second_session public.market_sessions%rowtype;
  expected_slots integer;
  coverage_missing integer;
begin
  if p_activated_at is null or p_decision_at is null or p_activated_at > p_decision_at then
    raise exception using errcode = '22023', message = 'dry-run planning boundary is invalid';
  end if;
  select * into strict dry_run from private.no_ai_shadow_dry_runs
  where id = p_dry_run_id for update;
  if dry_run.state <> 'auth_noop_verified' then
    raise exception using errcode = '55000', message = 'dry-run is not ready for baseline planning';
  end if;
  if exists (
    select 1 from public.experiments
    where owner_id = dry_run.owner_id and lifecycle_status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'another active experiment blocks infrastructure dry run';
  end if;

  select session.* into strict first_session
  from public.market_sessions as session
  join public.exchanges as exchange on exchange.id = session.exchange_id
  where exchange.mic = 'XNAS'
    and session.session_type = 'regular'
    and session.available_at <= p_decision_at
    and session.opens_at > p_activated_at
    and session.closes_at - session.opens_at = interval '6 hours 30 minutes'
  order by session.opens_at
  limit 1;

  select session.* into strict second_session
  from public.market_sessions as session
  where session.exchange_id = first_session.exchange_id
    and session.calendar_manifest_id = first_session.calendar_manifest_id
    and session.session_type = 'regular'
    and session.available_at <= p_decision_at
    and session.opens_at > first_session.closes_at
    and session.closes_at - session.opens_at = interval '6 hours 30 minutes'
  order by session.opens_at
  limit 1;

  select count(*) into coverage_missing
  from generate_series(
    (p_activated_at at time zone 'America/New_York')::date,
    second_session.session_date,
    interval '1 day'
  ) as expected(day)
  where extract(isodow from expected.day) between 1 and 5
    and not exists (
      select 1 from public.market_sessions as session
      where session.exchange_id = first_session.exchange_id
        and session.calendar_manifest_id = first_session.calendar_manifest_id
        and session.session_date = expected.day::date
        and session.available_at <= p_decision_at
    );
  if coverage_missing <> 0 then
    raise exception using errcode = '55000', message = 'official calendar coverage is incomplete';
  end if;

  delete from private.no_ai_shadow_dry_run_events where dry_run_id = dry_run.id;
  insert into private.no_ai_shadow_dry_run_events (
    dry_run_id, owner_id, exchange_session_id, session_date,
    slot_number, event_type, expected_at
  )
  select
    dry_run.id, dry_run.owner_id, selected.session_id, selected.session_date,
    generated.slot_number, event_type.event_type,
    generated.slot_at + case when event_type.event_type = 'reconciler'
      then interval '5 minutes' else interval '0' end
  from (
    values
      (first_session.id, first_session.session_date, first_session.opens_at, first_session.closes_at),
      (second_session.id, second_session.session_date, second_session.opens_at, second_session.closes_at)
  ) as selected(session_id, session_date, opens_at, closes_at)
  cross join lateral (
    select slot_at, (row_number() over (order by slot_at) - 1)::smallint as slot_number
    from generate_series(
      selected.opens_at,
      selected.closes_at - interval '15 minutes',
      interval '15 minutes'
    ) as slot_at
  ) as generated
  cross join (values ('market_dispatcher'), ('reconciler')) as event_type(event_type);

  select count(*) / 2 into expected_slots
  from private.no_ai_shadow_dry_run_events where dry_run_id = dry_run.id;
  if expected_slots <> 52 then
    raise exception using errcode = '55000', message = 'expected regular-session slot count is not 52';
  end if;

  update private.no_ai_shadow_dry_runs
  set decision_at = p_decision_at,
      planned_start_at = first_session.opens_at,
      first_session_date = first_session.session_date,
      second_session_date = second_session.session_date,
      planned_end_at = second_session.closes_at + interval '10 minutes',
      expected_slot_count = expected_slots,
      expected_event_count = expected_slots * 2
  where id = dry_run.id;

  return jsonb_build_object(
    'dry_run_id', dry_run.id,
    'run_type', dry_run.run_type,
    'planned_start_at', first_session.opens_at,
    'session_dates', jsonb_build_array(first_session.session_date, second_session.session_date),
    'planned_end_at', second_session.closes_at + interval '10 minutes',
    'expected_slot_count', expected_slots,
    'expected_event_count', expected_slots * 2
  );
end;
$$;

create function private.freeze_no_ai_shadow_dry_run_baseline(
  p_dry_run_id uuid,
  p_commit_sha text,
  p_config_version text,
  p_correlation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dry_run private.no_ai_shadow_dry_runs%rowtype;
begin
  select * into strict dry_run from private.no_ai_shadow_dry_runs
  where id = p_dry_run_id for update;
  if dry_run.state <> 'auth_noop_verified'
    or dry_run.expected_slot_count <> 52 or dry_run.expected_event_count <> 104
  then
    raise exception using errcode = '55000', message = 'dry-run plan is not complete';
  end if;

  insert into private.no_ai_shadow_dry_run_baselines (
    dry_run_id, owner_id, agent_run_count, budget_reservation_count,
    ai_usage_count, order_count, fill_count, ledger_entry_count,
    commit_sha, config_version
  ) values (
    dry_run.id, dry_run.owner_id,
    (select count(*) from public.agent_runs where owner_id = dry_run.owner_id),
    (select count(*) from private.ai_budget_reservations where owner_id = dry_run.owner_id),
    (select count(*) from private.ai_usage_events where owner_id = dry_run.owner_id),
    (select count(*) from public.orders where owner_id = dry_run.owner_id),
    (select count(*) from public.fills where owner_id = dry_run.owner_id),
    (select count(*) from private.cash_ledger_entries where owner_id = dry_run.owner_id),
    p_commit_sha, p_config_version
  ) on conflict (dry_run_id) do nothing;

  perform private.transition_no_ai_shadow_dry_run(
    dry_run.id, 'auth_noop_verified', 'baseline_frozen', 'owner',
    p_commit_sha, p_config_version, p_correlation_id,
    jsonb_build_object(
      'expected_slot_count', dry_run.expected_slot_count,
      'expected_event_count', dry_run.expected_event_count
    )
  );
end;
$$;

create function private.stop_no_ai_shadow_dry_run(
  p_dry_run_id uuid,
  p_alarm_key text,
  p_alarm_class text,
  p_evidence jsonb,
  p_auto_end boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dry_run private.no_ai_shadow_dry_runs%rowtype;
  target_state text;
  job_row record;
begin
  select * into strict dry_run from private.no_ai_shadow_dry_runs
  where id = p_dry_run_id for update;
  if p_alarm_class not in (
    'forbidden_delta', 'missing_slot', 'duplicate_slot', 'auth_failure',
    'http_failure', 'possibly_charged', 'stale_lease',
    'unexpected_control', 'planned_end_elapsed', 'security_boundary'
  ) or length(btrim(coalesce(p_alarm_key, ''))) = 0
    or jsonb_typeof(p_evidence) <> 'object'
  then
    raise exception using errcode = '22023', message = 'dry-run stop evidence is invalid';
  end if;

  insert into private.no_ai_shadow_dry_run_alarms (
    dry_run_id, owner_id, alarm_key, alarm_class, evidence
  ) values (
    dry_run.id, dry_run.owner_id, p_alarm_key, p_alarm_class, p_evidence
  ) on conflict (dry_run_id, alarm_key) do nothing;

  update private.application_settings
  set value = 'false'::jsonb, version = version + 1
  where owner_id = dry_run.owner_id and setting_key in (
    'scheduler_enabled', 'agent_enabled',
    'autonomous_paper_execution_enabled', 'paid_model_calls_enabled',
    'openai_canary_enabled', 'openai_web_search_enabled',
    'sol_challenger_enabled', 'sol_live_execution_enabled',
    'real_broker_enabled'
  ) and value <> 'false'::jsonb;

  update public.experiment_controls
  set scheduler_enabled = false, agent_enabled = false,
      state_version = state_version + 1
  where owner_id = dry_run.owner_id and (scheduler_enabled or agent_enabled);

  update private.no_ai_shadow_dry_runs
  set scheduler_control_enabled = false
  where id = dry_run.id;

  if to_regclass('cron.job') is not null then
    for job_row in execute
      'select jobid from cron.job where jobname = any($1)'
      using array['capital-lab-no-ai-dispatcher', 'capital-lab-no-ai-reconciler']
    loop
      execute 'select cron.alter_job($1, active := false)' using job_row.jobid;
    end loop;
  end if;

  if dry_run.state in ('passed', 'failed', 'aborted', 'auto_stopped', 'reconciled') then
    return;
  end if;
  target_state := case
    when p_auto_end and dry_run.state = 'running' then 'auto_stopped'
    else 'failed'
  end;
  perform private.transition_no_ai_shadow_dry_run(
    dry_run.id, dry_run.state, target_state, 'system',
    dry_run.prepared_commit_sha, dry_run.config_version, gen_random_uuid(),
    p_evidence || jsonb_build_object('reason_code', p_alarm_key)
  );
end;
$$;

create function private.verify_no_ai_shadow_auth_noop(
  p_dry_run_id uuid,
  p_pg_net_request_id bigint,
  p_http_status integer,
  p_commit_sha text,
  p_config_version text,
  p_correlation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dry_run private.no_ai_shadow_dry_runs%rowtype;
begin
  select * into strict dry_run from private.no_ai_shadow_dry_runs
  where id = p_dry_run_id for update;
  if dry_run.state <> 'jobs_installed_disabled'
    or p_pg_net_request_id is null or p_http_status not between 200 and 299
  then
    raise exception using errcode = '55000', message = 'authorized no-op evidence is incomplete';
  end if;
  perform private.transition_no_ai_shadow_dry_run(
    dry_run.id, 'jobs_installed_disabled', 'auth_noop_verified', 'owner',
    p_commit_sha, p_config_version, p_correlation_id,
    jsonb_build_object(
      'pg_net_request_id', p_pg_net_request_id,
      'http_status', p_http_status,
      'side_effect_count', 0
    )
  );
end;
$$;

create function private.arm_no_ai_shadow_dry_run(
  p_dry_run_id uuid,
  p_commit_sha text,
  p_config_version text,
  p_correlation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dry_run private.no_ai_shadow_dry_runs%rowtype;
  unsafe_setting_count integer;
begin
  select * into strict dry_run from private.no_ai_shadow_dry_runs
  where id = p_dry_run_id for update;
  if dry_run.state <> 'baseline_frozen'
    or dry_run.planned_start_at <= statement_timestamp()
    or dry_run.planned_end_at <= dry_run.planned_start_at
  then
    raise exception using errcode = '55000', message = 'future dry-run plan is not armable';
  end if;
  if exists (
    select 1 from public.experiments
    where owner_id = dry_run.owner_id and lifecycle_status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'another active experiment blocks infrastructure dry run';
  end if;
  if not exists (
    select 1 from public.storage_monitor_snapshots as snapshot
    where snapshot.owner_id = dry_run.owner_id
      and snapshot.captured_at = (
        select max(latest.captured_at)
        from public.storage_monitor_snapshots as latest
        where latest.owner_id = dry_run.owner_id
      )
      and snapshot.threshold_state not in ('block_raw_85', 'pause_90')
  ) then
    raise exception using errcode = '55000', message = 'safe storage baseline is unavailable';
  end if;

  select count(*) into unsafe_setting_count
  from private.application_settings
  where owner_id = dry_run.owner_id
    and setting_key in (
      'agent_enabled', 'autonomous_paper_execution_enabled',
      'paid_model_calls_enabled', 'openai_canary_enabled',
      'openai_web_search_enabled', 'sol_challenger_enabled',
      'sol_live_execution_enabled', 'real_broker_enabled'
    ) and value <> 'false'::jsonb;
  if unsafe_setting_count <> 0 or exists (
    select 1 from public.experiment_controls
    where owner_id = dry_run.owner_id and (
      scheduler_enabled or agent_enabled or emergency_paused
    )
  ) then
    raise exception using errcode = '55000', message = 'unexpected active controls block arming';
  end if;

  update private.application_settings
  set value = case when setting_key = 'scheduler_provider'
        then '"supabase"'::jsonb else 'true'::jsonb end,
      version = version + 1
  where owner_id = dry_run.owner_id
    and setting_key in ('scheduler_provider', 'scheduler_enabled');
  if (select count(*) from private.application_settings
      where owner_id = dry_run.owner_id
        and setting_key in ('scheduler_provider', 'scheduler_enabled')) <> 2
  then
    raise exception using errcode = '55000', message = 'scheduler settings are incomplete';
  end if;

  update private.no_ai_shadow_dry_runs
  set scheduler_control_enabled = true where id = dry_run.id;
  perform private.transition_no_ai_shadow_dry_run(
    dry_run.id, 'baseline_frozen', 'armed', 'owner',
    p_commit_sha, p_config_version, p_correlation_id,
    jsonb_build_object('planned_start_at', dry_run.planned_start_at)
  );
end;
$$;

create function private.dispatch_no_ai_shadow_dry_run_event(
  p_job text,
  p_requested_at timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  dry_run private.no_ai_shadow_dry_runs%rowtype;
  due_event private.no_ai_shadow_dry_run_events%rowtype;
  target_url text;
  shared_secret text;
  request_id bigint;
begin
  if p_job not in ('market_dispatcher', 'reconciler') or p_requested_at is null then
    return null;
  end if;
  select * into dry_run from private.no_ai_shadow_dry_runs
  where state in ('armed', 'running') and scheduler_control_enabled
  order by prepared_at desc limit 1 for update;
  if dry_run.id is null then return null; end if;
  if p_requested_at >= dry_run.planned_end_at then
    perform private.stop_no_ai_shadow_dry_run(
      dry_run.id, 'planned_end_elapsed', 'planned_end_elapsed',
      jsonb_build_object('observed_at', p_requested_at), true
    );
    return null;
  end if;
  if not exists (
    select 1 from private.application_settings
    where owner_id = dry_run.owner_id and setting_key = 'scheduler_enabled'
      and value = 'true'::jsonb
  ) then return null; end if;

  select * into due_event
  from private.no_ai_shadow_dry_run_events
  where dry_run_id = dry_run.id and event_type = p_job
    and expected_at between p_requested_at - interval '2 minutes'
      and p_requested_at + interval '2 minutes'
  order by abs(extract(epoch from expected_at - p_requested_at))
  limit 1 for update;
  if due_event.id is null then return null; end if;

  update private.no_ai_shadow_dry_run_events
  set cron_trigger_count = cron_trigger_count + 1
  where id = due_event.id
  returning * into due_event;
  if due_event.cron_trigger_count <> 1 or due_event.pg_net_request_id is not null then
    perform private.stop_no_ai_shadow_dry_run(
      dry_run.id, 'duplicate_event:' || due_event.id::text, 'duplicate_slot',
      jsonb_build_object('event_id', due_event.id, 'event_type', due_event.event_type)
    );
    return null;
  end if;

  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
      into strict target_url using 'capital_lab_scheduler_url';
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
      into strict shared_secret using 'capital_lab_scheduler_shared_secret';
    if length(shared_secret) < 32 then raise no_data_found; end if;

    execute $dynamic$
      select net.http_post(
        url := $1,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || $2
        ),
        body := jsonb_build_object('job', $3),
        timeout_milliseconds := 120000
      )
    $dynamic$ into request_id using target_url, shared_secret, p_job;
  exception when others then
    perform private.stop_no_ai_shadow_dry_run(
      dry_run.id, 'scheduler_security_boundary', 'security_boundary',
      jsonb_build_object('event_id', due_event.id, 'error_class', sqlstate)
    );
    return null;
  end;

  update private.no_ai_shadow_dry_run_events
  set pg_net_request_id = request_id where id = due_event.id;
  return request_id;
end;
$$;

create function private.reconcile_no_ai_shadow_dry_run(
  p_dry_run_id uuid,
  p_observed_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  dry_run private.no_ai_shadow_dry_runs%rowtype;
  baseline private.no_ai_shadow_dry_run_baselines%rowtype;
  event_row private.no_ai_shadow_dry_run_events%rowtype;
  response_row record;
  current_counts bigint[];
  reconciled_count integer := 0;
begin
  select * into strict dry_run from private.no_ai_shadow_dry_runs where id = p_dry_run_id;
  select * into strict baseline from private.no_ai_shadow_dry_run_baselines where dry_run_id = dry_run.id;
  select array[
    (select count(*) from public.agent_runs where owner_id = dry_run.owner_id),
    (select count(*) from private.ai_budget_reservations where owner_id = dry_run.owner_id),
    (select count(*) from private.ai_usage_events where owner_id = dry_run.owner_id),
    (select count(*) from public.orders where owner_id = dry_run.owner_id),
    (select count(*) from public.fills where owner_id = dry_run.owner_id),
    (select count(*) from private.cash_ledger_entries where owner_id = dry_run.owner_id)
  ] into current_counts;
  if current_counts <> array[
    baseline.agent_run_count, baseline.budget_reservation_count,
    baseline.ai_usage_count, baseline.order_count, baseline.fill_count,
    baseline.ledger_entry_count
  ] then
    perform private.stop_no_ai_shadow_dry_run(
      dry_run.id, 'forbidden_database_delta', 'forbidden_delta',
      jsonb_build_object('observed_at', p_observed_at)
    );
    return 0;
  end if;

  if exists (
    select 1 from private.scheduler_slots
    where owner_id = dry_run.owner_id
      and slot_key like 'no-ai-infrastructure:' || dry_run.id::text || ':%'
      and status in ('pending', 'running', 'unknown')
      and lease_until < p_observed_at
  ) then
    perform private.stop_no_ai_shadow_dry_run(
      dry_run.id, 'stale_lease_outside_reconciler_rule', 'stale_lease',
      jsonb_build_object('observed_at', p_observed_at)
    );
    return 0;
  end if;
  if exists (
    select 1 from public.storage_monitor_snapshots as snapshot
    where snapshot.owner_id = dry_run.owner_id
      and snapshot.captured_at = (
        select max(latest.captured_at)
        from public.storage_monitor_snapshots as latest
        where latest.owner_id = dry_run.owner_id
      )
      and snapshot.threshold_state in ('block_raw_85', 'pause_90')
  ) then
    perform private.stop_no_ai_shadow_dry_run(
      dry_run.id, 'storage_safety_boundary', 'security_boundary',
      jsonb_build_object('observed_at', p_observed_at)
    );
    return 0;
  end if;

  if to_regclass('net._http_response') is null then
    perform private.stop_no_ai_shadow_dry_run(
      dry_run.id, 'pg_net_response_boundary_missing', 'security_boundary',
      jsonb_build_object('observed_at', p_observed_at)
    );
    return 0;
  end if;
  for event_row in
    select * from private.no_ai_shadow_dry_run_events
    where dry_run_id = dry_run.id and pg_net_request_id is not null
      and http_status is null and timed_out is null
    for update
  loop
    response_row := null;
    execute
      'select status_code, timed_out, error_msg from net._http_response where id = $1'
      into response_row using event_row.pg_net_request_id;
    if response_row.status_code is not null or response_row.timed_out is not null then
      update private.no_ai_shadow_dry_run_events
      set http_status = response_row.status_code,
          timed_out = coalesce(response_row.timed_out, false),
          response_error_class = case when response_row.error_msg is null then null else 'pg_net_error' end
      where id = event_row.id;
      reconciled_count := reconciled_count + 1;
      if coalesce(response_row.timed_out, false)
        or response_row.status_code is null
        or response_row.status_code not between 200 and 299
      then
        perform private.stop_no_ai_shadow_dry_run(
          dry_run.id, 'http_failure:' || event_row.id::text,
          case when response_row.status_code is null then 'possibly_charged' else 'http_failure' end,
          jsonb_build_object('event_id', event_row.id, 'timed_out', response_row.timed_out)
        );
        return reconciled_count;
      end if;
    elsif p_observed_at > event_row.expected_at + interval '6 minutes' then
      perform private.stop_no_ai_shadow_dry_run(
        dry_run.id, 'missing_http_result:' || event_row.id::text,
        'possibly_charged', jsonb_build_object('event_id', event_row.id)
      );
      return reconciled_count;
    end if;
  end loop;
  return reconciled_count;
end;
$$;

create or replace function private.run_hosted_scheduler_request(
  p_job text,
  p_correlation_id uuid,
  p_cycle_id uuid,
  p_requested_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  dry_run private.no_ai_shadow_dry_runs%rowtype;
  expected_event private.no_ai_shadow_dry_run_events%rowtype;
  slot_identifier text;
  claimed_count integer := 0;
  reconciled_count integer := 0;
  inserted_count integer := 0;
  safe_flag_count integer := 0;
begin
  if p_job not in ('market_dispatcher', 'reconciler')
    or p_correlation_id is null or p_cycle_id is null
    or p_requested_at is null
    or p_requested_at > statement_timestamp() + interval '1 minute'
    or p_requested_at < statement_timestamp() - interval '5 minutes'
  then
    raise exception using errcode = '22023', message = 'scheduler request is invalid';
  end if;

  select * into dry_run from private.no_ai_shadow_dry_runs
  where state in ('armed', 'running') and scheduler_control_enabled
  order by prepared_at desc limit 1 for update;
  if dry_run.id is null then
    return jsonb_build_object(
      'status', 'skipped', 'reason', 'dry_run_not_armed',
      'cycles_claimed', 0, 'cycles_reconciled', 0,
      'model_calls', 0, 'paper_orders_created', 0,
      'paper_fills_created', 0, 'ledger_entries_created', 0
    );
  end if;

  select count(*) into safe_flag_count
  from private.application_settings
  where owner_id = dry_run.owner_id
    and setting_key in (
      'agent_enabled', 'autonomous_paper_execution_enabled',
      'paid_model_calls_enabled', 'openai_canary_enabled',
      'openai_web_search_enabled', 'sol_challenger_enabled',
      'sol_live_execution_enabled', 'real_broker_enabled'
    ) and value = 'false'::jsonb;
  if safe_flag_count <> 8
    or not exists (
      select 1 from private.application_settings
      where owner_id = dry_run.owner_id and setting_key = 'scheduler_enabled'
        and value = 'true'::jsonb
    )
    or exists (
      select 1 from public.experiment_controls
      where owner_id = dry_run.owner_id and (
        scheduler_enabled or agent_enabled or emergency_paused
      )
    )
  then
    perform private.stop_no_ai_shadow_dry_run(
      dry_run.id, 'unexpected_active_controls', 'unexpected_control',
      jsonb_build_object('observed_at', p_requested_at)
    );
    return jsonb_build_object(
      'status', 'skipped', 'reason', 'unexpected_active_controls',
      'cycles_claimed', 0, 'cycles_reconciled', 0,
      'model_calls', 0, 'paper_orders_created', 0,
      'paper_fills_created', 0, 'ledger_entries_created', 0
    );
  end if;

  select * into expected_event
  from private.no_ai_shadow_dry_run_events
  where dry_run_id = dry_run.id and event_type = p_job
    and pg_net_request_id is not null
    and expected_at between p_requested_at - interval '5 minutes'
      and p_requested_at + interval '5 minutes'
  order by abs(extract(epoch from expected_at - p_requested_at))
  limit 1 for update;
  if expected_event.id is null then
    perform private.stop_no_ai_shadow_dry_run(
      dry_run.id, 'unregistered_request:' || p_correlation_id::text,
      'auth_failure', jsonb_build_object('job', p_job)
    );
    return jsonb_build_object(
      'status', 'skipped', 'reason', 'unregistered_expected_event',
      'cycles_claimed', 0, 'cycles_reconciled', 0,
      'model_calls', 0, 'paper_orders_created', 0,
      'paper_fills_created', 0, 'ledger_entries_created', 0
    );
  end if;

  update private.no_ai_shadow_dry_run_events
  set authenticated_count = authenticated_count + 1,
      correlation_id = coalesce(correlation_id, p_correlation_id)
  where id = expected_event.id
  returning * into expected_event;
  if expected_event.authenticated_count <> 1 then
    perform private.stop_no_ai_shadow_dry_run(
      dry_run.id, 'duplicate_auth:' || expected_event.id::text,
      'duplicate_slot', jsonb_build_object('event_id', expected_event.id)
    );
    return jsonb_build_object(
      'status', 'duplicate', 'reason', 'duplicate_expected_event',
      'cycles_claimed', 0, 'cycles_reconciled', 0,
      'model_calls', 0, 'paper_orders_created', 0,
      'paper_fills_created', 0, 'ledger_entries_created', 0
    );
  end if;

  if dry_run.state = 'armed' then
    perform private.transition_no_ai_shadow_dry_run(
      dry_run.id, 'armed', 'running', 'scheduler',
      dry_run.prepared_commit_sha, dry_run.config_version,
      p_correlation_id, jsonb_build_object('first_event_id', expected_event.id)
    );
  end if;

  if p_job = 'market_dispatcher' then
    slot_identifier := 'no-ai-infrastructure:' || dry_run.id::text || ':'
      || expected_event.session_date::text || ':' || expected_event.slot_number::text;
    perform pg_advisory_xact_lock(hashtextextended(slot_identifier, 0));
    insert into private.scheduler_slots (
      slot_key, owner_id, experiment_id, job_type, scheduler_provider,
      exchange_session_id, slot_at, lease_until, attempt_count, status,
      result, session_date, slot_number, lease_owner, heartbeat_at, max_attempts
    ) values (
      slot_identifier, dry_run.owner_id, null,
      'no_ai_shadow_infrastructure_dry_run', 'supabase',
      expected_event.exchange_session_id, expected_event.expected_at,
      p_requested_at + interval '120 seconds', 1, 'running', null,
      expected_event.session_date, expected_event.slot_number,
      p_cycle_id, p_requested_at, 1
    ) on conflict (slot_key) do nothing;
    get diagnostics inserted_count = row_count;
    if inserted_count <> 1 then
      perform private.stop_no_ai_shadow_dry_run(
        dry_run.id, 'duplicate_cycle:' || expected_event.id::text,
        'duplicate_slot', jsonb_build_object('event_id', expected_event.id)
      );
    else
      insert into private.scheduler_runs (
        slot_key, owner_id, experiment_id, correlation_id, status,
        started_at, finished_at, skipped_reason, retry_eligible, metadata,
        heartbeat_at, deadline_at, attempt_number
      ) values (
        slot_identifier, dry_run.owner_id, null, p_correlation_id, 'skipped',
        p_requested_at, p_requested_at, 'no_ai_shadow_dry_run', false,
        jsonb_build_object(
          'dry_run_id', dry_run.id, 'paper_only', true,
          'provider_request_made', false, 'model_calls', 0,
          'budget_reservations', 0, 'paper_orders_created', 0,
          'paper_fills_created', 0, 'ledger_entries_created', 0
        ), p_requested_at, p_requested_at + interval '110 seconds', 1
      );
      update private.scheduler_slots
      set status = 'skipped', heartbeat_at = p_requested_at,
          result = jsonb_build_object(
            'reason', 'no_ai_shadow_dry_run', 'model_calls', 0,
            'budget_reservations', 0, 'paper_orders_created', 0,
            'paper_fills_created', 0, 'ledger_entries_created', 0
          )
      where slot_key = slot_identifier;
      update private.no_ai_shadow_dry_run_events
      set claimed_cycle_count = 1,
          terminal_reason = 'no_ai_shadow_dry_run',
          completed_at = p_requested_at
      where id = expected_event.id;
      claimed_count := 1;
    end if;
  else
    update private.no_ai_shadow_dry_run_events
    set terminal_reason = 'no_ai_shadow_dry_run_reconciler',
        completed_at = p_requested_at
    where id = expected_event.id;
    reconciled_count := private.reconcile_no_ai_shadow_dry_run(
      dry_run.id, p_requested_at
    );
    if exists (
      select 1 from private.no_ai_shadow_dry_run_events
      where dry_run_id = dry_run.id and event_type = 'market_dispatcher'
        and expected_at < p_requested_at - interval '6 minutes'
        and (
          cron_trigger_count <> 1 or pg_net_request_id is null
          or authenticated_count <> 1 or claimed_cycle_count <> 1
          or terminal_reason <> 'no_ai_shadow_dry_run'
        )
    ) then
      perform private.stop_no_ai_shadow_dry_run(
        dry_run.id, 'missing_or_incomplete_dispatcher_slot', 'missing_slot',
        jsonb_build_object('observed_at', p_requested_at)
      );
    end if;
  end if;

  return jsonb_build_object(
    'status', 'completed',
    'reason', case when p_job = 'market_dispatcher'
      then 'no_ai_shadow_cycle_recorded' else 'dry_run_evidence_reconciled' end,
    'cycles_claimed', claimed_count,
    'cycles_reconciled', reconciled_count,
    'model_calls', 0, 'paper_orders_created', 0,
    'paper_fills_created', 0, 'ledger_entries_created', 0
  );
end;
$$;

create function private.finalize_no_ai_shadow_dry_run(
  p_dry_run_id uuid,
  p_commit_sha text,
  p_config_version text,
  p_correlation_id uuid,
  p_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  dry_run private.no_ai_shadow_dry_runs%rowtype;
  incomplete_events integer;
  forbidden_events integer;
begin
  perform private.reconcile_no_ai_shadow_dry_run(p_dry_run_id, p_observed_at);
  select * into strict dry_run from private.no_ai_shadow_dry_runs
  where id = p_dry_run_id for update;
  if dry_run.state <> 'auto_stopped' or p_observed_at < dry_run.planned_end_at then
    raise exception using errcode = '55000', message = 'dry run is not ready for final reconciliation';
  end if;

  select count(*) into incomplete_events
  from private.no_ai_shadow_dry_run_events
  where dry_run_id = dry_run.id and (
    cron_trigger_count <> 1 or pg_net_request_id is null
    or http_status not between 200 and 299 or coalesce(timed_out, true)
    or authenticated_count <> 1
    or terminal_reason is null
    or (event_type = 'market_dispatcher' and (
      claimed_cycle_count <> 1 or terminal_reason <> 'no_ai_shadow_dry_run'
    ))
  );
  select count(*) into forbidden_events
  from private.no_ai_shadow_dry_run_events
  where dry_run_id = dry_run.id and (
    model_call_count <> 0 or budget_reservation_count <> 0
    or order_count <> 0 or fill_count <> 0 or ledger_entry_count <> 0
  );
  if incomplete_events <> 0 or forbidden_events <> 0
    or (select count(*) from private.no_ai_shadow_dry_run_events
        where dry_run_id = dry_run.id) <> 104
    or exists (
      select 1 from private.no_ai_shadow_dry_run_alarms
      where dry_run_id = dry_run.id and alarm_class <> 'planned_end_elapsed'
    )
  then
    perform private.transition_no_ai_shadow_dry_run(
      dry_run.id, 'auto_stopped', 'failed', 'owner',
      p_commit_sha, p_config_version, p_correlation_id,
      jsonb_build_object(
        'reason_code', 'expected_vs_actual_failed',
        'incomplete_events', incomplete_events,
        'forbidden_events', forbidden_events
      )
    );
    return jsonb_build_object('status', 'failed');
  end if;

  perform private.transition_no_ai_shadow_dry_run(
    dry_run.id, 'auto_stopped', 'reconciled', 'owner',
    p_commit_sha, p_config_version, p_correlation_id,
    jsonb_build_object('expected_events', 104, 'actual_events', 104)
  );
  perform private.transition_no_ai_shadow_dry_run(
    dry_run.id, 'reconciled', 'passed', 'owner',
    p_commit_sha, p_config_version, gen_random_uuid(),
    jsonb_build_object('expected_slots', 52, 'actual_slots', 52)
  );
  return jsonb_build_object(
    'status', 'passed', 'expected_slots', 52, 'actual_slots', 52,
    'model_calls', 0, 'budget_reservations', 0,
    'orders', 0, 'fills', 0, 'ledger_entries', 0
  );
end;
$$;

-- Convert the audit migration's operation-id lock into one immutable global
-- campaign lock with one row per exact model. An operation ID is correlation
-- evidence only and cannot authorize another campaign attempt.
do $$
begin
  if exists (select 1 from private.paid_canary_runs) then
    raise exception using
      errcode = '55000',
      message = 'existing Canary evidence blocks the campaign-lock migration';
  end if;
end;
$$;

alter table private.paid_canary_runs
  drop constraint paid_canary_runs_pkey,
  drop constraint paid_canary_runs_operation_id_owner_id_key,
  add column id uuid not null default gen_random_uuid(),
  add column campaign_key text not null default 'openai_postbuild_canary_v1'
    check (campaign_key = 'openai_postbuild_canary_v1'),
  add column model text not null check (
    model in ('gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol')
  ),
  add primary key (id),
  add unique (campaign_key, model),
  add unique (operation_id, model);

create or replace function private.claim_paid_canary(
  p_owner_id uuid,
  p_operation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign constant text := 'openai_postbuild_canary_v1';
begin
  if p_operation_id is null or not exists (
    select 1 from public.app_users as app_user
    where app_user.user_id = p_owner_id
      and app_user.role = 'owner' and app_user.is_active
  ) then
    raise exception using errcode = '42501', message = 'paid Canary owner is unavailable';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(campaign, 0));
  if exists (
    select 1 from private.paid_canary_runs where campaign_key = campaign
  ) then
    return false;
  end if;

  insert into private.paid_canary_runs (
    operation_id, owner_id, campaign_key, model
  ) values
    (p_operation_id, p_owner_id, campaign, 'gpt-5.6-luna'),
    (p_operation_id, p_owner_id, campaign, 'gpt-5.6-terra'),
    (p_operation_id, p_owner_id, campaign, 'gpt-5.6-sol');
  return true;
end;
$$;

revoke all on function private.transition_no_ai_shadow_dry_run(uuid, text, text, text, text, text, uuid, jsonb)
from public, anon, authenticated;
revoke all on function private.prepare_no_ai_shadow_dry_run(text, text, uuid)
from public, anon, authenticated;
revoke all on function private.plan_no_ai_shadow_dry_run(uuid, timestamptz, timestamptz)
from public, anon, authenticated;
revoke all on function private.freeze_no_ai_shadow_dry_run_baseline(uuid, text, text, uuid)
from public, anon, authenticated;
revoke all on function private.stop_no_ai_shadow_dry_run(uuid, text, text, jsonb, boolean)
from public, anon, authenticated;
revoke all on function private.verify_no_ai_shadow_auth_noop(uuid, bigint, integer, text, text, uuid)
from public, anon, authenticated;
revoke all on function private.arm_no_ai_shadow_dry_run(uuid, text, text, uuid)
from public, anon, authenticated;
revoke all on function private.dispatch_no_ai_shadow_dry_run_event(text, timestamptz)
from public, anon, authenticated;
revoke all on function private.reconcile_no_ai_shadow_dry_run(uuid, timestamptz)
from public, anon, authenticated;
revoke all on function private.finalize_no_ai_shadow_dry_run(uuid, text, text, uuid, timestamptz)
from public, anon, authenticated;
grant execute on function private.transition_no_ai_shadow_dry_run(uuid, text, text, text, text, text, uuid, jsonb)
to service_role;
grant execute on function private.prepare_no_ai_shadow_dry_run(text, text, uuid)
to service_role;
grant execute on function private.plan_no_ai_shadow_dry_run(uuid, timestamptz, timestamptz)
to service_role;
grant execute on function private.freeze_no_ai_shadow_dry_run_baseline(uuid, text, text, uuid)
to service_role;
grant execute on function private.stop_no_ai_shadow_dry_run(uuid, text, text, jsonb, boolean)
to service_role;
grant execute on function private.verify_no_ai_shadow_auth_noop(uuid, bigint, integer, text, text, uuid)
to service_role;
grant execute on function private.arm_no_ai_shadow_dry_run(uuid, text, text, uuid)
to service_role;
grant execute on function private.dispatch_no_ai_shadow_dry_run_event(text, timestamptz)
to service_role;
grant execute on function private.reconcile_no_ai_shadow_dry_run(uuid, timestamptz)
to service_role;
grant execute on function private.finalize_no_ai_shadow_dry_run(uuid, text, text, uuid, timestamptz)
to service_role;

commit;
