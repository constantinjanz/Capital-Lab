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

-- Activation contract v2 hardening. The preceding v1 definitions are replaced
-- in the same transaction below; no caller can observe the intermediate form.
alter table private.no_ai_shadow_dry_runs
  drop constraint no_ai_shadow_dry_runs_state_check,
  add constraint no_ai_shadow_dry_runs_state_check check (state in (
    'prepared', 'infra_installed', 'vault_verified',
    'jobs_installed_disabled', 'auth_noop_claimed', 'auth_noop_verified',
    'baseline_frozen', 'armed', 'running', 'auto_stopped', 'reconciled',
    'passed', 'failed', 'inconclusive', 'aborted'
  )),
  add column manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  add column phase_contract_sha256 text not null check (phase_contract_sha256 ~ '^[0-9a-f]{64}$'),
  add column relation_contract_sha256 text not null check (relation_contract_sha256 ~ '^[0-9a-f]{64}$'),
  add column manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  add column production_origin text not null,
  add column production_host text not null,
  add column scheduler_path text not null check (scheduler_path = '/api/internal/scheduler'),
  add column scheduler_url text not null,
  add column production_deployment_id text not null check (
    production_deployment_id ~ '^dpl_[A-Za-z0-9]{20,64}$'
  ),
  add column vercel_commit_sha text not null check (vercel_commit_sha ~ '^[0-9a-f]{40}$'),
  add column vercel_environment text not null check (vercel_environment = 'production'),
  add column database_fingerprint text not null check (database_fingerprint ~ '^[0-9a-f]{64}$'),
  add column max_request_seconds integer not null default 120 check (max_request_seconds between 1 and 120),
  add column drain_safety_seconds integer not null default 180 check (drain_safety_seconds between 60 and 900),
  add column drain_not_before_at timestamptz,
  add column finalize_not_before_at timestamptz,
  add column emergency_killed_from_state text,
  add unique (id, owner_id),
  add check (scheduler_url = production_origin || scheduler_path),
  add check (vercel_commit_sha = prepared_commit_sha);

alter table private.no_ai_shadow_dry_run_events
  add column request_id uuid not null default gen_random_uuid(),
  add column cycle_id uuid not null default gen_random_uuid(),
  add column response_persisted_at timestamptz,
  add column request_submitted_at timestamptz,
  add column response_status text,
  add column response_terminal_reason text,
  add unique (request_id),
  add unique (cycle_id);

drop trigger if exists no_ai_shadow_dry_run_events_reject_mutation
on private.no_ai_shadow_dry_run_events;

create function private.protect_activation_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'activation event identity is immutable';
  end if;
  if current_setting('capital_lab.internal_event_write', true) is distinct from 'on'
    or row(
      new.id, new.dry_run_id, new.owner_id, new.exchange_session_id,
      new.session_date, new.slot_number, new.event_type, new.expected_at,
      new.request_id, new.cycle_id, new.correlation_id
    ) is distinct from row(
      old.id, old.dry_run_id, old.owner_id, old.exchange_session_id,
      old.session_date, old.slot_number, old.event_type, old.expected_at,
      old.request_id, old.cycle_id, old.correlation_id
    )
  then
    raise exception using
      errcode = '55000',
      message = 'activation event identity is immutable';
  end if;
  return new;
end;
$$;

create trigger no_ai_shadow_dry_run_events_protect_mutation
before update or delete on private.no_ai_shadow_dry_run_events
for each row execute function private.protect_activation_event_mutation();

alter table private.no_ai_shadow_dry_run_transitions
  drop constraint no_ai_shadow_dry_run_transitions_dry_run_id_fkey,
  add constraint no_ai_shadow_dry_run_transitions_campaign_owner_fkey
    foreign key (dry_run_id, owner_id)
    references private.no_ai_shadow_dry_runs(id, owner_id) on delete restrict;
alter table private.no_ai_shadow_dry_run_events
  drop constraint no_ai_shadow_dry_run_events_dry_run_id_fkey,
  add constraint no_ai_shadow_dry_run_events_campaign_owner_fkey
    foreign key (dry_run_id, owner_id)
    references private.no_ai_shadow_dry_runs(id, owner_id) on delete restrict;
alter table private.no_ai_shadow_dry_run_baselines
  drop constraint no_ai_shadow_dry_run_baselines_dry_run_id_fkey,
  add constraint no_ai_shadow_dry_run_baselines_campaign_owner_fkey
    foreign key (dry_run_id, owner_id)
    references private.no_ai_shadow_dry_runs(id, owner_id) on delete restrict;
alter table private.no_ai_shadow_dry_run_alarms
  drop constraint no_ai_shadow_dry_run_alarms_dry_run_id_fkey,
  add constraint no_ai_shadow_dry_run_alarms_campaign_owner_fkey
    foreign key (dry_run_id, owner_id)
    references private.no_ai_shadow_dry_runs(id, owner_id) on delete restrict;

create table private.activation_job_spec_versions (
  campaign_id uuid not null,
  owner_id uuid not null,
  job_role text not null check (job_role in ('dispatcher', 'reconciler')),
  spec_version integer not null check (spec_version > 0),
  jobid bigint not null,
  jobname text not null,
  schedule text not null,
  command text not null,
  database_name text not null,
  username text not null,
  expected_active boolean not null,
  spec_hash text not null check (spec_hash ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default statement_timestamp(),
  operation_id uuid not null,
  correlation_id uuid not null,
  primary key (campaign_id, job_role, spec_version),
  unique (campaign_id, jobid, spec_version),
  foreign key (campaign_id, owner_id)
    references private.no_ai_shadow_dry_runs(id, owner_id) on delete restrict
);

create table private.activation_auth_noop_requests (
  request_id uuid primary key,
  campaign_id uuid not null unique,
  owner_id uuid not null,
  correlation_id uuid not null unique,
  nonce uuid not null unique,
  expected_deployment_id text not null,
  expected_commit_sha text not null check (expected_commit_sha ~ '^[0-9a-f]{40}$'),
  pg_net_request_id bigint unique,
  status text not null check (status in (
    'prepared', 'submitted', 'transport_terminal', 'verified',
    'invalid', 'transport_missing', 'unknown'
  )),
  claimed_at timestamptz not null default statement_timestamp(),
  submitted_at timestamptz,
  terminal_at timestamptz,
  operation_id uuid not null,
  foreign key (campaign_id, owner_id)
    references private.no_ai_shadow_dry_runs(id, owner_id) on delete restrict
);

create table private.activation_http_responses (
  request_id uuid primary key,
  campaign_id uuid not null,
  owner_id uuid not null,
  event_id uuid,
  mode text not null check (mode in ('auth_failure', 'auth_noop', 'dry_run')),
  pg_net_request_id bigint not null unique,
  http_status integer check (http_status between 100 and 599),
  timed_out boolean not null,
  error_class text,
  schema_valid boolean not null,
  correlation_id uuid,
  nonce uuid,
  response_campaign_id uuid,
  response_event_id uuid,
  response_request_id uuid,
  response_cycle_id uuid,
  response_environment text,
  response_deployment_id text,
  response_commit_sha text,
  response_status text,
  response_terminal_reason text,
  response_job text,
  response_slot_number integer,
  scheduler_disabled boolean,
  agent_disabled boolean,
  cycles_claimed integer,
  cycles_reconciled integer,
  counters jsonb check (counters is null or jsonb_typeof(counters) = 'object'),
  observed_at timestamptz not null default statement_timestamp(),
  foreign key (campaign_id, owner_id)
    references private.no_ai_shadow_dry_runs(id, owner_id) on delete restrict,
  foreign key (event_id, owner_id)
    references private.no_ai_shadow_dry_run_events(id, owner_id) on delete restrict
);

create table private.activation_auth_failure_requests (
  request_id uuid primary key,
  campaign_id uuid not null,
  owner_id uuid not null,
  probe_kind text not null check (probe_kind in ('missing', 'invalid')),
  correlation_id uuid not null unique,
  pg_net_request_id bigint unique,
  status text not null check (status in (
    'prepared', 'submitted', 'verified', 'invalid', 'transport_missing', 'unknown'
  )),
  claimed_at timestamptz not null default statement_timestamp(),
  submitted_at timestamptz,
  terminal_at timestamptz,
  operation_id uuid not null,
  unique (campaign_id, probe_kind),
  foreign key (campaign_id, owner_id)
    references private.no_ai_shadow_dry_runs(id, owner_id) on delete restrict
);

create table private.activation_forbidden_relation_specs (
  contract_version text not null check (contract_version = 'activation-side-effects-v2'),
  relation_name text primary key,
  owner_column text not null check (owner_column = 'owner_id'),
  immutable_id_column text,
  time_watermark_column text,
  evidence_rule text not null check (evidence_rule in ('full_row_state', 'full_row_state_and_totals'))
);

insert into private.activation_forbidden_relation_specs (
  contract_version, relation_name, owner_column,
  immutable_id_column, time_watermark_column, evidence_rule
) values
  ('activation-side-effects-v2', 'public.orders', 'owner_id', 'id', 'updated_at', 'full_row_state_and_totals'),
  ('activation-side-effects-v2', 'public.order_status_events', 'owner_id', 'id', 'created_at', 'full_row_state'),
  ('activation-side-effects-v2', 'public.fills', 'owner_id', 'id', 'created_at', 'full_row_state_and_totals'),
  ('activation-side-effects-v2', 'public.fill_market_data_refs', 'owner_id', 'id', 'created_at', 'full_row_state'),
  ('activation-side-effects-v2', 'public.positions', 'owner_id', 'id', 'updated_at', 'full_row_state_and_totals'),
  ('activation-side-effects-v2', 'public.position_lots', 'owner_id', 'id', 'created_at', 'full_row_state'),
  ('activation-side-effects-v2', 'private.cash_ledger_entries', 'owner_id', 'id', 'created_at', 'full_row_state_and_totals'),
  ('activation-side-effects-v2', 'public.agent_runs', 'owner_id', 'id', 'created_at', 'full_row_state'),
  ('activation-side-effects-v2', 'public.agent_decisions', 'owner_id', 'id', 'created_at', 'full_row_state'),
  ('activation-side-effects-v2', 'public.model_routing_events', 'owner_id', 'id', 'created_at', 'full_row_state'),
  ('activation-side-effects-v2', 'public.agent_tool_calls', 'owner_id', 'id', 'created_at', 'full_row_state'),
  ('activation-side-effects-v2', 'public.ai_budget_policies', 'owner_id', 'id', 'created_at', 'full_row_state'),
  ('activation-side-effects-v2', 'private.ai_budget_periods', 'owner_id', 'id', 'updated_at', 'full_row_state'),
  ('activation-side-effects-v2', 'private.ai_budget_reservations', 'owner_id', 'id', 'updated_at', 'full_row_state'),
  ('activation-side-effects-v2', 'private.ai_usage_events', 'owner_id', 'id', 'created_at', 'full_row_state'),
  ('activation-side-effects-v2', 'public.budget_alerts', 'owner_id', 'id', 'created_at', 'full_row_state'),
  ('activation-side-effects-v2', 'public.budget_threshold_alerts', 'owner_id', 'id', 'emitted_at', 'full_row_state'),
  ('activation-side-effects-v2', 'public.model_comparisons', 'owner_id', 'id', 'created_at', 'full_row_state'),
  ('activation-side-effects-v2', 'private.paid_canary_runs', 'owner_id', 'id', 'created_at', 'full_row_state'),
  ('activation-side-effects-v2', 'private.raw_source_events', 'owner_id', 'id', 'ingested_at', 'full_row_state'),
  ('activation-side-effects-v2', 'private.ingestion_runs', 'owner_id', 'id', 'created_at', 'full_row_state'),
  ('activation-side-effects-v2', 'public.news_events', 'owner_id', 'id', 'created_at', 'full_row_state');

create table private.activation_relation_snapshots (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  owner_id uuid not null,
  snapshot_kind text not null check (snapshot_kind in (
    'pre_auth_noop', 'post_auth_failure', 'post_auth_noop',
    'pre_dry_run', 'tick', 'terminal'
  )),
  snapshot_sequence bigint not null check (snapshot_sequence >= 0),
  relation_name text not null references private.activation_forbidden_relation_specs(relation_name) on delete restrict,
  row_count bigint not null check (row_count >= 0),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  max_immutable_id text,
  max_time_watermark timestamptz,
  numeric_totals jsonb not null default '{}'::jsonb check (jsonb_typeof(numeric_totals) = 'object'),
  observed_at timestamptz not null default statement_timestamp(),
  unique (campaign_id, snapshot_kind, snapshot_sequence, relation_name),
  foreign key (campaign_id, owner_id)
    references private.no_ai_shadow_dry_runs(id, owner_id) on delete restrict
);

create table private.activation_control_snapshots (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  owner_id uuid not null,
  snapshot_sequence bigint not null check (snapshot_sequence >= 0),
  dangerous_setting_count integer not null,
  dangerous_non_false_count integer not null,
  experiment_control_count integer not null,
  scheduler_enabled_count integer not null,
  agent_enabled_count integer not null,
  non_paused_count integer not null,
  storage_snapshot_id uuid references public.storage_monitor_snapshots(id) on delete restrict,
  observed_at timestamptz not null default statement_timestamp(),
  unique (campaign_id, snapshot_sequence),
  foreign key (campaign_id, owner_id)
    references private.no_ai_shadow_dry_runs(id, owner_id) on delete restrict
);

create table private.activation_mutation_evidence (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  owner_id uuid not null,
  relation_name text not null,
  mutation_kind text not null check (mutation_kind in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  statement_at timestamptz not null default statement_timestamp(),
  foreign key (campaign_id, owner_id)
    references private.no_ai_shadow_dry_runs(id, owner_id) on delete restrict
);

create table private.activation_terminal_evidence (
  campaign_id uuid primary key,
  owner_id uuid not null,
  terminal_status text not null check (terminal_status in ('passed', 'failed', 'inconclusive')),
  expected_slots integer not null,
  actual_slots integer not null,
  expected_events integer not null,
  actual_events integer not null,
  complete_response_count integer not null,
  missing_response_count integer not null,
  invalid_response_count integer not null,
  forbidden_effect_count integer not null,
  scheduler_controls_disabled boolean not null,
  dangerous_controls_disabled boolean not null,
  jobs_inactive boolean not null,
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  finalized_at timestamptz not null default statement_timestamp(),
  foreign key (campaign_id, owner_id)
    references private.no_ai_shadow_dry_runs(id, owner_id) on delete restrict
);

create function private.activation_database_fingerprint()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(
    database.oid::text || ':' || database.datname || ':'
      || current_setting('server_version_num') || ':' || control.system_identifier::text,
    'UTF8'
  ), 'sha256'), 'hex')
  from pg_catalog.pg_control_system() as control
  cross join pg_catalog.pg_database as database
  where database.datname = current_database();
$$;

create function private.activation_relation_contract_hash()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(
    coalesce(string_agg(to_jsonb(spec)::text, E'\n' order by spec.relation_name), ''),
    'UTF8'
  ), 'sha256'), 'hex')
  from private.activation_forbidden_relation_specs as spec;
$$;

create function private.activation_job_spec_hash(
  p_jobid bigint,
  p_jobname text,
  p_schedule text,
  p_command text,
  p_database_name text,
  p_username text,
  p_expected_active boolean
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(concat_ws(E'\x1f',
    'capital-lab-cron-spec-v2', p_jobid::text, p_jobname, p_schedule,
    p_command, p_database_name, p_username, p_expected_active::text
  ), 'UTF8'), 'sha256'), 'hex');
$$;

create function private.protect_activation_manifest_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(
    new.id, new.owner_id, new.run_type, new.config_version,
    new.prepared_commit_sha, new.manifest_sha256, new.phase_contract_sha256,
    new.relation_contract_sha256, new.manifest, new.production_origin,
    new.production_host, new.scheduler_path, new.scheduler_url,
    new.production_deployment_id, new.vercel_commit_sha,
    new.vercel_environment, new.database_fingerprint
  ) is distinct from row(
    old.id, old.owner_id, old.run_type, old.config_version,
    old.prepared_commit_sha, old.manifest_sha256, old.phase_contract_sha256,
    old.relation_contract_sha256, old.manifest, old.production_origin,
    old.production_host, old.scheduler_path, old.scheduler_url,
    old.production_deployment_id, old.vercel_commit_sha,
    old.vercel_environment, old.database_fingerprint
  ) then
    raise exception using errcode = '55000', message = 'activation manifest identity is immutable';
  end if;
  return new;
end;
$$;

create trigger no_ai_shadow_dry_runs_protect_manifest_identity
before update on private.no_ai_shadow_dry_runs
for each row execute function private.protect_activation_manifest_identity();

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'activation_job_spec_versions', 'activation_auth_noop_requests',
    'activation_auth_failure_requests',
    'activation_http_responses', 'activation_forbidden_relation_specs',
    'activation_relation_snapshots', 'activation_control_snapshots',
    'activation_mutation_evidence', 'activation_terminal_evidence'
  ] loop
    execute format('alter table private.%I enable row level security', relation_name);
    execute format('alter table private.%I force row level security', relation_name);
    execute format(
      'revoke all on table private.%I from public, anon, authenticated, service_role',
      relation_name
    );
  end loop;
  foreach relation_name in array array[
    'activation_job_spec_versions', 'activation_http_responses',
    'activation_forbidden_relation_specs', 'activation_relation_snapshots',
    'activation_control_snapshots', 'activation_mutation_evidence',
    'activation_terminal_evidence', 'no_ai_shadow_dry_run_transitions',
    'no_ai_shadow_dry_run_alarms'
  ] loop
    execute format(
      'create trigger %I before update or delete or truncate on private.%I '
        || 'for each statement execute function private.reject_mutation()',
      relation_name || '_reject_statement_mutation', relation_name
    );
  end loop;
end;
$$;

revoke all on function private.activation_database_fingerprint()
from public, anon, authenticated, service_role;
revoke all on function private.activation_job_spec_hash(bigint, text, text, text, text, text, boolean)
from public, anon, authenticated, service_role;
revoke all on function private.protect_activation_manifest_identity()
from public, anon, authenticated, service_role;

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

create or replace function private.assert_activation_context(
  p_campaign_id uuid,
  p_commit_sha text,
  p_config_version text,
  p_manifest_sha256 text,
  p_phase_contract_sha256 text,
  p_database_fingerprint text
)
returns private.no_ai_shadow_dry_runs
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
begin
  select * into strict campaign
  from private.no_ai_shadow_dry_runs
  where id = p_campaign_id;
  if campaign.prepared_commit_sha <> p_commit_sha
    or campaign.vercel_commit_sha <> p_commit_sha
    or campaign.config_version <> p_config_version
    or campaign.manifest_sha256 <> p_manifest_sha256
    or campaign.phase_contract_sha256 <> p_phase_contract_sha256
    or campaign.database_fingerprint <> p_database_fingerprint
    or private.activation_database_fingerprint() <> p_database_fingerprint
  then
    raise exception using errcode = '55000', message = 'activation commit, manifest, or database target drifted';
  end if;
  return campaign;
end;
$$;

create function private.prepare_no_ai_shadow_dry_run_v2(
  p_campaign_id uuid,
  p_commit_sha text,
  p_config_version text,
  p_manifest_sha256 text,
  p_phase_contract_sha256 text,
  p_relation_contract_sha256 text,
  p_manifest jsonb,
  p_operation_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_owner uuid;
  existing private.no_ai_shadow_dry_runs%rowtype;
  database_fingerprint text := private.activation_database_fingerprint();
begin
  if p_campaign_id is null or p_operation_id is null or p_correlation_id is null
    or p_commit_sha !~ '^[0-9a-f]{40}$'
    or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
    or p_phase_contract_sha256 !~ '^[0-9a-f]{64}$'
    or p_relation_contract_sha256 !~ '^[0-9a-f]{64}$'
    or p_config_version !~ '^[a-z0-9][a-z0-9._-]{0,127}$'
    or jsonb_typeof(p_manifest) <> 'object'
    or p_manifest ->> 'campaign_id' <> p_campaign_id::text
    or p_manifest ->> 'config_version' <> p_config_version
    or p_manifest ->> 'prepared_commit_sha' <> p_commit_sha
    or p_manifest ->> 'vercel_commit_sha' <> p_commit_sha
    or p_manifest ->> 'vercel_environment' <> 'production'
    or p_manifest ->> 'phase_contract_sha256' <> p_phase_contract_sha256
    or p_manifest ->> 'relation_contract_sha256' <> p_relation_contract_sha256
    or p_relation_contract_sha256 <> private.activation_relation_contract_hash()
    or p_manifest #>> '{database_target,database_fingerprint}' <> database_fingerprint
    or p_manifest ->> 'scheduler_path' <> '/api/internal/scheduler'
    or p_manifest ->> 'scheduler_url'
      <> (p_manifest ->> 'production_origin') || '/api/internal/scheduler'
    or p_manifest ->> 'production_origin'
      <> 'https://' || (p_manifest ->> 'production_host')
    or p_manifest ->> 'production_host' !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
    or p_manifest ->> 'production_deployment_id' !~ '^dpl_[A-Za-z0-9]{20,64}$'
    or p_manifest #>> '{providers,market_data}' <> 'mock'
    or p_manifest #>> '{providers,news}' <> 'mock'
    or p_manifest #>> '{providers,execution}' <> 'paper'
    or p_manifest ->> 'expected_slot_count' <> '52'
    or p_manifest ->> 'expected_event_count' <> '104'
    or p_manifest ->> 'max_request_seconds' <> '120'
    or p_manifest ->> 'drain_safety_seconds' <> '180'
    or p_manifest ->> 'minimum_lead_seconds' <> '900'
  then
    raise exception using errcode = '22023', message = 'activation campaign manifest is invalid';
  end if;

  select app_user.user_id into strict target_owner
  from public.app_users as app_user
  where app_user.role = 'owner' and app_user.is_active;

  insert into private.no_ai_shadow_dry_runs (
    id, owner_id, run_type, state, config_version, prepared_commit_sha,
    manifest_sha256, phase_contract_sha256, relation_contract_sha256,
    manifest, production_origin, production_host, scheduler_path,
    scheduler_url, production_deployment_id, vercel_commit_sha,
    vercel_environment, database_fingerprint, max_request_seconds,
    drain_safety_seconds
  ) values (
    p_campaign_id, target_owner, 'no_ai_shadow_infrastructure_dry_run',
    'prepared', p_config_version, p_commit_sha, p_manifest_sha256,
    p_phase_contract_sha256, p_relation_contract_sha256, p_manifest,
    p_manifest ->> 'production_origin', p_manifest ->> 'production_host',
    p_manifest ->> 'scheduler_path', p_manifest ->> 'scheduler_url',
    p_manifest ->> 'production_deployment_id', p_commit_sha, 'production',
    database_fingerprint, (p_manifest ->> 'max_request_seconds')::integer,
    (p_manifest ->> 'drain_safety_seconds')::integer
  ) on conflict (id) do nothing;

  select * into strict existing
  from private.no_ai_shadow_dry_runs
  where id = p_campaign_id for update;
  if row(
    existing.owner_id, existing.config_version, existing.prepared_commit_sha,
    existing.manifest_sha256, existing.phase_contract_sha256,
    existing.relation_contract_sha256, existing.manifest,
    existing.database_fingerprint
  ) is distinct from row(
    target_owner, p_config_version, p_commit_sha, p_manifest_sha256,
    p_phase_contract_sha256, p_relation_contract_sha256, p_manifest,
    database_fingerprint
  ) then
    raise exception using errcode = '55000', message = 'activation campaign identity drifted';
  end if;

  insert into private.no_ai_shadow_dry_run_transitions (
    dry_run_id, owner_id, from_state, to_state, actor, commit_sha,
    config_version, correlation_id, evidence
  ) values (
    existing.id, existing.owner_id, null, 'prepared', 'admin_script',
    p_commit_sha, p_config_version, p_correlation_id,
    jsonb_build_object(
      'operation_id', p_operation_id,
      'manifest_sha256', p_manifest_sha256,
      'database_fingerprint', database_fingerprint
    )
  ) on conflict (dry_run_id, to_state) do nothing;

  return jsonb_build_object(
    'campaign_id', existing.id,
    'state', existing.state,
    'derived_commit_sha', existing.prepared_commit_sha,
    'database_fingerprint', existing.database_fingerprint
  );
end;
$$;

create or replace function private.transition_no_ai_shadow_dry_run(
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
  actor_allowed boolean;
begin
  if p_correlation_id is null or jsonb_typeof(p_evidence) <> 'object' then
    raise exception using errcode = '22023', message = 'activation transition evidence is invalid';
  end if;
  select * into strict current_row
  from private.no_ai_shadow_dry_runs
  where id = p_dry_run_id for update;
  if current_row.state <> p_expected_state
    or current_row.prepared_commit_sha <> p_commit_sha
    or current_row.vercel_commit_sha <> p_commit_sha
    or current_row.config_version <> p_config_version
  then
    raise exception using errcode = '55000', message = 'activation state, commit, or config drifted';
  end if;

  actor_allowed := case
    when p_target_state in ('failed', 'inconclusive', 'aborted')
      then p_actor in ('owner', 'system')
    when p_expected_state = 'prepared' and p_target_state = 'infra_installed'
      then p_actor = 'admin_script'
    when p_expected_state = 'infra_installed' and p_target_state = 'vault_verified'
      then p_actor = 'owner'
    when p_expected_state = 'vault_verified' and p_target_state = 'jobs_installed_disabled'
      then p_actor = 'admin_script'
    when p_expected_state = 'jobs_installed_disabled' and p_target_state = 'auth_noop_claimed'
      then p_actor = 'owner'
    when p_expected_state = 'auth_noop_claimed' and p_target_state = 'auth_noop_verified'
      then p_actor = 'system'
    when p_expected_state = 'auth_noop_verified' and p_target_state = 'baseline_frozen'
      then p_actor = 'owner'
    when p_expected_state = 'baseline_frozen' and p_target_state = 'armed'
      then p_actor = 'owner'
    when p_expected_state = 'armed' and p_target_state = 'running'
      then p_actor = 'scheduler'
    when p_expected_state = 'running' and p_target_state = 'auto_stopped'
      then p_actor = 'system'
    when p_expected_state = 'auto_stopped' and p_target_state = 'reconciled'
      then p_actor = 'system'
    when p_expected_state = 'reconciled' and p_target_state = 'passed'
      then p_actor = 'system'
    else false
  end;
  if not actor_allowed then
    raise exception using errcode = '55000', message = 'actor is forbidden for activation transition';
  end if;

  update private.no_ai_shadow_dry_runs
  set state = p_target_state,
      scheduler_control_enabled = case
        when p_target_state in (
          'auto_stopped', 'reconciled', 'passed', 'failed', 'inconclusive', 'aborted'
        ) then false else scheduler_control_enabled end,
      started_at = case when p_target_state = 'running'
        then statement_timestamp() else started_at end,
      stopped_at = case when p_target_state in (
        'auto_stopped', 'failed', 'inconclusive', 'aborted'
      ) then coalesce(stopped_at, statement_timestamp()) else stopped_at end,
      finalize_not_before_at = case when p_target_state = 'auto_stopped'
        then statement_timestamp() + interval '300 seconds'
        else finalize_not_before_at end,
      archived_at = case when p_target_state in (
        'passed', 'failed', 'inconclusive', 'aborted'
      ) then statement_timestamp() else archived_at end,
      failure_code = case when p_target_state in (
        'failed', 'inconclusive', 'aborted'
      ) then p_evidence ->> 'reason_code' else failure_code end
  where id = current_row.id;

  insert into private.no_ai_shadow_dry_run_transitions (
    dry_run_id, owner_id, from_state, to_state, actor, commit_sha,
    config_version, correlation_id, evidence
  ) values (
    current_row.id, current_row.owner_id, current_row.state, p_target_state,
    p_actor, p_commit_sha, p_config_version, p_correlation_id, p_evidence
  );
end;
$$;

create function private.assert_activation_job_specs(
  p_campaign_id uuid,
  p_expected_active boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  spec record;
  actual record;
  spec_count integer;
  unexpected_count integer;
begin
  if to_regclass('cron.job') is null then
    raise exception using errcode = '55000', message = 'pg_cron job catalog is unavailable';
  end if;
  select count(*) into spec_count
  from (
    select distinct on (job_role) job_role
    from private.activation_job_spec_versions
    where campaign_id = p_campaign_id
    order by job_role, spec_version desc
  ) as current_specs;
  if spec_count <> 2 then
    raise exception using errcode = '55000', message = 'exact persisted Cron job identities are unavailable';
  end if;

  execute $query$
    select count(*)
    from cron.job as job
    where job.jobname like 'capital-lab-%'
      and not exists (
        select 1
        from (
          select distinct on (job_role) jobid
          from private.activation_job_spec_versions
          where campaign_id = $1
          order by job_role, spec_version desc
        ) as expected where expected.jobid = job.jobid
      )
  $query$ into unexpected_count using p_campaign_id;
  if unexpected_count <> 0 then
    raise exception using errcode = '55000', message = 'unexpected Capital Lab Cron job detected';
  end if;

  for spec in
    select distinct on (job_role) *
    from private.activation_job_spec_versions
    where campaign_id = p_campaign_id
    order by job_role, spec_version desc
  loop
    actual := null;
    execute $query$
      select jobid, jobname, schedule, command, database, username, active
      from cron.job where jobid = $1
    $query$ into actual using spec.jobid;
    if actual.jobid is null
      or row(
        actual.jobid, actual.jobname, actual.schedule, actual.command,
        actual.database, actual.username, actual.active
      ) is distinct from row(
        spec.jobid, spec.jobname, spec.schedule, spec.command,
        spec.database_name, spec.username, spec.expected_active
      )
      or spec.spec_hash <> private.activation_job_spec_hash(
        spec.jobid, spec.jobname, spec.schedule, spec.command,
        spec.database_name, spec.username, spec.expected_active
      )
      or (p_expected_active is not null and spec.expected_active <> p_expected_active)
    then
      raise exception using errcode = '55000', message = 'Cron job definition drift or tampering detected';
    end if;
  end loop;
end;
$$;

create function private.register_activation_job_spec(
  p_campaign_id uuid,
  p_job_role text,
  p_jobid bigint,
  p_expected_active boolean,
  p_operation_id uuid,
  p_correlation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  actual record;
  expected_name text;
  expected_schedule text;
  expected_command text;
  next_version integer;
begin
  select * into strict campaign from private.no_ai_shadow_dry_runs
  where id = p_campaign_id for update;
  if p_job_role = 'dispatcher' then
    expected_name := 'capital-lab-no-ai-dispatcher';
    expected_schedule := '*/15 * * * 1-5';
    expected_command := $job$select private.dispatch_no_ai_shadow_dry_run_event('market_dispatcher', statement_timestamp());$job$;
  elsif p_job_role = 'reconciler' then
    expected_name := 'capital-lab-no-ai-reconciler';
    expected_schedule := '5,20,35,50 * * * 1-5';
    expected_command := $job$select private.dispatch_no_ai_shadow_dry_run_event('reconciler', statement_timestamp());$job$;
  else
    raise exception using errcode = '22023', message = 'Cron job role is invalid';
  end if;
  execute $query$
    select jobid, jobname, schedule, command, database, username, active
    from cron.job where jobid = $1
  $query$ into actual using p_jobid;
  if actual.jobid is null
    or row(
      actual.jobname, actual.schedule, actual.command,
      actual.database, actual.username, actual.active
    ) is distinct from row(
      expected_name, expected_schedule, expected_command,
      current_database(), current_user, p_expected_active
    )
  then
    raise exception using errcode = '55000', message = 'Cron job cannot be registered because its full definition differs';
  end if;
  select coalesce(max(spec_version), 0) + 1 into next_version
  from private.activation_job_spec_versions
  where campaign_id = campaign.id and job_role = p_job_role;
  insert into private.activation_job_spec_versions (
    campaign_id, owner_id, job_role, spec_version, jobid, jobname,
    schedule, command, database_name, username, expected_active,
    spec_hash, operation_id, correlation_id
  ) values (
    campaign.id, campaign.owner_id, p_job_role, next_version, p_jobid,
    expected_name, expected_schedule, expected_command, current_database(),
    current_user, p_expected_active,
    private.activation_job_spec_hash(
      p_jobid, expected_name, expected_schedule, expected_command,
      current_database(), current_user, p_expected_active
    ), p_operation_id, p_correlation_id
  );
end;
$$;

create function private.assert_unmanaged_activation_jobs_safe()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actual record;
  expected_schedule text;
  expected_command text;
  match_count integer;
begin
  if to_regclass('cron.job') is null then
    raise exception using errcode = '55000', message = 'pg_cron job catalog is unavailable';
  end if;
  execute $query$
    select count(*) from cron.job
    where jobname like 'capital-lab-%'
      and jobname not in ('capital-lab-no-ai-dispatcher', 'capital-lab-no-ai-reconciler')
  $query$ into match_count;
  if match_count <> 0 then
    raise exception using errcode = '55000', message = 'unexpected Capital Lab Cron job detected before installation';
  end if;
  for actual in execute $query$
    select jobid, jobname, schedule, command, database, username, active
    from cron.job
    where jobname in ('capital-lab-no-ai-dispatcher', 'capital-lab-no-ai-reconciler')
    order by jobname, jobid
  $query$
  loop
    if actual.jobname = 'capital-lab-no-ai-dispatcher' then
      expected_schedule := '*/15 * * * 1-5';
      expected_command := $job$select private.dispatch_no_ai_shadow_dry_run_event('market_dispatcher', statement_timestamp());$job$;
    else
      expected_schedule := '5,20,35,50 * * * 1-5';
      expected_command := $job$select private.dispatch_no_ai_shadow_dry_run_event('reconciler', statement_timestamp());$job$;
    end if;
    if actual.schedule <> expected_schedule or actual.command <> expected_command
      or actual.database <> current_database() or actual.username <> current_user
    then
      raise exception using errcode = '55000', message = 'unmanaged expected-name Cron job has drifted';
    end if;
  end loop;
  execute $query$
    select count(*) from (
      select jobname from cron.job
      where jobname in ('capital-lab-no-ai-dispatcher', 'capital-lab-no-ai-reconciler')
      group by jobname having count(*) > 1
    ) as duplicate_names
  $query$ into match_count;
  if match_count <> 0 then
    raise exception using errcode = '55000', message = 'duplicate expected Cron job name detected';
  end if;
end;
$$;

create function private.set_activation_jobs_active(
  p_campaign_id uuid,
  p_active boolean,
  p_operation_id uuid,
  p_correlation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  spec record;
begin
  perform private.assert_activation_job_specs(p_campaign_id, null);
  if not exists (
    select 1 from (
      select distinct on (job_role) expected_active
      from private.activation_job_spec_versions
      where campaign_id = p_campaign_id
      order by job_role, spec_version desc
    ) as current_specs where expected_active <> p_active
  ) then
    return;
  end if;
  for spec in
    select distinct on (job_role) *
    from private.activation_job_spec_versions
    where campaign_id = p_campaign_id
    order by job_role, spec_version desc
  loop
    execute 'select cron.alter_job($1, active := $2)'
      using spec.jobid, p_active;
    perform private.register_activation_job_spec(
      p_campaign_id, spec.job_role, spec.jobid, p_active,
      p_operation_id, p_correlation_id
    );
  end loop;
  perform private.assert_activation_job_specs(p_campaign_id, p_active);
end;
$$;

create function private.unschedule_activation_jobs(
  p_campaign_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  spec record;
begin
  perform private.assert_activation_job_specs(p_campaign_id, false);
  for spec in
    select distinct on (job_role) *
    from private.activation_job_spec_versions
    where campaign_id = p_campaign_id
    order by job_role, spec_version desc
  loop
    execute 'select cron.unschedule($1)' using spec.jobid;
  end loop;
end;
$$;

alter table public.storage_monitor_snapshots
  drop constraint storage_monitor_snapshots_owner_id_captured_on_key;

create or replace function private.capture_storage_monitor_snapshot(
  p_owner_id uuid,
  p_limit_bytes numeric default 524288000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot_id uuid;
  database_size numeric(20,0);
  utilization numeric(9,4);
  threshold_name text;
  relation_sizes jsonb;
begin
  if p_limit_bytes <= 0 or not exists (
    select 1 from public.app_users as app_user
    where app_user.user_id = p_owner_id
      and app_user.role = 'owner' and app_user.is_active
  ) then
    raise exception using errcode = '22023', message = 'storage monitor input is invalid';
  end if;
  database_size := pg_database_size(current_database());
  utilization := round((database_size * 100) / p_limit_bytes, 4);
  threshold_name := case
    when utilization >= 90 then 'pause_90'
    when utilization >= 85 then 'block_raw_85'
    when utilization >= 75 then 'archive_75'
    when utilization >= 60 then 'warning_60'
    else 'normal' end;
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', relation.schema_name,
    'relation', relation.relation_name,
    'total_bytes', relation.total_bytes::text
  ) order by relation.total_bytes desc), '[]'::jsonb)
  into relation_sizes
  from (
    select namespace.nspname as schema_name, class.relname as relation_name,
      pg_total_relation_size(class.oid) as total_bytes
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname in ('public', 'private')
      and class.relkind in ('r', 'p', 'i')
    order by pg_total_relation_size(class.oid) desc
    limit 15
  ) as relation;
  insert into public.storage_monitor_snapshots (
    owner_id, captured_on, database_bytes, limit_bytes,
    utilization_percent, threshold_state, largest_relations
  ) values (
    p_owner_id, (statement_timestamp() at time zone 'UTC')::date,
    database_size, p_limit_bytes, utilization, threshold_name, relation_sizes
  ) returning id into snapshot_id;
  if utilization >= 85 then
    insert into private.application_settings (
      owner_id, setting_key, value, is_secret
    ) values (
      p_owner_id, 'nonessential_raw_ingest_enabled', 'false'::jsonb, false
    ) on conflict (owner_id, setting_key) do update
    set value = excluded.value,
        version = private.application_settings.version + 1;
  end if;
  if utilization >= 90 then
    update public.experiment_controls
    set agent_enabled = false, scheduler_enabled = false,
        emergency_paused = true,
        pause_reason = 'database_storage_90_percent',
        state_version = state_version + 1
    where owner_id = p_owner_id
      and (agent_enabled or scheduler_enabled or not emergency_paused);
    insert into private.application_settings (
      owner_id, setting_key, value, is_secret
    ) values (p_owner_id, 'scheduler_enabled', 'false'::jsonb, false)
    on conflict (owner_id, setting_key) do update
    set value = excluded.value,
        version = private.application_settings.version + 1;
  end if;
  return jsonb_build_object(
    'snapshot_id', snapshot_id,
    'database_bytes', database_size::text,
    'limit_bytes', p_limit_bytes::text,
    'utilization_percent', utilization::text,
    'threshold_state', threshold_name
  );
end;
$$;

create function private.capture_activation_relation_snapshot(
  p_campaign_id uuid,
  p_snapshot_kind text,
  p_snapshot_sequence bigint
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  spec private.activation_forbidden_relation_specs%rowtype;
  schema_name text;
  table_name text;
  computed_count bigint;
  computed_hash text;
  computed_max_id text;
  computed_max_time timestamptz;
  computed_totals jsonb := '{}'::jsonb;
  persisted private.activation_relation_snapshots%rowtype;
  captured integer := 0;
begin
  if p_snapshot_kind not in (
    'pre_auth_noop', 'post_auth_failure', 'post_auth_noop',
    'pre_dry_run', 'tick', 'terminal'
  ) or p_snapshot_sequence < 0 then
    raise exception using errcode = '22023', message = 'activation snapshot identity is invalid';
  end if;
  select * into strict campaign from private.no_ai_shadow_dry_runs
  where id = p_campaign_id;
  for spec in select * from private.activation_forbidden_relation_specs order by relation_name
  loop
    schema_name := split_part(spec.relation_name, '.', 1);
    table_name := split_part(spec.relation_name, '.', 2);
    execute format($query$
      select count(*), encode(extensions.digest(convert_to(
        coalesce(string_agg(row_data::text, E'\n' order by row_data::text), ''),
        'UTF8'
      ), 'sha256'), 'hex')
      from (
        select to_jsonb(source_row) as row_data
        from %I.%I as source_row
        where source_row.%I = $1
      ) as canonical_rows
    $query$, schema_name, table_name, spec.owner_column)
    into computed_count, computed_hash using campaign.owner_id;
    computed_max_id := null;
    if spec.immutable_id_column is not null then
      execute format(
        'select max(%I::text) from %I.%I where %I = $1',
        spec.immutable_id_column, schema_name, table_name, spec.owner_column
      ) into computed_max_id using campaign.owner_id;
    end if;
    computed_max_time := null;
    if spec.time_watermark_column is not null then
      execute format(
        'select max(%I) from %I.%I where %I = $1',
        spec.time_watermark_column, schema_name, table_name, spec.owner_column
      ) into computed_max_time using campaign.owner_id;
    end if;
    computed_totals := '{}'::jsonb;
    if spec.relation_name = 'private.cash_ledger_entries' then
      select coalesce(jsonb_object_agg(totals.currency, totals.amount order by totals.currency), '{}'::jsonb)
      into computed_totals
      from (
        select currency, sum(amount)::text as amount
        from private.cash_ledger_entries where owner_id = campaign.owner_id
        group by currency
      ) as totals;
    elsif spec.relation_name = 'public.orders' then
      select jsonb_build_object(
        'quantity', coalesce(sum(quantity), 0)::text,
        'filled_quantity', coalesce(sum(filled_quantity), 0)::text
      ) into computed_totals
      from public.orders where owner_id = campaign.owner_id;
    elsif spec.relation_name = 'public.fills' then
      select jsonb_build_object(
        'quantity', coalesce(sum(quantity), 0)::text,
        'notional', coalesce(sum(notional), 0)::text,
        'commission', coalesce(sum(commission), 0)::text,
        'regulatory_fee', coalesce(sum(regulatory_fee), 0)::text
      ) into computed_totals
      from public.fills where owner_id = campaign.owner_id;
    elsif spec.relation_name = 'public.positions' then
      select jsonb_build_object(
        'quantity', coalesce(sum(quantity), 0)::text,
        'realized_pnl_base', coalesce(sum(realized_pnl_base), 0)::text
      ) into computed_totals
      from public.positions where owner_id = campaign.owner_id;
    end if;

    insert into private.activation_relation_snapshots (
      campaign_id, owner_id, snapshot_kind, snapshot_sequence,
      relation_name, row_count, content_hash, max_immutable_id,
      max_time_watermark, numeric_totals
    ) values (
      campaign.id, campaign.owner_id, p_snapshot_kind, p_snapshot_sequence,
      spec.relation_name, computed_count, computed_hash, computed_max_id,
      computed_max_time, computed_totals
    ) on conflict (campaign_id, snapshot_kind, snapshot_sequence, relation_name)
      do nothing;
    select * into strict persisted
    from private.activation_relation_snapshots
    where campaign_id = campaign.id
      and snapshot_kind = p_snapshot_kind
      and snapshot_sequence = p_snapshot_sequence
      and relation_name = spec.relation_name;
    if row(
      persisted.row_count, persisted.content_hash, persisted.max_immutable_id,
      persisted.max_time_watermark, persisted.numeric_totals
    ) is distinct from row(
      computed_count, computed_hash, computed_max_id,
      computed_max_time, computed_totals
    ) then
      raise exception using errcode = '55000', message = 'persisted activation baseline differs on retry';
    end if;
    captured := captured + 1;
  end loop;
  return captured;
end;
$$;

create function private.activation_snapshots_match(
  p_campaign_id uuid,
  p_left_kind text,
  p_left_sequence bigint,
  p_right_kind text,
  p_right_sequence bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) = (select count(*) from private.activation_forbidden_relation_specs)
    and bool_and(row(
      left_snapshot.row_count, left_snapshot.content_hash,
      left_snapshot.max_immutable_id, left_snapshot.max_time_watermark,
      left_snapshot.numeric_totals
    ) is not distinct from row(
      right_snapshot.row_count, right_snapshot.content_hash,
      right_snapshot.max_immutable_id, right_snapshot.max_time_watermark,
      right_snapshot.numeric_totals
    ))
  from private.activation_relation_snapshots as left_snapshot
  join private.activation_relation_snapshots as right_snapshot
    on right_snapshot.campaign_id = left_snapshot.campaign_id
   and right_snapshot.relation_name = left_snapshot.relation_name
   and right_snapshot.snapshot_kind = p_right_kind
   and right_snapshot.snapshot_sequence = p_right_sequence
  where left_snapshot.campaign_id = p_campaign_id
    and left_snapshot.snapshot_kind = p_left_kind
    and left_snapshot.snapshot_sequence = p_left_sequence;
$$;

create function private.capture_activation_control_snapshot(
  p_campaign_id uuid,
  p_snapshot_sequence bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  storage_result jsonb;
begin
  select * into strict campaign from private.no_ai_shadow_dry_runs
  where id = p_campaign_id;
  storage_result := private.capture_storage_monitor_snapshot(campaign.owner_id, 524288000);
  insert into private.activation_control_snapshots (
    campaign_id, owner_id, snapshot_sequence,
    dangerous_setting_count, dangerous_non_false_count,
    experiment_control_count, scheduler_enabled_count,
    agent_enabled_count, non_paused_count, storage_snapshot_id
  ) select
    campaign.id, campaign.owner_id, p_snapshot_sequence,
    (select count(*) from private.application_settings
      where owner_id = campaign.owner_id and setting_key in (
        'scheduler_enabled', 'agent_enabled',
        'autonomous_paper_execution_enabled', 'paid_model_calls_enabled',
        'openai_canary_enabled', 'openai_web_search_enabled',
        'sol_challenger_enabled', 'sol_live_execution_enabled',
        'real_broker_enabled'
      )),
    (select count(*) from private.application_settings
      where owner_id = campaign.owner_id and setting_key in (
        'scheduler_enabled', 'agent_enabled',
        'autonomous_paper_execution_enabled', 'paid_model_calls_enabled',
        'openai_canary_enabled', 'openai_web_search_enabled',
        'sol_challenger_enabled', 'sol_live_execution_enabled',
        'real_broker_enabled'
      ) and value <> 'false'::jsonb),
    (select count(*) from public.experiment_controls where owner_id = campaign.owner_id),
    (select count(*) from public.experiment_controls where owner_id = campaign.owner_id and scheduler_enabled),
    (select count(*) from public.experiment_controls where owner_id = campaign.owner_id and agent_enabled),
    (select count(*) from public.experiment_controls where owner_id = campaign.owner_id and not emergency_paused),
    (storage_result ->> 'snapshot_id')::uuid
  on conflict (campaign_id, snapshot_sequence) do nothing;
end;
$$;

create function private.emergency_kill_activation_controls(
  p_campaign_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
begin
  select * into strict campaign from private.no_ai_shadow_dry_runs
  where id = p_campaign_id for update;
  insert into private.application_settings (
    owner_id, setting_key, value, is_secret
  )
  select campaign.owner_id, key_name, 'false'::jsonb, false
  from unnest(array[
    'scheduler_enabled', 'agent_enabled',
    'autonomous_paper_execution_enabled', 'paid_model_calls_enabled',
    'openai_canary_enabled', 'openai_web_search_enabled',
    'sol_challenger_enabled', 'sol_live_execution_enabled',
    'real_broker_enabled'
  ]) as key_name
  on conflict (owner_id, setting_key) do update
  set value = 'false'::jsonb,
      version = case when private.application_settings.value = 'false'::jsonb
        then private.application_settings.version
        else private.application_settings.version + 1 end;
  update public.experiment_controls
  set scheduler_enabled = false, agent_enabled = false,
      emergency_paused = true,
      pause_reason = coalesce(pause_reason, 'activation_emergency_kill'),
      state_version = case when scheduler_enabled or agent_enabled or not emergency_paused
        then state_version + 1 else state_version end
  where owner_id = campaign.owner_id;
  update private.no_ai_shadow_dry_runs
  set scheduler_control_enabled = false,
      emergency_killed_from_state = case
        when state in ('passed', 'failed', 'inconclusive', 'aborted')
          then emergency_killed_from_state
        else coalesce(emergency_killed_from_state, state)
      end,
      state = case when state in ('passed', 'failed', 'inconclusive', 'aborted')
        then state else 'auto_stopped' end,
      stopped_at = coalesce(stopped_at, statement_timestamp()),
      finalize_not_before_at = coalesce(
        finalize_not_before_at, statement_timestamp() + interval '300 seconds'
      )
  where id = campaign.id;
end;
$$;

create function private.record_activation_forbidden_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
begin
  select * into campaign
  from private.no_ai_shadow_dry_runs
  where state in ('auth_noop_claimed', 'auth_noop_verified', 'baseline_frozen', 'armed', 'running')
  order by prepared_at desc limit 1 for update;
  if campaign.id is not null then
    insert into private.activation_mutation_evidence (
      campaign_id, owner_id, relation_name, mutation_kind
    ) values (
      campaign.id, campaign.owner_id,
      tg_table_schema || '.' || tg_table_name, tg_op
    );
    perform private.emergency_kill_activation_controls(campaign.id);
  end if;
  return null;
end;
$$;

create function private.activation_deterministic_uuid(
  p_campaign_id uuid,
  p_identity text
)
returns uuid
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  digest_hex text;
begin
  if p_campaign_id is null or length(btrim(coalesce(p_identity, ''))) = 0 then
    raise exception using errcode = '22023', message = 'deterministic UUID identity is invalid';
  end if;
  digest_hex := encode(extensions.digest(
    convert_to('capital-lab-activation-v2:' || p_campaign_id::text || ':' || p_identity, 'UTF8'),
    'sha256'
  ), 'hex');
  return (
    substr(digest_hex, 1, 8) || '-' || substr(digest_hex, 9, 4) || '-4'
      || substr(digest_hex, 14, 3) || '-8' || substr(digest_hex, 18, 3)
      || '-' || substr(digest_hex, 21, 12)
  )::uuid;
end;
$$;

create function private.assert_activation_controls(
  p_campaign_id uuid,
  p_scheduler_enabled boolean
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  setting_count integer;
  wrong_count integer;
begin
  select * into strict campaign from private.no_ai_shadow_dry_runs
  where id = p_campaign_id;
  select count(*), count(*) filter (where value is distinct from case
    when setting_key = 'scheduler_enabled' and p_scheduler_enabled then 'true'::jsonb
    else 'false'::jsonb end)
  into setting_count, wrong_count
  from private.application_settings
  where owner_id = campaign.owner_id and setting_key in (
    'scheduler_enabled', 'agent_enabled',
    'autonomous_paper_execution_enabled', 'paid_model_calls_enabled',
    'openai_canary_enabled', 'openai_web_search_enabled',
    'sol_challenger_enabled', 'sol_live_execution_enabled',
    'real_broker_enabled'
  );
  if setting_count <> 9 or wrong_count <> 0
    or exists (
      select 1 from public.experiment_controls
      where owner_id = campaign.owner_id and (scheduler_enabled or agent_enabled)
    )
  then
    raise exception using errcode = '55000', message = 'activation controls are incomplete or unsafe';
  end if;
end;
$$;

create function private.verify_activation_vault_scope(
  p_campaign_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  named_count integer;
  secret_length integer;
  configured_url text;
begin
  select * into strict campaign from private.no_ai_shadow_dry_runs
  where id = p_campaign_id;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception using errcode = '55000', message = 'Vault is unavailable';
  end if;
  execute $query$
    select count(*),
      max(case when name = 'capital_lab_scheduler_shared_secret' then length(decrypted_secret) end),
      max(case when name = 'capital_lab_scheduler_url' then decrypted_secret end)
    from vault.decrypted_secrets
    where name in ('capital_lab_scheduler_url', 'capital_lab_scheduler_shared_secret')
  $query$ into named_count, secret_length, configured_url;
  if named_count <> 2 or secret_length < 32 or configured_url <> campaign.scheduler_url then
    raise exception using errcode = '55000', message = 'Vault scheduler names, scope, or URL identity drifted';
  end if;
end;
$$;

create function private.claim_activation_auth_noop(
  p_campaign_id uuid,
  p_request_id uuid,
  p_nonce uuid,
  p_operation_id uuid,
  p_correlation_id uuid,
  p_commit_sha text,
  p_config_version text,
  p_manifest_sha256 text,
  p_phase_contract_sha256 text,
  p_database_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  claimed private.activation_auth_noop_requests%rowtype;
begin
  campaign := private.assert_activation_context(
    p_campaign_id, p_commit_sha, p_config_version, p_manifest_sha256,
    p_phase_contract_sha256, p_database_fingerprint
  );
  if campaign.state not in ('jobs_installed_disabled', 'auth_noop_claimed') then
    raise exception using errcode = '55000', message = 'auth no-op is unavailable from the persisted state';
  end if;
  perform private.assert_activation_controls(campaign.id, false);
  perform private.assert_activation_job_specs(campaign.id, false);
  perform private.capture_activation_relation_snapshot(campaign.id, 'pre_auth_noop', 0);
  insert into private.activation_auth_noop_requests (
    request_id, campaign_id, owner_id, correlation_id, nonce,
    expected_deployment_id, expected_commit_sha, status, operation_id
  ) values (
    p_request_id, campaign.id, campaign.owner_id, p_correlation_id, p_nonce,
    campaign.production_deployment_id, campaign.prepared_commit_sha,
    'prepared', p_operation_id
  ) on conflict (campaign_id) do nothing;
  select * into strict claimed from private.activation_auth_noop_requests
  where campaign_id = campaign.id for update;
  if row(claimed.request_id, claimed.correlation_id, claimed.nonce,
    claimed.operation_id, claimed.expected_deployment_id, claimed.expected_commit_sha)
    is distinct from row(p_request_id, p_correlation_id, p_nonce,
    p_operation_id, campaign.production_deployment_id, campaign.prepared_commit_sha)
  then
    raise exception using errcode = '55000', message = 'auth no-op identity is immutable; reconcile the original request';
  end if;
  if campaign.state = 'jobs_installed_disabled' then
    perform private.transition_no_ai_shadow_dry_run(
      campaign.id, 'jobs_installed_disabled', 'auth_noop_claimed', 'owner',
      campaign.prepared_commit_sha, campaign.config_version, p_correlation_id,
      jsonb_build_object('request_id', p_request_id, 'nonce_recorded', true)
    );
  end if;
  return jsonb_build_object(
    'request_id', claimed.request_id,
    'correlation_id', claimed.correlation_id,
    'status', claimed.status,
    'reused', claimed.claimed_at < statement_timestamp()
  );
end;
$$;

create function private.submit_activation_auth_failure_probes(
  p_campaign_id uuid,
  p_operation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  requested_probe_kind text;
  probe private.activation_auth_failure_requests%rowtype;
  configured_url text;
  transport_id bigint;
  submitted integer := 0;
begin
  select * into strict campaign from private.no_ai_shadow_dry_runs
  where id = p_campaign_id for update;
  if campaign.state <> 'jobs_installed_disabled' then
    raise exception using errcode = '55000', message = 'auth failure probes require disabled installed jobs';
  end if;
  perform private.assert_activation_controls(campaign.id, false);
  perform private.assert_activation_job_specs(campaign.id, false);
  perform private.capture_activation_relation_snapshot(campaign.id, 'pre_auth_noop', 0);
  perform private.verify_activation_vault_scope(campaign.id);
  execute $query$
    select decrypted_secret from vault.decrypted_secrets
    where name = 'capital_lab_scheduler_url'
  $query$ into configured_url;
  if configured_url <> campaign.scheduler_url then
    raise exception using errcode = '55000', message = 'scheduler URL drifted before auth failure probes';
  end if;
  foreach requested_probe_kind in array array['missing', 'invalid']
  loop
    insert into private.activation_auth_failure_requests (
      request_id, campaign_id, owner_id, probe_kind, correlation_id,
      status, operation_id
    ) values (
      private.activation_deterministic_uuid(campaign.id, 'auth-failure-request:' || requested_probe_kind),
      campaign.id, campaign.owner_id, requested_probe_kind,
      private.activation_deterministic_uuid(campaign.id, 'auth-failure-correlation:' || requested_probe_kind),
      'prepared', p_operation_id
    ) on conflict (campaign_id, probe_kind) do nothing;
    select request.* into strict probe from private.activation_auth_failure_requests as request
    where request.campaign_id = campaign.id
      and request.probe_kind = requested_probe_kind for update;
    if probe.operation_id <> p_operation_id then
      raise exception using errcode = '55000', message = 'auth failure probe operation identity drifted';
    end if;
    if probe.pg_net_request_id is not null then
      continue;
    end if;
    execute $query$
      select net.http_post(
        url := $1,
        headers := case when $2 = 'missing'
          then jsonb_build_object('Content-Type', 'application/json')
          else jsonb_build_object('Content-Type', 'application/json',
            'Authorization', 'Bearer deliberately-invalid-activation-probe') end,
        body := '{}'::jsonb,
        timeout_milliseconds := $3
      )
    $query$ into transport_id using configured_url, requested_probe_kind,
      campaign.max_request_seconds * 1000;
    update private.activation_auth_failure_requests
    set pg_net_request_id = transport_id, status = 'submitted',
      submitted_at = statement_timestamp()
    where request_id = probe.request_id;
    submitted := submitted + 1;
  end loop;
  return submitted;
end;
$$;

create function private.verify_activation_auth_failure_probes(
  p_campaign_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  probe private.activation_auth_failure_requests%rowtype;
  transport record;
  parsed jsonb;
  valid boolean;
begin
  select * into strict campaign from private.no_ai_shadow_dry_runs
  where id = p_campaign_id for update;
  for probe in select * from private.activation_auth_failure_requests
    where campaign_id = campaign.id order by probe_kind
  loop
    if probe.pg_net_request_id is null then
      raise exception using errcode = '55000', message = 'auth failure probe was not submitted';
    end if;
    if exists (select 1 from private.activation_http_responses where request_id = probe.request_id) then
      continue;
    end if;
    execute $query$
      select true as present, status_code, timed_out, error_msg, content
      from net._http_response where id = $1
    $query$ into transport using probe.pg_net_request_id;
    if transport.present is distinct from true then
      update private.activation_auth_failure_requests set status = 'transport_missing'
      where request_id = probe.request_id;
      raise exception using errcode = '55000', message = 'auth failure probe transport evidence is missing';
    end if;
    begin
      parsed := transport.content::jsonb;
    exception when others then
      parsed := null;
    end;
    valid := transport.status_code = 401 and not coalesce(transport.timed_out, true)
      and transport.error_msg is null and parsed = '{"error":"unauthorized"}'::jsonb;
    insert into private.activation_http_responses (
      request_id, campaign_id, owner_id, mode, pg_net_request_id,
      http_status, timed_out, error_class, schema_valid, correlation_id,
      response_campaign_id, response_request_id, response_environment,
      response_status
    ) values (
      probe.request_id, campaign.id, campaign.owner_id, 'auth_failure',
      probe.pg_net_request_id, transport.status_code,
      coalesce(transport.timed_out, true),
      case when transport.error_msg is null then null else 'transport_error' end,
      valid, null, null, null,
      null, 'unauthorized'
    );
    update private.activation_auth_failure_requests
    set status = case when valid then 'verified' else 'invalid' end,
      terminal_at = statement_timestamp()
    where request_id = probe.request_id;
    if not valid then
      raise exception using errcode = '55000', message = 'auth failure probe did not produce exact 401 evidence';
    end if;
  end loop;
  if (select count(*) from private.activation_auth_failure_requests
      where campaign_id = campaign.id and status = 'verified') <> 2 then
    raise exception using errcode = '55000', message = 'both auth failure probes are required';
  end if;
  perform private.capture_activation_relation_snapshot(campaign.id, 'post_auth_failure', 0);
  if not private.activation_snapshots_match(
    campaign.id, 'pre_auth_noop', 0, 'post_auth_failure', 0
  ) then
    raise exception using errcode = '55000', message = 'auth failure probes caused a forbidden side effect';
  end if;
end;
$$;

create function private.submit_activation_auth_noop(
  p_campaign_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  request_row private.activation_auth_noop_requests%rowtype;
  configured_url text;
  shared_secret text;
  transport_id bigint;
begin
  select * into strict campaign from private.no_ai_shadow_dry_runs
  where id = p_campaign_id for update;
  select * into strict request_row from private.activation_auth_noop_requests
  where campaign_id = campaign.id for update;
  if request_row.pg_net_request_id is not null then
    return request_row.pg_net_request_id;
  end if;
  if request_row.status <> 'prepared' or campaign.state <> 'auth_noop_claimed' then
    raise exception using errcode = '55000', message = 'auth no-op must reconcile the existing unknown request';
  end if;
  perform private.assert_activation_controls(campaign.id, false);
  perform private.assert_activation_job_specs(campaign.id, false);
  perform private.verify_activation_vault_scope(campaign.id);
  execute $query$
    select max(case when name = 'capital_lab_scheduler_url' then decrypted_secret end),
      max(case when name = 'capital_lab_scheduler_shared_secret' then decrypted_secret end)
    from vault.decrypted_secrets
    where name in ('capital_lab_scheduler_url', 'capital_lab_scheduler_shared_secret')
  $query$ into configured_url, shared_secret;
  if configured_url <> campaign.scheduler_url or length(shared_secret) < 32 then
    raise exception using errcode = '55000', message = 'scheduler request identity changed before submission';
  end if;
  execute $query$
    select net.http_post(
      url := $1,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || $2),
      body := $3,
      timeout_milliseconds := $4
    )
  $query$ into transport_id using configured_url, shared_secret, jsonb_build_object(
    'schema_version', 2,
    'mode', 'auth_noop',
    'campaign_id', campaign.id,
    'correlation_id', request_row.correlation_id,
    'request_id', request_row.request_id,
    'nonce', request_row.nonce,
    'expected_deployment_id', campaign.production_deployment_id,
    'expected_commit_sha', campaign.prepared_commit_sha
  ), campaign.max_request_seconds * 1000;
  update private.activation_auth_noop_requests
  set pg_net_request_id = transport_id, status = 'submitted',
      submitted_at = statement_timestamp()
  where request_id = request_row.request_id;
  return transport_id;
end;
$$;

create function private.activation_safe_uuid(p_value text)
returns uuid
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end;
$$;

create function private.activation_safe_nonnegative_integer(p_value text)
returns integer
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  parsed integer;
begin
  if p_value !~ '^(0|[1-9][0-9]{0,9})$' then
    return null;
  end if;
  parsed := p_value::integer;
  return parsed;
exception when others then
  return null;
end;
$$;

create function private.activation_zero_counters_valid(p_counters jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_typeof(p_counters) = 'object'
    and (select array_agg(key order by key) from jsonb_object_keys(p_counters) as key)
      = array[
        'agent_decisions', 'agent_proposals', 'agent_runs', 'broker_requests',
        'budget_reservations', 'canary_runs', 'fills', 'ledger_entries',
        'market_data_requests', 'model_calls', 'news_requests', 'orders',
        'position_mutations', 'provider_requests', 'sol_executions',
        'web_search_requests'
      ]::text[]
    and not exists (
      select 1 from jsonb_each(p_counters) as counter where counter.value <> '0'::jsonb
    );
$$;

create function private.capture_activation_http_responses()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending record;
  transport record;
  body jsonb;
  valid boolean;
  stored_count integer := 0;
  parsed_campaign_id uuid;
  parsed_event_id uuid;
  parsed_request_id uuid;
  parsed_cycle_id uuid;
  parsed_correlation_id uuid;
  parsed_nonce uuid;
  parsed_slot integer;
begin
  if to_regclass('net._http_response') is null then
    return 0;
  end if;
  perform set_config('capital_lab.internal_event_write', 'on', true);
  for pending in
    select request.request_id, request.campaign_id, request.owner_id,
      null::uuid as event_id, 'auth_noop'::text as mode,
      request.pg_net_request_id, request.correlation_id, request.nonce,
      null::uuid as cycle_id, null::text as job, null::integer as slot_number,
      campaign.production_deployment_id, campaign.prepared_commit_sha
    from private.activation_auth_noop_requests as request
    join private.no_ai_shadow_dry_runs as campaign on campaign.id = request.campaign_id
    left join private.activation_http_responses as stored on stored.request_id = request.request_id
    where request.pg_net_request_id is not null and stored.request_id is null
    union all
    select event.request_id, event.dry_run_id, event.owner_id,
      event.id, 'dry_run', event.pg_net_request_id, event.correlation_id,
      null::uuid, event.cycle_id, event.event_type, event.slot_number,
      campaign.production_deployment_id, campaign.prepared_commit_sha
    from private.no_ai_shadow_dry_run_events as event
    join private.no_ai_shadow_dry_runs as campaign on campaign.id = event.dry_run_id
    left join private.activation_http_responses as stored on stored.request_id = event.request_id
    where event.pg_net_request_id is not null and stored.request_id is null
  loop
    execute $query$
      select true as present, status_code, timed_out, error_msg, content
      from net._http_response where id = $1
    $query$ into transport using pending.pg_net_request_id;
    if transport.present is distinct from true then
      continue;
    end if;
    body := null;
    begin
      body := transport.content::jsonb;
    exception when others then
      body := null;
    end;
    parsed_campaign_id := private.activation_safe_uuid(body ->> 'campaign_id');
    parsed_event_id := private.activation_safe_uuid(body ->> 'event_id');
    parsed_request_id := private.activation_safe_uuid(body ->> 'request_id');
    parsed_cycle_id := private.activation_safe_uuid(body ->> 'cycle_id');
    parsed_correlation_id := private.activation_safe_uuid(body ->> 'correlation_id');
    parsed_nonce := private.activation_safe_uuid(body ->> 'nonce');
    parsed_slot := private.activation_safe_nonnegative_integer(body ->> 'slot_number');
    valid := coalesce(transport.status_code = 200, false)
      and not coalesce(transport.timed_out, true)
      and transport.error_msg is null
      and jsonb_typeof(body) = 'object'
      and body -> 'schema_version' = '2'::jsonb
      and body ->> 'mode' = pending.mode
      and parsed_campaign_id = pending.campaign_id
      and parsed_request_id = pending.request_id
      and parsed_correlation_id = pending.correlation_id
      and body ->> 'environment' = 'production'
      and body ->> 'deployment_id' = pending.production_deployment_id
      and body ->> 'commit_sha' = pending.prepared_commit_sha
      and body -> 'agent_disabled' = 'true'::jsonb
      and private.activation_zero_counters_valid(body -> 'counters');
    if pending.mode = 'auth_noop' then
      valid := valid
        and (select array_agg(key order by key) from jsonb_object_keys(body) as key) = array[
          'agent_disabled', 'campaign_id', 'commit_sha', 'correlation_id',
          'counters', 'deployment_id', 'environment', 'mode', 'nonce',
          'request_id', 'scheduler_disabled', 'schema_version', 'status',
          'terminal_reason'
        ]::text[]
        and parsed_nonce = pending.nonce
        and body ->> 'status' = 'authenticated_noop'
        and body ->> 'terminal_reason' = 'auth_noop_verified'
        and body -> 'scheduler_disabled' = 'true'::jsonb;
    else
      valid := valid
        and (select array_agg(key order by key) from jsonb_object_keys(body) as key) = array[
          'agent_disabled', 'campaign_id', 'commit_sha', 'correlation_id',
          'counters', 'cycle_id', 'cycles_claimed', 'cycles_reconciled',
          'deployment_id', 'environment', 'event_id', 'job', 'mode',
          'request_id', 'scheduler_disabled', 'schema_version', 'slot_number',
          'status', 'terminal_reason'
        ]::text[]
        and parsed_event_id = pending.event_id
        and parsed_cycle_id = pending.cycle_id
        and body ->> 'job' = pending.job
        and parsed_slot = pending.slot_number
        and body -> 'scheduler_disabled' = 'false'::jsonb
        and body ->> 'status' = 'completed'
        and body ->> 'terminal_reason' = case when pending.job = 'market_dispatcher'
          then 'no_ai_shadow_cycle_recorded' else 'dry_run_evidence_reconciled' end
        and private.activation_safe_nonnegative_integer(body ->> 'cycles_claimed')
          = case when pending.job = 'market_dispatcher' then 1 else 0 end
        and private.activation_safe_nonnegative_integer(body ->> 'cycles_reconciled') is not null;
    end if;

    insert into private.activation_http_responses (
      request_id, campaign_id, owner_id, event_id, mode, pg_net_request_id,
      http_status, timed_out, error_class, schema_valid, correlation_id,
      nonce, response_campaign_id, response_event_id, response_request_id,
      response_cycle_id, response_environment, response_deployment_id,
      response_commit_sha, response_status, response_terminal_reason,
      response_job, response_slot_number, scheduler_disabled, agent_disabled,
      cycles_claimed, cycles_reconciled, counters
    ) values (
      pending.request_id, pending.campaign_id, pending.owner_id, pending.event_id,
      pending.mode, pending.pg_net_request_id, transport.status_code,
      coalesce(transport.timed_out, true),
      case when transport.error_msg is null then null else 'transport_error' end,
      valid, parsed_correlation_id, parsed_nonce, parsed_campaign_id,
      parsed_event_id, parsed_request_id, parsed_cycle_id,
      body ->> 'environment', body ->> 'deployment_id', body ->> 'commit_sha',
      body ->> 'status', body ->> 'terminal_reason', body ->> 'job', parsed_slot,
      case when jsonb_typeof(body -> 'scheduler_disabled') = 'boolean'
        then (body ->> 'scheduler_disabled')::boolean else null end,
      case when jsonb_typeof(body -> 'agent_disabled') = 'boolean'
        then (body ->> 'agent_disabled')::boolean else null end,
      private.activation_safe_nonnegative_integer(body ->> 'cycles_claimed'),
      private.activation_safe_nonnegative_integer(body ->> 'cycles_reconciled'),
      case when jsonb_typeof(body -> 'counters') = 'object'
        then body -> 'counters' else null end
    );
    if pending.mode = 'auth_noop' then
      update private.activation_auth_noop_requests
      set status = case when valid then 'transport_terminal' else 'invalid' end,
          terminal_at = statement_timestamp()
      where request_id = pending.request_id;
    else
      update private.no_ai_shadow_dry_run_events
      set http_status = transport.status_code,
          timed_out = coalesce(transport.timed_out, true),
          response_error_class = case when transport.error_msg is null then null else 'transport_error' end,
          response_persisted_at = statement_timestamp(),
          response_status = body ->> 'status',
          response_terminal_reason = body ->> 'terminal_reason',
          model_call_count = coalesce(private.activation_safe_nonnegative_integer(body #>> '{counters,model_calls}'), 0),
          budget_reservation_count = coalesce(private.activation_safe_nonnegative_integer(body #>> '{counters,budget_reservations}'), 0),
          order_count = coalesce(private.activation_safe_nonnegative_integer(body #>> '{counters,orders}'), 0),
          fill_count = coalesce(private.activation_safe_nonnegative_integer(body #>> '{counters,fills}'), 0),
          ledger_entry_count = coalesce(private.activation_safe_nonnegative_integer(body #>> '{counters,ledger_entries}'), 0),
          completed_at = statement_timestamp()
      where id = pending.event_id;
    end if;
    stored_count := stored_count + 1;
  end loop;
  perform set_config('capital_lab.internal_event_write', 'off', true);
  return stored_count;
end;
$$;

create function private.verify_activation_auth_noop(
  p_campaign_id uuid,
  p_commit_sha text,
  p_config_version text,
  p_manifest_sha256 text,
  p_phase_contract_sha256 text,
  p_database_fingerprint text,
  p_correlation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  request_row private.activation_auth_noop_requests%rowtype;
begin
  campaign := private.assert_activation_context(
    p_campaign_id, p_commit_sha, p_config_version, p_manifest_sha256,
    p_phase_contract_sha256, p_database_fingerprint
  );
  perform private.capture_activation_http_responses();
  select * into strict request_row from private.activation_auth_noop_requests
  where campaign_id = campaign.id for update;
  if request_row.status <> 'transport_terminal'
    or not exists (
      select 1 from private.activation_http_responses
      where request_id = request_row.request_id and mode = 'auth_noop'
        and schema_valid and http_status = 200 and not timed_out
        and error_class is null
    )
  then
    raise exception using errcode = '55000', message = 'authorized auth no-op evidence is absent or invalid';
  end if;
  perform private.capture_activation_relation_snapshot(campaign.id, 'post_auth_noop', 0);
  if not private.activation_snapshots_match(campaign.id, 'pre_auth_noop', 0, 'post_auth_noop', 0) then
    raise exception using errcode = '55000', message = 'auth no-op caused a forbidden side effect';
  end if;
  perform private.assert_activation_controls(campaign.id, false);
  perform private.assert_activation_job_specs(campaign.id, false);
  update private.activation_auth_noop_requests set status = 'verified'
  where request_id = request_row.request_id;
  perform private.transition_no_ai_shadow_dry_run(
    campaign.id, 'auth_noop_claimed', 'auth_noop_verified', 'system',
    campaign.prepared_commit_sha, campaign.config_version, p_correlation_id,
    jsonb_build_object('request_id', request_row.request_id, 'exact_schema', true,
      'forbidden_effect_count', 0)
  );
end;
$$;

create function private.freeze_activation_baseline(
  p_campaign_id uuid,
  p_commit_sha text,
  p_config_version text,
  p_manifest_sha256 text,
  p_phase_contract_sha256 text,
  p_database_fingerprint text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  first_session public.market_sessions%rowtype;
  second_session public.market_sessions%rowtype;
  server_now timestamptz := statement_timestamp();
  event_count integer;
  slot_count integer;
  coverage_missing integer;
  final_expected_at timestamptz;
begin
  campaign := private.assert_activation_context(
    p_campaign_id, p_commit_sha, p_config_version, p_manifest_sha256,
    p_phase_contract_sha256, p_database_fingerprint
  );
  if campaign.state not in ('auth_noop_verified', 'baseline_frozen') then
    raise exception using errcode = '55000', message = 'baseline freeze is unavailable from the persisted state';
  end if;
  perform private.assert_activation_controls(campaign.id, false);
  perform private.assert_activation_job_specs(campaign.id, false);
  if exists (
    select 1 from public.experiments
    where owner_id = campaign.owner_id and lifecycle_status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'an active experiment blocks the no-AI dry run';
  end if;
  if campaign.state = 'auth_noop_verified' then
    select session.* into strict first_session
    from public.market_sessions as session
    join public.exchanges as exchange on exchange.id = session.exchange_id
    where exchange.mic = 'XNAS' and session.session_type = 'regular'
      and session.available_at <= server_now
      and session.opens_at >= server_now + interval '900 seconds'
      and session.closes_at - session.opens_at = interval '6 hours 30 minutes'
    order by session.opens_at limit 1;
    select session.* into strict second_session
    from public.market_sessions as session
    where session.exchange_id = first_session.exchange_id
      and session.calendar_manifest_id = first_session.calendar_manifest_id
      and session.session_type = 'regular'
      and session.available_at <= server_now
      and session.opens_at > first_session.closes_at
      and session.closes_at - session.opens_at = interval '6 hours 30 minutes'
    order by session.opens_at limit 1;
    select count(*) into coverage_missing
    from generate_series(
      (server_now at time zone 'America/New_York')::date,
      second_session.session_date, interval '1 day'
    ) as expected(day)
    where extract(isodow from expected.day) between 1 and 5
      and not exists (
        select 1 from public.market_sessions as session
        where session.exchange_id = first_session.exchange_id
          and session.calendar_manifest_id = first_session.calendar_manifest_id
          and session.session_date = expected.day::date
          and session.available_at <= server_now
      );
    if coverage_missing <> 0 then
      raise exception using errcode = '55000', message = 'official market-calendar coverage is incomplete';
    end if;
    insert into private.no_ai_shadow_dry_run_events (
      id, dry_run_id, owner_id, exchange_session_id, session_date,
      slot_number, event_type, expected_at, request_id, cycle_id,
      correlation_id
    )
    select
      private.activation_deterministic_uuid(campaign.id,
        selected.session_date::text || ':' || generated.slot_number::text || ':' || event_kind.event_type),
      campaign.id, campaign.owner_id, selected.session_id,
      selected.session_date, generated.slot_number, event_kind.event_type,
      generated.slot_at + case when event_kind.event_type = 'reconciler'
        then interval '5 minutes' else interval '0' end,
      private.activation_deterministic_uuid(campaign.id,
        'request:' || selected.session_date::text || ':' || generated.slot_number::text || ':' || event_kind.event_type),
      private.activation_deterministic_uuid(campaign.id,
        'cycle:' || selected.session_date::text || ':' || generated.slot_number::text || ':' || event_kind.event_type),
      private.activation_deterministic_uuid(campaign.id,
        'correlation:' || selected.session_date::text || ':' || generated.slot_number::text || ':' || event_kind.event_type)
    from (
      values
        (first_session.id, first_session.session_date, first_session.opens_at),
        (second_session.id, second_session.session_date, second_session.opens_at)
    ) as selected(session_id, session_date, opens_at)
    cross join lateral (
      select slot_number::smallint,
        selected.opens_at + slot_number * interval '15 minutes' as slot_at
      from generate_series(0, 25) as slot_number
    ) as generated
    cross join (values ('market_dispatcher'), ('reconciler')) as event_kind(event_type)
    on conflict (dry_run_id, event_type, session_date, slot_number) do nothing;
    select count(*), count(distinct (session_date, slot_number)), max(expected_at)
    into event_count, slot_count, final_expected_at
    from private.no_ai_shadow_dry_run_events where dry_run_id = campaign.id;
    if event_count <> 104 or slot_count <> 52 then
      raise exception using errcode = '55000', message = 'dry-run schedule is not exactly 52 slots and 104 events';
    end if;
    update private.no_ai_shadow_dry_runs
    set decision_at = server_now, planned_start_at = first_session.opens_at,
      first_session_date = first_session.session_date,
      second_session_date = second_session.session_date,
      planned_end_at = final_expected_at,
      expected_slot_count = 52, expected_event_count = 104,
      drain_not_before_at = final_expected_at
        + make_interval(secs => campaign.max_request_seconds + campaign.drain_safety_seconds)
    where id = campaign.id;
  end if;
  select count(*), count(distinct (session_date, slot_number)), max(expected_at)
  into event_count, slot_count, final_expected_at
  from private.no_ai_shadow_dry_run_events where dry_run_id = campaign.id;
  if event_count <> 104 or slot_count <> 52 then
    raise exception using errcode = '55000', message = 'persisted dry-run schedule drifted';
  end if;
  perform private.capture_activation_relation_snapshot(campaign.id, 'pre_dry_run', 0);
  perform private.capture_activation_control_snapshot(campaign.id, 0);
  insert into private.no_ai_shadow_dry_run_baselines (
    dry_run_id, owner_id, agent_run_count, budget_reservation_count,
    ai_usage_count, order_count, fill_count, ledger_entry_count,
    commit_sha, config_version
  ) select campaign.id, campaign.owner_id,
    (select count(*) from public.agent_runs where owner_id = campaign.owner_id),
    (select count(*) from private.ai_budget_reservations where owner_id = campaign.owner_id),
    (select count(*) from private.ai_usage_events where owner_id = campaign.owner_id),
    (select count(*) from public.orders where owner_id = campaign.owner_id),
    (select count(*) from public.fills where owner_id = campaign.owner_id),
    (select count(*) from private.cash_ledger_entries where owner_id = campaign.owner_id),
    campaign.prepared_commit_sha, campaign.config_version
  on conflict (dry_run_id) do nothing;
  if campaign.state = 'auth_noop_verified' then
    perform private.transition_no_ai_shadow_dry_run(
      campaign.id, 'auth_noop_verified', 'baseline_frozen', 'owner',
      campaign.prepared_commit_sha, campaign.config_version, p_correlation_id,
      jsonb_build_object('expected_slots', 52, 'expected_events', 104,
        'decision_time_source', 'database_server', 'forbidden_relation_count',
        (select count(*) from private.activation_forbidden_relation_specs))
    );
  end if;
  return jsonb_build_object('state', 'baseline_frozen', 'expected_slots', 52,
    'expected_events', 104, 'planned_end_at', final_expected_at);
end;
$$;

create function private.arm_activation_campaign(
  p_campaign_id uuid,
  p_commit_sha text,
  p_config_version text,
  p_manifest_sha256 text,
  p_phase_contract_sha256 text,
  p_database_fingerprint text,
  p_operation_id uuid,
  p_correlation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
begin
  campaign := private.assert_activation_context(
    p_campaign_id, p_commit_sha, p_config_version, p_manifest_sha256,
    p_phase_contract_sha256, p_database_fingerprint
  );
  if campaign.state <> 'baseline_frozen'
    or campaign.planned_start_at < statement_timestamp() + interval '900 seconds'
    or campaign.expected_slot_count <> 52 or campaign.expected_event_count <> 104
  then
    raise exception using errcode = '55000', message = 'activation lead time, state, or frozen counts are invalid';
  end if;
  perform private.assert_activation_controls(campaign.id, false);
  perform private.assert_activation_job_specs(campaign.id, false);
  perform private.verify_activation_vault_scope(campaign.id);
  if campaign.manifest #>> '{providers,market_data}' <> 'mock'
    or campaign.manifest #>> '{providers,news}' <> 'mock'
    or campaign.manifest #>> '{providers,execution}' <> 'paper'
    or not private.activation_snapshots_match(
      campaign.id, 'pre_dry_run', 0, 'pre_dry_run', 0
    )
    or exists (
      select 1 from public.experiments
      where owner_id = campaign.owner_id and lifecycle_status = 'active'
    )
  then
    raise exception using errcode = '55000', message = 'activation data-mode or baseline invariant failed';
  end if;
  update private.application_settings
  set value = 'true'::jsonb, version = version + 1
  where owner_id = campaign.owner_id and setting_key = 'scheduler_enabled';
  if not found then
    raise exception using errcode = '55000', message = 'scheduler control row is missing';
  end if;
  update private.no_ai_shadow_dry_runs set scheduler_control_enabled = true
  where id = campaign.id;
  perform private.set_activation_jobs_active(
    campaign.id, true, p_operation_id, p_correlation_id
  );
  perform private.transition_no_ai_shadow_dry_run(
    campaign.id, 'baseline_frozen', 'armed', 'owner',
    campaign.prepared_commit_sha, campaign.config_version, p_correlation_id,
    jsonb_build_object('operation_id', p_operation_id, 'jobs_exactly_verified', true,
      'dangerous_settings_false_before_arm', 9, 'lead_seconds_minimum', 900)
  );
end;
$$;

create or replace function private.run_hosted_scheduler_request_v2(
  p_campaign_id uuid,
  p_event_id uuid,
  p_request_id uuid,
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
  campaign private.no_ai_shadow_dry_runs%rowtype;
  event_row private.no_ai_shadow_dry_run_events%rowtype;
  server_now timestamptz := statement_timestamp();
  slot_identifier text;
  inserted_count integer := 0;
  reconciled_count integer := 0;
begin
  if p_job not in ('market_dispatcher', 'reconciler')
    or p_requested_at is null
    or p_requested_at not between server_now - interval '5 minutes' and server_now + interval '1 minute'
  then
    raise exception using errcode = '22023', message = 'scheduler RPC envelope is invalid';
  end if;
  select * into campaign from private.no_ai_shadow_dry_runs
  where id = p_campaign_id and state in ('armed', 'running')
    and scheduler_control_enabled for update;
  if campaign.id is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'activation_gate_disabled',
      'cycles_claimed', 0, 'cycles_reconciled', 0, 'model_calls', 0,
      'budget_reservations', 0, 'paper_orders_created', 0,
      'paper_fills_created', 0, 'ledger_entries_created', 0);
  end if;
  begin
    perform private.assert_activation_controls(campaign.id, true);
    perform private.assert_activation_job_specs(campaign.id, true);
  exception when others then
    perform private.emergency_kill_activation_controls(campaign.id);
    return jsonb_build_object('status', 'skipped', 'reason', 'activation_invariant_failed',
      'cycles_claimed', 0, 'cycles_reconciled', 0, 'model_calls', 0,
      'budget_reservations', 0, 'paper_orders_created', 0,
      'paper_fills_created', 0, 'ledger_entries_created', 0);
  end;
  select * into event_row from private.no_ai_shadow_dry_run_events
  where id = p_event_id and dry_run_id = campaign.id
    and request_id = p_request_id and correlation_id = p_correlation_id
    and cycle_id = p_cycle_id and event_type = p_job
    and pg_net_request_id is not null
  for update;
  if event_row.id is null then
    perform private.emergency_kill_activation_controls(campaign.id);
    return jsonb_build_object('status', 'skipped', 'reason', 'unregistered_request_identity',
      'cycles_claimed', 0, 'cycles_reconciled', 0, 'model_calls', 0,
      'budget_reservations', 0, 'paper_orders_created', 0,
      'paper_fills_created', 0, 'ledger_entries_created', 0);
  end if;
  if event_row.authenticated_count = 1 and event_row.terminal_reason is not null then
    return jsonb_build_object('status', 'completed',
      'reason', event_row.terminal_reason,
      'cycles_claimed', case when p_job = 'market_dispatcher' then 1 else 0 end,
      'cycles_reconciled', case when p_job = 'reconciler' then event_row.claimed_cycle_count else 0 end,
      'model_calls', 0, 'budget_reservations', 0,
      'paper_orders_created', 0, 'paper_fills_created', 0,
      'ledger_entries_created', 0);
  end if;
  if event_row.authenticated_count <> 0 then
    perform private.emergency_kill_activation_controls(campaign.id);
    return jsonb_build_object('status', 'duplicate', 'reason', 'request_identity_collision',
      'cycles_claimed', 0, 'cycles_reconciled', 0, 'model_calls', 0,
      'budget_reservations', 0, 'paper_orders_created', 0,
      'paper_fills_created', 0, 'ledger_entries_created', 0);
  end if;
  perform set_config('capital_lab.internal_event_write', 'on', true);
  update private.no_ai_shadow_dry_run_events
  set authenticated_count = 1 where id = event_row.id;
  perform set_config('capital_lab.internal_event_write', 'off', true);
  if campaign.state = 'armed' then
    perform private.transition_no_ai_shadow_dry_run(
      campaign.id, 'armed', 'running', 'scheduler', campaign.prepared_commit_sha,
      campaign.config_version, p_correlation_id,
      jsonb_build_object('first_event_id', event_row.id)
    );
  end if;
  if p_job = 'market_dispatcher' then
    slot_identifier := 'no-ai-infrastructure:' || campaign.id::text || ':'
      || event_row.session_date::text || ':' || event_row.slot_number::text;
    perform pg_advisory_xact_lock(hashtextextended(slot_identifier, 0));
    insert into private.scheduler_slots (
      slot_key, owner_id, experiment_id, job_type, scheduler_provider,
      exchange_session_id, slot_at, lease_until, attempt_count, status,
      result, session_date, slot_number, lease_owner, heartbeat_at, max_attempts
    ) values (
      slot_identifier, campaign.owner_id, null,
      'no_ai_shadow_infrastructure_dry_run', 'supabase', event_row.exchange_session_id,
      event_row.expected_at,
      greatest(server_now, event_row.expected_at) + interval '120 seconds',
      1, 'running', null,
      event_row.session_date, event_row.slot_number, p_cycle_id, server_now, 1
    ) on conflict (slot_key) do nothing;
    get diagnostics inserted_count = row_count;
    if inserted_count = 1 then
      insert into private.scheduler_runs (
        slot_key, owner_id, experiment_id, correlation_id, status,
        started_at, finished_at, skipped_reason, retry_eligible, metadata,
        heartbeat_at, deadline_at, attempt_number
      ) values (
        slot_identifier, campaign.owner_id, null, p_correlation_id, 'skipped',
        server_now, server_now, 'no_ai_shadow_dry_run', false,
        jsonb_build_object('campaign_id', campaign.id, 'paper_only', true,
          'provider_requests', 0, 'model_calls', 0, 'budget_reservations', 0,
          'orders', 0, 'fills', 0, 'ledger_entries', 0),
        server_now, server_now + interval '110 seconds', 1
      );
      update private.scheduler_slots set status = 'skipped', heartbeat_at = server_now,
        result = jsonb_build_object('reason', 'no_ai_shadow_dry_run',
          'provider_requests', 0, 'model_calls', 0, 'budget_reservations', 0,
          'orders', 0, 'fills', 0, 'ledger_entries', 0)
      where slot_key = slot_identifier;
    elsif not exists (
      select 1 from private.scheduler_slots where slot_key = slot_identifier
        and owner_id = campaign.owner_id and lease_owner = p_cycle_id
    ) then
      perform private.emergency_kill_activation_controls(campaign.id);
      return jsonb_build_object('status', 'duplicate', 'reason', 'slot_identity_collision',
        'cycles_claimed', 0, 'cycles_reconciled', 0, 'model_calls', 0,
        'budget_reservations', 0, 'paper_orders_created', 0,
        'paper_fills_created', 0, 'ledger_entries_created', 0);
    end if;
    perform set_config('capital_lab.internal_event_write', 'on', true);
    update private.no_ai_shadow_dry_run_events
    set claimed_cycle_count = 1, terminal_reason = 'no_ai_shadow_cycle_recorded'
    where id = event_row.id;
    perform set_config('capital_lab.internal_event_write', 'off', true);
  else
    reconciled_count := private.capture_activation_http_responses();
    perform set_config('capital_lab.internal_event_write', 'on', true);
    update private.no_ai_shadow_dry_run_events
    set claimed_cycle_count = reconciled_count,
      terminal_reason = 'dry_run_evidence_reconciled'
    where id = event_row.id;
    perform set_config('capital_lab.internal_event_write', 'off', true);
  end if;
  return jsonb_build_object('status', 'completed',
    'reason', case when p_job = 'market_dispatcher' then 'no_ai_shadow_cycle_recorded'
      else 'dry_run_evidence_reconciled' end,
    'cycles_claimed', case when p_job = 'market_dispatcher' then 1 else 0 end,
    'cycles_reconciled', reconciled_count, 'model_calls', 0,
    'budget_reservations', 0, 'paper_orders_created', 0,
    'paper_fills_created', 0, 'ledger_entries_created', 0);
end;
$$;

create or replace function public.run_hosted_scheduler_request(
  p_campaign_id uuid,
  p_event_id uuid,
  p_request_id uuid,
  p_job text,
  p_correlation_id uuid,
  p_cycle_id uuid,
  p_requested_at timestamptz
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.run_hosted_scheduler_request_v2(
    p_campaign_id, p_event_id, p_request_id, p_job,
    p_correlation_id, p_cycle_id, p_requested_at
  );
$$;

create function private.finalize_activation_campaign(
  p_campaign_id uuid,
  p_commit_sha text,
  p_config_version text,
  p_manifest_sha256 text,
  p_phase_contract_sha256 text,
  p_database_fingerprint text,
  p_operation_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  actual_slots integer;
  actual_events integer;
  complete_responses integer;
  missing_responses integer;
  invalid_responses integer;
  forbidden_effects integer;
  terminal_status text;
  controls_disabled boolean;
begin
  campaign := private.assert_activation_context(
    p_campaign_id, p_commit_sha, p_config_version, p_manifest_sha256,
    p_phase_contract_sha256, p_database_fingerprint
  );
  if campaign.state <> 'auto_stopped' or campaign.stopped_at is null
    or statement_timestamp() < campaign.stopped_at + interval '300 seconds'
    or statement_timestamp() < campaign.finalize_not_before_at
  then
    raise exception using errcode = '55000', message = 'campaign finalization is too early or in the wrong state';
  end if;
  perform private.capture_activation_http_responses();
  perform private.assert_activation_controls(campaign.id, false);
  perform private.set_activation_jobs_active(
    campaign.id, false, p_operation_id, p_correlation_id
  );
  perform private.assert_activation_job_specs(campaign.id, false);
  perform private.capture_activation_relation_snapshot(campaign.id, 'terminal', 0);
  perform private.capture_activation_control_snapshot(
    campaign.id,
    (select coalesce(max(snapshot_sequence), 0) + 1
      from private.activation_control_snapshots where campaign_id = campaign.id)
  );
  select count(distinct (session_date, slot_number)), count(*)
  into actual_slots, actual_events
  from private.no_ai_shadow_dry_run_events where dry_run_id = campaign.id;
  select count(*) filter (where response.schema_valid),
    count(*) filter (where response.request_id is null),
    count(*) filter (where response.request_id is not null and not response.schema_valid)
  into complete_responses, missing_responses, invalid_responses
  from private.no_ai_shadow_dry_run_events as event
  left join private.activation_http_responses as response
    on response.request_id = event.request_id
  where event.dry_run_id = campaign.id;
  select count(*) into forbidden_effects
  from private.activation_mutation_evidence where campaign_id = campaign.id;
  if not private.activation_snapshots_match(
    campaign.id, 'pre_dry_run', 0, 'terminal', 0
  ) then
    forbidden_effects := forbidden_effects + 1;
  end if;
  controls_disabled := not exists (
    select 1 from public.experiment_controls
    where owner_id = campaign.owner_id
      and (scheduler_enabled or agent_enabled or not emergency_paused)
  );
  terminal_status := case
    when missing_responses > 0 then 'inconclusive'
    when invalid_responses > 0 or forbidden_effects > 0
      or actual_slots <> 52 or actual_events <> 104
      or complete_responses <> 104 or not controls_disabled then 'failed'
    else 'passed' end;
  insert into private.activation_terminal_evidence (
    campaign_id, owner_id, terminal_status, expected_slots, actual_slots,
    expected_events, actual_events, complete_response_count,
    missing_response_count, invalid_response_count, forbidden_effect_count,
    scheduler_controls_disabled, dangerous_controls_disabled, jobs_inactive,
    evidence
  ) values (
    campaign.id, campaign.owner_id, terminal_status, 52, actual_slots,
    104, actual_events, complete_responses, missing_responses,
    invalid_responses, forbidden_effects, not campaign.scheduler_control_enabled,
    controls_disabled, true,
    jsonb_build_object('operation_id', p_operation_id,
      'response_source', 'persisted_activation_http_responses',
      'server_time_enforced', true, 'minimum_stopped_seconds', 300,
      'relation_state_equal', forbidden_effects = 0)
  );
  perform private.transition_no_ai_shadow_dry_run(
    campaign.id, 'auto_stopped', 'reconciled', 'system',
    campaign.prepared_commit_sha, campaign.config_version,
    private.activation_deterministic_uuid(campaign.id, 'transition:reconciled'),
    jsonb_build_object('complete_responses', complete_responses,
      'missing_responses', missing_responses, 'invalid_responses', invalid_responses)
  );
  perform private.transition_no_ai_shadow_dry_run(
    campaign.id, 'reconciled', terminal_status, 'system',
    campaign.prepared_commit_sha, campaign.config_version,
    private.activation_deterministic_uuid(campaign.id, 'transition:' || terminal_status),
    jsonb_build_object('reason_code', case terminal_status
      when 'passed' then null when 'failed' then 'terminal_invariant_failed'
      else 'transport_evidence_missing' end,
      'terminal_evidence_persisted', true)
  );
  return jsonb_build_object('status', terminal_status, 'expected_slots', 52,
    'actual_slots', actual_slots, 'expected_events', 104,
    'actual_events', actual_events, 'complete_responses', complete_responses,
    'missing_responses', missing_responses, 'invalid_responses', invalid_responses,
    'forbidden_effects', forbidden_effects, 'jobs_inactive', true);
end;
$$;

create or replace function private.dispatch_no_ai_shadow_dry_run_event(
  p_job text,
  p_requested_at timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  event_row private.no_ai_shadow_dry_run_events%rowtype;
  sequence_number bigint;
  configured_url text;
  shared_secret text;
  transport_id bigint;
  valid_responses integer;
  invalid_responses integer;
  missing_responses integer;
  submitted_count integer;
  required_drain_at timestamptz;
begin
  if p_job not in ('market_dispatcher', 'reconciler') then
    raise exception using errcode = '22023', message = 'scheduler event type is invalid';
  end if;
  select * into campaign from private.no_ai_shadow_dry_runs
  where state in ('armed', 'running', 'auto_stopped')
  order by prepared_at desc limit 1 for update;
  if campaign.id is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('activation:' || campaign.id::text, 0));
  perform private.capture_activation_http_responses();
  select coalesce(max(snapshot_sequence), 0) + 1 into sequence_number
  from private.activation_control_snapshots where campaign_id = campaign.id;
  perform private.capture_activation_control_snapshot(campaign.id, sequence_number);
  perform private.capture_activation_relation_snapshot(campaign.id, 'tick', sequence_number);
  if campaign.state = 'auto_stopped' then
    if statement_timestamp() >= campaign.finalize_not_before_at then
      perform private.finalize_activation_campaign(
        campaign.id, campaign.prepared_commit_sha, campaign.config_version,
        campaign.manifest_sha256, campaign.phase_contract_sha256,
        campaign.database_fingerprint,
        private.activation_deterministic_uuid(campaign.id, 'automatic-finalize-operation'),
        private.activation_deterministic_uuid(campaign.id, 'automatic-finalize-correlation')
      );
    end if;
    return null;
  end if;
  begin
    perform private.assert_activation_controls(campaign.id, true);
    perform private.assert_activation_job_specs(campaign.id, true);
  exception when others then
    perform private.emergency_kill_activation_controls(campaign.id);
    return null;
  end;
  select count(*) filter (where response.schema_valid),
    count(*) filter (where response.request_id is not null and not response.schema_valid),
    count(*) filter (where event.pg_net_request_id is not null and response.request_id is null)
  into valid_responses, invalid_responses, missing_responses
  from private.no_ai_shadow_dry_run_events as event
  left join private.activation_http_responses as response on response.request_id = event.request_id
  where event.dry_run_id = campaign.id;
  if invalid_responses > 0 or exists (
    select 1 from private.activation_mutation_evidence where campaign_id = campaign.id
  ) then
    perform private.emergency_kill_activation_controls(campaign.id);
    return null;
  end if;
  select greatest(
    campaign.drain_not_before_at,
    coalesce(max(request_submitted_at), campaign.planned_end_at)
      + make_interval(secs => campaign.max_request_seconds + campaign.drain_safety_seconds)
  ) into required_drain_at
  from private.no_ai_shadow_dry_run_events where dry_run_id = campaign.id;
  if statement_timestamp() >= required_drain_at then
    perform private.emergency_kill_activation_controls(campaign.id);
    return null;
  end if;
  if exists (
    select 1 from private.no_ai_shadow_dry_run_events
    where dry_run_id = campaign.id and pg_net_request_id is null
      and expected_at < statement_timestamp() - interval '6 minutes'
  ) then
    perform private.emergency_kill_activation_controls(campaign.id);
    return null;
  end if;
  select * into event_row from private.no_ai_shadow_dry_run_events
  where dry_run_id = campaign.id and event_type = p_job
    and pg_net_request_id is null
    and expected_at between statement_timestamp() - interval '6 minutes'
      and statement_timestamp() + interval '90 seconds'
  order by expected_at limit 1 for update skip locked;
  if event_row.id is null then
    return null;
  end if;
  perform private.verify_activation_vault_scope(campaign.id);
  execute $query$
    select max(case when name = 'capital_lab_scheduler_url' then decrypted_secret end),
      max(case when name = 'capital_lab_scheduler_shared_secret' then decrypted_secret end)
    from vault.decrypted_secrets
    where name in ('capital_lab_scheduler_url', 'capital_lab_scheduler_shared_secret')
  $query$ into configured_url, shared_secret;
  if configured_url <> campaign.scheduler_url or length(shared_secret) < 32 then
    perform private.emergency_kill_activation_controls(campaign.id);
    return null;
  end if;
  execute $query$
    select net.http_post(
      url := $1,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || $2),
      body := $3,
      timeout_milliseconds := $4
    )
  $query$ into transport_id using configured_url, shared_secret, jsonb_build_object(
    'schema_version', 2, 'mode', 'dry_run',
    'campaign_id', campaign.id, 'event_id', event_row.id,
    'correlation_id', event_row.correlation_id,
    'request_id', event_row.request_id, 'cycle_id', event_row.cycle_id,
    'job', event_row.event_type, 'slot_number', event_row.slot_number,
    'expected_deployment_id', campaign.production_deployment_id,
    'expected_commit_sha', campaign.prepared_commit_sha
  ), campaign.max_request_seconds * 1000;
  perform set_config('capital_lab.internal_event_write', 'on', true);
  update private.no_ai_shadow_dry_run_events
  set pg_net_request_id = transport_id, cron_trigger_count = 1,
      request_submitted_at = statement_timestamp()
  where id = event_row.id and pg_net_request_id is null;
  get diagnostics submitted_count = row_count;
  perform set_config('capital_lab.internal_event_write', 'off', true);
  if submitted_count <> 1 then
    raise exception using errcode = '55000', message = 'scheduler request identity was concurrently claimed';
  end if;
  return transport_id;
end;
$$;

create function private.disable_activation_jobs_after_emergency(
  p_campaign_id uuid,
  p_operation_id uuid,
  p_correlation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_activation_controls(p_campaign_id, false);
  insert into private.no_ai_shadow_dry_run_transitions (
    dry_run_id, owner_id, from_state, to_state, actor, commit_sha,
    config_version, correlation_id, evidence
  )
  select campaign.id, campaign.owner_id, campaign.emergency_killed_from_state,
    'auto_stopped', 'system', campaign.prepared_commit_sha,
    campaign.config_version, p_correlation_id,
    jsonb_build_object(
      'operation_id', p_operation_id,
      'phase_one_controls_committed', true,
      'phase_two_job_disable_attempted', true
    )
  from private.no_ai_shadow_dry_runs as campaign
  where campaign.id = p_campaign_id
    and campaign.state = 'auto_stopped'
  on conflict (dry_run_id, to_state) do nothing;
  perform private.set_activation_jobs_active(
    p_campaign_id, false, p_operation_id, p_correlation_id
  );
end;
$$;

create function private.unschedule_terminal_activation_jobs(
  p_campaign_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from private.activation_terminal_evidence
    where campaign_id = p_campaign_id
  ) then
    raise exception using errcode = '55000', message = 'terminal evidence must exist before unschedule';
  end if;
  perform private.unschedule_activation_jobs(p_campaign_id);
end;
$$;

create or replace function private.capture_activation_control_snapshot(
  p_campaign_id uuid,
  p_snapshot_sequence bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  persisted private.activation_control_snapshots%rowtype;
  storage_result jsonb;
  dangerous_count integer;
  dangerous_wrong integer;
  control_count integer;
  scheduler_count integer;
  agent_count integer;
  non_paused_count integer;
begin
  if p_snapshot_sequence < 0 then
    raise exception using errcode = '22023', message = 'control snapshot sequence is invalid';
  end if;
  select * into strict campaign from private.no_ai_shadow_dry_runs
  where id = p_campaign_id;
  select count(*), count(*) filter (where value <> 'false'::jsonb)
  into dangerous_count, dangerous_wrong
  from private.application_settings
  where owner_id = campaign.owner_id and setting_key in (
    'scheduler_enabled', 'agent_enabled',
    'autonomous_paper_execution_enabled', 'paid_model_calls_enabled',
    'openai_canary_enabled', 'openai_web_search_enabled',
    'sol_challenger_enabled', 'sol_live_execution_enabled', 'real_broker_enabled'
  );
  select count(*), count(*) filter (where scheduler_enabled),
    count(*) filter (where agent_enabled), count(*) filter (where not emergency_paused)
  into control_count, scheduler_count, agent_count, non_paused_count
  from public.experiment_controls where owner_id = campaign.owner_id;
  select * into persisted from private.activation_control_snapshots
  where campaign_id = campaign.id and snapshot_sequence = p_snapshot_sequence;
  if persisted.id is not null then
    if row(persisted.dangerous_setting_count, persisted.dangerous_non_false_count,
      persisted.experiment_control_count, persisted.scheduler_enabled_count,
      persisted.agent_enabled_count, persisted.non_paused_count)
      is distinct from row(dangerous_count, dangerous_wrong, control_count,
      scheduler_count, agent_count, non_paused_count)
    then
      raise exception using errcode = '55000', message = 'persisted control baseline differs on retry';
    end if;
    return;
  end if;
  storage_result := private.capture_storage_monitor_snapshot(campaign.owner_id, 524288000);
  insert into private.activation_control_snapshots (
    campaign_id, owner_id, snapshot_sequence, dangerous_setting_count,
    dangerous_non_false_count, experiment_control_count,
    scheduler_enabled_count, agent_enabled_count, non_paused_count,
    storage_snapshot_id
  ) values (
    campaign.id, campaign.owner_id, p_snapshot_sequence, dangerous_count,
    dangerous_wrong, control_count, scheduler_count, agent_count,
    non_paused_count, (storage_result ->> 'snapshot_id')::uuid
  );
end;
$$;

create or replace function public.claim_paid_canary(
  p_owner_id uuid,
  p_operation_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select private.claim_paid_canary(p_owner_id, p_operation_id);
$$;

create trigger paid_canary_runs_reject_statement_mutation
before update or delete or truncate on private.paid_canary_runs
for each statement execute function private.reject_mutation();

revoke all on table private.paid_canary_runs from service_role;

do $$
declare
  spec private.activation_forbidden_relation_specs%rowtype;
begin
  for spec in select * from private.activation_forbidden_relation_specs
  loop
    execute format(
      'create trigger %I after insert or update or delete or truncate on %s '
        || 'for each statement execute function private.record_activation_forbidden_mutation()',
      replace(spec.relation_name, '.', '_') || '_activation_mutation_guard',
      spec.relation_name
    );
  end loop;
end;
$$;

create trigger no_ai_shadow_dry_runs_reject_truncate
before truncate on private.no_ai_shadow_dry_runs
for each statement execute function private.reject_mutation();
create trigger no_ai_shadow_dry_run_events_reject_truncate
before truncate on private.no_ai_shadow_dry_run_events
for each statement execute function private.reject_mutation();
create trigger activation_auth_noop_requests_reject_delete_truncate
before delete or truncate on private.activation_auth_noop_requests
for each statement execute function private.reject_mutation();
create trigger activation_auth_failure_requests_reject_delete_truncate
before delete or truncate on private.activation_auth_failure_requests
for each statement execute function private.reject_mutation();
create trigger no_ai_shadow_dry_run_baselines_reject_mutation
before update or delete or truncate on private.no_ai_shadow_dry_run_baselines
for each statement execute function private.reject_mutation();
create trigger audit_log_reject_statement_mutation
before update or delete or truncate on private.audit_log
for each statement execute function private.reject_mutation();

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'no_ai_shadow_dry_runs', 'no_ai_shadow_dry_run_transitions',
    'no_ai_shadow_dry_run_events', 'no_ai_shadow_dry_run_baselines',
    'no_ai_shadow_dry_run_alarms', 'activation_job_spec_versions',
    'activation_auth_noop_requests', 'activation_auth_failure_requests',
    'activation_http_responses',
    'activation_forbidden_relation_specs', 'activation_relation_snapshots',
    'activation_control_snapshots', 'activation_mutation_evidence',
    'activation_terminal_evidence', 'paid_canary_runs'
  ] loop
    execute format(
      'revoke all privileges on table private.%I from public, anon, authenticated, service_role',
      relation_name
    );
  end loop;
end;
$$;

revoke update, delete, truncate on table private.audit_log from service_role;

-- Restrict only the activation/canary surface introduced or replaced here.
-- Existing private owner-check helpers retain the explicit grants established
-- by their source migrations; a schema-wide revoke would break those narrow
-- public SECURITY DEFINER entry points.
do $$
declare
  activation_function record;
begin
  for activation_function in
    select procedure.oid::regprocedure as signature
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = any(array[
        'activation_database_fingerprint',
        'activation_deterministic_uuid',
        'activation_job_spec_hash',
        'activation_relation_contract_hash',
        'activation_safe_nonnegative_integer',
        'activation_safe_uuid',
        'activation_snapshots_match',
        'activation_zero_counters_valid',
        'arm_activation_campaign',
        'arm_no_ai_shadow_dry_run',
        'assert_activation_context',
        'assert_activation_controls',
        'assert_activation_job_specs',
        'assert_unmanaged_activation_jobs_safe',
        'capture_activation_control_snapshot',
        'capture_activation_http_responses',
        'capture_activation_relation_snapshot',
        'capture_storage_monitor_snapshot',
        'claim_activation_auth_noop',
        'claim_paid_canary',
        'disable_activation_jobs_after_emergency',
        'dispatch_no_ai_shadow_dry_run_event',
        'emergency_kill_activation_controls',
        'finalize_activation_campaign',
        'finalize_no_ai_shadow_dry_run',
        'freeze_activation_baseline',
        'freeze_no_ai_shadow_dry_run_baseline',
        'paid_canary_context',
        'plan_no_ai_shadow_dry_run',
        'prepare_no_ai_shadow_dry_run',
        'prepare_no_ai_shadow_dry_run_v2',
        'protect_activation_event_mutation',
        'protect_activation_manifest_identity',
        'reconcile_no_ai_shadow_dry_run',
        'record_activation_forbidden_mutation',
        'register_activation_job_spec',
        'run_hosted_scheduler_request',
        'run_hosted_scheduler_request_v2',
        'set_activation_jobs_active',
        'stop_no_ai_shadow_dry_run',
        'submit_activation_auth_failure_probes',
        'submit_activation_auth_noop',
        'transition_no_ai_shadow_dry_run',
        'unschedule_activation_jobs',
        'unschedule_terminal_activation_jobs',
        'verify_activation_auth_failure_probes',
        'verify_activation_auth_noop',
        'verify_activation_vault_scope',
        'verify_no_ai_shadow_auth_noop'
      ]::text[])
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      activation_function.signature
    );
  end loop;
end;
$$;
revoke all on function private.transition_no_ai_shadow_dry_run(uuid, text, text, text, text, text, uuid, jsonb) from service_role;
revoke all on function private.prepare_no_ai_shadow_dry_run(text, text, uuid) from service_role;
revoke all on function private.plan_no_ai_shadow_dry_run(uuid, timestamptz, timestamptz) from service_role;
revoke all on function private.freeze_no_ai_shadow_dry_run_baseline(uuid, text, text, uuid) from service_role;
revoke all on function private.stop_no_ai_shadow_dry_run(uuid, text, text, jsonb, boolean) from service_role;
revoke all on function private.verify_no_ai_shadow_auth_noop(uuid, bigint, integer, text, text, uuid) from service_role;
revoke all on function private.arm_no_ai_shadow_dry_run(uuid, text, text, uuid) from service_role;
revoke all on function private.dispatch_no_ai_shadow_dry_run_event(text, timestamptz) from service_role;
revoke all on function private.reconcile_no_ai_shadow_dry_run(uuid, timestamptz) from service_role;
revoke all on function private.finalize_no_ai_shadow_dry_run(uuid, text, text, uuid, timestamptz) from service_role;
revoke all on function private.run_hosted_scheduler_request(text, uuid, uuid, timestamptz) from service_role;
revoke all on function public.run_hosted_scheduler_request(text, uuid, uuid, timestamptz) from service_role;
revoke all on function private.run_hosted_scheduler_request_v2(uuid, uuid, uuid, text, uuid, uuid, timestamptz) from service_role;
revoke all on function private.claim_paid_canary(uuid, uuid) from service_role;
revoke all on function private.paid_canary_context(timestamptz) from service_role;

create or replace function public.paid_canary_context(p_requested_at timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.paid_canary_context(p_requested_at);
$$;

revoke all on function public.run_hosted_scheduler_request(uuid, uuid, uuid, text, uuid, uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.run_hosted_scheduler_request(uuid, uuid, uuid, text, uuid, uuid, timestamptz)
to service_role;
revoke all on function public.claim_paid_canary(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.claim_paid_canary(uuid, uuid) to service_role;
revoke all on function public.paid_canary_context(timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.paid_canary_context(timestamptz) to service_role;

commit;
