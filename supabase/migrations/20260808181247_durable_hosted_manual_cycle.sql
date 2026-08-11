begin;

insert into private.application_settings (
  owner_id,
  setting_key,
  value,
  is_secret,
  version
)
select
  app_user.user_id,
  'scheduler_provider',
  '"manual"'::jsonb,
  false,
  1
from public.app_users as app_user
where app_user.role = 'owner'
  and app_user.is_active
on conflict (owner_id, setting_key) do nothing;

do $$
begin
  if exists (
    select 1
    from public.app_users as app_user
    join private.application_settings as setting
      on setting.owner_id = app_user.user_id
      and setting.setting_key = 'scheduler_provider'
    where app_user.role = 'owner'
      and app_user.is_active
      and (
        setting.value is distinct from '"manual"'::jsonb
        or setting.is_secret
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'durable hosted manual cycle requires the reviewed manual scheduler provider';
  end if;
end;
$$;

create function private.hosted_manual_cycle_scope(
  p_owner_id uuid,
  p_experiment_id uuid
)
returns table (
  experiment_id uuid,
  decision_at timestamptz,
  control_state_version text,
  locked_version_id uuid,
  simulator_config_version_id uuid,
  simulation_account_id uuid,
  scheduler_provider text,
  ready boolean,
  reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_decision_at timestamptz := statement_timestamp();
begin
  if p_owner_id is null
    or p_experiment_id is null
    or p_owner_id <> (select auth.uid())
    or not (select private.current_user_is_owner())
  then
    raise exception using
      errcode = '42501',
      message = 'hosted manual cycle state is unavailable';
  end if;

  if not exists (
    select 1
    from public.experiments as owned_experiment
    where owned_experiment.id = p_experiment_id
      and owned_experiment.owner_id = p_owner_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'hosted manual cycle state is unavailable';
  end if;

  return query
  select
    experiment.id,
    v_decision_at,
    controls.state_version::text,
    experiment.locked_version_id,
    locked_version.simulator_config_version_id,
    account.id,
    setting.value #>> '{}',
    case
      when setting.value is distinct from '"manual"'::jsonb then false
      when experiment.lifecycle_status <> 'active' then false
      when experiment.execution_mode not in ('replay', 'shadow') then false
      when experiment.locked_at is null
        or experiment.locked_version_id is null
        or locked_version.id is null then false
      when controls.experiment_id is null then false
      when controls.scheduler_enabled
        or controls.agent_enabled
        or controls.emergency_paused then false
      when account.id is null or account.status <> 'active' then false
      when start_manifest.manifest_id is distinct from 'capital_lab_disabled_runtime_start_v1' then false
      when calendar_manifest.manifest_id is distinct from 'capital_lab_us_equities_calendar_2026_v1' then false
      when simulator.config #>> '{paperTradingOnly}' is distinct from 'true' then false
      when routing.config #>> '{agentEnabled}' is distinct from 'false'
        or routing.config #>> '{paidCallsEnabled}' is distinct from 'false'
        or routing.config #>> '{solEnabled}' is distinct from 'false'
        or routing.config #>> '{webSearchEnabled}' is distinct from 'false' then false
      when data_sources.config #>> '{runtimeFetchEnabled}' is distinct from 'false'
        or data_sources.config #>> '{manualIngestionOnly}' is distinct from 'true' then false
      else true
    end,
    case
      when setting.value is distinct from '"manual"'::jsonb then 'scheduler_provider_not_manual'
      when experiment.lifecycle_status <> 'active' then 'experiment_not_active'
      when experiment.execution_mode not in ('replay', 'shadow') then 'execution_mode_not_supported'
      when experiment.locked_at is null
        or experiment.locked_version_id is null
        or locked_version.id is null then 'locked_version_unavailable'
      when controls.experiment_id is null then 'controls_unavailable'
      when controls.scheduler_enabled then 'remote_scheduler_must_remain_disabled'
      when controls.agent_enabled then 'agent_must_remain_disabled'
      when controls.emergency_paused then 'experiment_emergency_paused'
      when account.id is null or account.status <> 'active' then 'paper_account_not_active'
      when start_manifest.manifest_id is distinct from 'capital_lab_disabled_runtime_start_v1'
        or calendar_manifest.manifest_id is distinct from 'capital_lab_us_equities_calendar_2026_v1'
        or simulator.config #>> '{paperTradingOnly}' is distinct from 'true'
        or routing.config #>> '{agentEnabled}' is distinct from 'false'
        or routing.config #>> '{paidCallsEnabled}' is distinct from 'false'
        or routing.config #>> '{solEnabled}' is distinct from 'false'
        or routing.config #>> '{webSearchEnabled}' is distinct from 'false'
        or data_sources.config #>> '{runtimeFetchEnabled}' is distinct from 'false'
        or data_sources.config #>> '{manualIngestionOnly}' is distinct from 'true'
      then 'locked_runtime_contract_unavailable'
      else null::text
    end
  from public.experiments as experiment
  left join public.experiment_controls as controls
    on controls.experiment_id = experiment.id
    and controls.owner_id = experiment.owner_id
  left join public.experiment_versions as locked_version
    on locked_version.id = experiment.locked_version_id
    and locked_version.experiment_id = experiment.id
    and locked_version.owner_id = experiment.owner_id
  left join public.simulation_accounts as account
    on account.experiment_id = experiment.id
    and account.owner_id = experiment.owner_id
  left join public.experiment_start_manifests as start_manifest
    on start_manifest.id = locked_version.start_manifest_id
    and start_manifest.owner_id = experiment.owner_id
  left join public.market_calendar_manifests as calendar_manifest
    on calendar_manifest.id = locked_version.market_calendar_manifest_id
    and calendar_manifest.owner_id = experiment.owner_id
  left join public.configuration_versions as simulator
    on simulator.id = locked_version.simulator_config_version_id
    and simulator.owner_id = experiment.owner_id
    and simulator.config_kind = 'simulator'
  left join public.configuration_versions as routing
    on routing.id = locked_version.model_routing_version_id
    and routing.owner_id = experiment.owner_id
    and routing.config_kind = 'model_routing'
  left join public.configuration_versions as data_sources
    on data_sources.id = locked_version.data_source_config_version_id
    and data_sources.owner_id = experiment.owner_id
    and data_sources.config_kind = 'data_sources'
  left join private.application_settings as setting
    on setting.owner_id = experiment.owner_id
    and setting.setting_key = 'scheduler_provider'
    and not setting.is_secret
  where experiment.id = p_experiment_id
    and experiment.owner_id = p_owner_id;
end;
$$;

create function private.hosted_manual_cycle_state(
  p_experiment_id uuid
)
returns table (
  experiment_id uuid,
  decision_at timestamptz,
  control_state_version text,
  scheduler_provider text,
  ready boolean,
  reason text,
  last_scheduler_run_id uuid,
  last_simulator_run_id uuid,
  last_slot_key text,
  last_status text,
  last_reason text,
  last_decision_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_scope record;
begin
  if v_owner_id is null or not (select private.current_user_is_owner()) then
    raise exception using
      errcode = '42501',
      message = 'hosted manual cycle state is unavailable';
  end if;

  select *
  into strict v_scope
  from private.hosted_manual_cycle_scope(v_owner_id, p_experiment_id);

  return query
  select
    v_scope.experiment_id,
    v_scope.decision_at,
    v_scope.control_state_version,
    v_scope.scheduler_provider,
    v_scope.ready,
    v_scope.reason,
    scheduler_run.id,
    simulator_run.id,
    scheduler_slot.slot_key,
    scheduler_run.status,
    scheduler_run.skipped_reason,
    case
      when scheduler_run.metadata ->> 'decision_at' is null then null::timestamptz
      else (scheduler_run.metadata ->> 'decision_at')::timestamptz
    end
  from (values (true)) as singleton(one)
  left join lateral (
    select run.*
    from private.scheduler_runs as run
    where run.owner_id = v_owner_id
      and run.experiment_id = p_experiment_id
      and run.metadata ->> 'contract_id' = 'capital_lab_hosted_manual_cycle_v1'
    order by run.started_at desc, run.id desc
    limit 1
  ) as scheduler_run on true
  left join private.scheduler_slots as scheduler_slot
    on scheduler_slot.slot_key = scheduler_run.slot_key
    and scheduler_slot.owner_id = scheduler_run.owner_id
  left join public.simulator_runs as simulator_run
    on simulator_run.experiment_id = p_experiment_id
    and simulator_run.owner_id = v_owner_id
    and simulator_run.slot_key = scheduler_run.slot_key;
end;
$$;

create function public.hosted_manual_cycle_state(
  p_experiment_id uuid
)
returns table (
  experiment_id uuid,
  decision_at timestamptz,
  control_state_version text,
  scheduler_provider text,
  ready boolean,
  reason text,
  last_scheduler_run_id uuid,
  last_simulator_run_id uuid,
  last_slot_key text,
  last_status text,
  last_reason text,
  last_decision_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.hosted_manual_cycle_state(p_experiment_id);
$$;

create function private.run_hosted_manual_cycle(
  p_operation_id uuid,
  p_experiment_id uuid,
  p_expected_control_state_version text,
  p_decision_at timestamptz,
  p_confirmation text
)
returns table (
  scheduler_run_id uuid,
  simulator_run_id uuid,
  slot_key text,
  decision_at timestamptz,
  status text,
  reason text,
  model_calls integer,
  paper_orders_created integer,
  paper_fills_created integer,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_expected_control_state_version bigint;
  v_controls public.experiment_controls%rowtype;
  v_experiment public.experiments%rowtype;
  v_locked_version public.experiment_versions%rowtype;
  v_account public.simulation_accounts%rowtype;
  v_request_payload jsonb;
  v_request_hash text;
  v_idempotency private.idempotency_records%rowtype;
  v_inserted_idempotency boolean;
  v_audit private.audit_log%rowtype;
  v_decision_at timestamptz;
  v_slot_at timestamptz;
  v_slot_key text;
  v_existing_slot private.scheduler_slots%rowtype;
  v_scheduler_run_id uuid;
  v_simulator_run_id uuid;
  v_status text := 'skipped';
  v_reason text;
  v_xnas_session public.market_sessions%rowtype;
  v_arcx_session public.market_sessions%rowtype;
  v_result jsonb;
begin
  if v_owner_id is null or not (select private.current_user_is_owner()) then
    raise exception using
      errcode = '42501',
      message = 'hosted manual cycle is unavailable';
  end if;

  if p_operation_id is null or p_experiment_id is null then
    raise exception using
      errcode = '22023',
      message = 'operation and experiment ids are required';
  end if;

  if p_decision_at is null
    or p_decision_at > statement_timestamp()
    or p_decision_at < timestamptz '2026-01-01 00:00:00+00'
    or p_decision_at >= timestamptz '2027-01-01 00:00:00+00'
  then
    raise exception using
      errcode = '22023',
      message = 'decision timestamp must be an eligible reviewed 2026 boundary';
  end if;

  if p_expected_control_state_version is null
    or p_expected_control_state_version !~ '^(0|[1-9][0-9]*)$'
  then
    raise exception using
      errcode = '22023',
      message = 'expected control state version must be a canonical nonnegative integer';
  end if;

  begin
    v_expected_control_state_version := p_expected_control_state_version::bigint;
  exception
    when numeric_value_out_of_range then
      raise exception using
        errcode = '22023',
        message = 'expected control state version is outside the supported range';
  end;

  if coalesce(p_confirmation, '') <> 'RUN PAPER CYCLE' then
    raise exception using
      errcode = '22023',
      message = 'exact paper cycle confirmation is required';
  end if;

  v_request_payload := jsonb_build_object(
    'contract_version', 1,
    'experiment_id', p_experiment_id::text,
    'expected_control_state_version', p_expected_control_state_version,
    'decision_at', p_decision_at,
    'confirmation', p_confirmation
  );
  v_request_hash := encode(
    extensions.digest(v_request_payload::text, 'sha256'),
    'hex'
  );

  insert into private.idempotency_records (
    owner_id,
    scope,
    idempotency_key,
    request_hash,
    status
  ) values (
    v_owner_id,
    'scheduler.hosted_manual_cycle.v1',
    p_operation_id::text,
    v_request_hash,
    'processing'
  )
  on conflict (owner_id, scope, idempotency_key) do nothing
  returning * into v_idempotency;

  v_inserted_idempotency := found;

  if not v_inserted_idempotency then
    select record.*
    into strict v_idempotency
    from private.idempotency_records as record
    where record.owner_id = v_owner_id
      and record.scope = 'scheduler.hosted_manual_cycle.v1'
      and record.idempotency_key = p_operation_id::text
    for update;

    if v_idempotency.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'manual cycle operation id was reused with different input';
    end if;

    if v_idempotency.status <> 'completed'
      or v_idempotency.result_ref_type <> 'scheduler_run'
      or v_idempotency.result_ref_id is null
    then
      raise exception using
        errcode = '55000',
        message = 'manual cycle operation has an inconsistent idempotency record';
    end if;

    select audit.*
    into v_audit
    from private.audit_log as audit
    where audit.owner_id = v_owner_id
      and audit.experiment_id = p_experiment_id
      and audit.actor_type = 'owner'
      and audit.actor_id = v_owner_id
      and audit.action = 'scheduler.hosted_manual_cycle_requested'
      and audit.target_type = 'scheduler_run'
      and audit.target_id = v_idempotency.result_ref_id
      and audit.correlation_id = p_operation_id;

    if not found
      or v_audit.metadata ->> 'contract_id' <> 'capital_lab_hosted_manual_cycle_v1'
      or v_audit.metadata ->> 'paper_only' <> 'true'
      or v_audit.metadata ->> 'model_calls' <> '0'
      or v_audit.metadata ->> 'paper_orders_created' <> '0'
      or v_audit.metadata ->> 'paper_fills_created' <> '0'
      or v_audit.metadata ->> 'status' <> 'skipped'
      or v_audit.metadata ->> 'slot_key' is null
      or v_audit.metadata ->> 'decision_at' is null
    then
      raise exception using
        errcode = '55000',
        message = 'manual cycle replay is missing immutable evidence';
    end if;

    return query
    select
      v_idempotency.result_ref_id,
      nullif(v_audit.metadata ->> 'simulator_run_id', '')::uuid,
      v_audit.metadata ->> 'slot_key',
      (v_audit.metadata ->> 'decision_at')::timestamptz,
      v_audit.metadata ->> 'status',
      v_audit.metadata ->> 'reason',
      0,
      0,
      0,
      true;
    return;
  end if;

  -- Shared global lifecycle order: controls, experiment, then paper account.
  select controls.*
  into v_controls
  from public.experiment_controls as controls
  where controls.experiment_id = p_experiment_id
    and controls.owner_id = v_owner_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'hosted manual cycle is unavailable';
  end if;

  select experiment.*
  into v_experiment
  from public.experiments as experiment
  where experiment.id = p_experiment_id
    and experiment.owner_id = v_owner_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'hosted manual cycle is unavailable';
  end if;

  select account.*
  into v_account
  from public.simulation_accounts as account
  where account.experiment_id = p_experiment_id
    and account.owner_id = v_owner_id
  for update;

  if not found then
    raise exception using errcode = '55000', message = 'paper simulation account is unavailable';
  end if;

  if v_controls.state_version <> v_expected_control_state_version then
    raise exception using
      errcode = '40001',
      message = 'experiment controls changed; reload before running a cycle';
  end if;

  if v_experiment.lifecycle_status <> 'active'
    or v_experiment.execution_mode not in ('replay', 'shadow')
    or v_experiment.locked_at is null
    or v_experiment.locked_version_id is null
    or v_controls.scheduler_enabled
    or v_controls.agent_enabled
    or v_controls.emergency_paused
    or v_account.status <> 'active'
  then
    raise exception using
      errcode = '55000',
      message = 'experiment is not eligible for a manual paper cycle';
  end if;

  if v_experiment.execution_mode = 'shadow'
    and p_decision_at < statement_timestamp() - interval '5 minutes'
  then
    raise exception using
      errcode = '55000',
      message = 'shadow cycles require a current decision boundary';
  end if;

  select locked_version.*
  into v_locked_version
  from public.experiment_versions as locked_version
  join public.experiment_start_manifests as start_manifest
    on start_manifest.id = locked_version.start_manifest_id
    and start_manifest.owner_id = locked_version.owner_id
    and start_manifest.manifest_id = 'capital_lab_disabled_runtime_start_v1'
  join public.market_calendar_manifests as calendar_manifest
    on calendar_manifest.id = locked_version.market_calendar_manifest_id
    and calendar_manifest.owner_id = locked_version.owner_id
    and calendar_manifest.manifest_id = 'capital_lab_us_equities_calendar_2026_v1'
  join public.configuration_versions as simulator
    on simulator.id = locked_version.simulator_config_version_id
    and simulator.owner_id = locked_version.owner_id
    and simulator.config_kind = 'simulator'
    and simulator.config #>> '{paperTradingOnly}' = 'true'
  join public.configuration_versions as routing
    on routing.id = locked_version.model_routing_version_id
    and routing.owner_id = locked_version.owner_id
    and routing.config_kind = 'model_routing'
    and routing.config #>> '{agentEnabled}' = 'false'
    and routing.config #>> '{paidCallsEnabled}' = 'false'
    and routing.config #>> '{solEnabled}' = 'false'
    and routing.config #>> '{webSearchEnabled}' = 'false'
  join public.configuration_versions as data_sources
    on data_sources.id = locked_version.data_source_config_version_id
    and data_sources.owner_id = locked_version.owner_id
    and data_sources.config_kind = 'data_sources'
    and data_sources.config #>> '{runtimeFetchEnabled}' = 'false'
    and data_sources.config #>> '{manualIngestionOnly}' = 'true'
  where locked_version.id = v_experiment.locked_version_id
    and locked_version.experiment_id = p_experiment_id
    and locked_version.owner_id = v_owner_id;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'locked paper-only runtime contract is unavailable';
  end if;

  if not exists (
    select 1
    from private.application_settings as setting
    where setting.owner_id = v_owner_id
      and setting.setting_key = 'scheduler_provider'
      and setting.value = '"manual"'::jsonb
      and not setting.is_secret
  ) then
    raise exception using
      errcode = '55000',
      message = 'manual scheduler provider is not active';
  end if;

  v_decision_at := p_decision_at;
  if v_experiment.starts_at is null
    or (
      v_experiment.execution_mode = 'shadow'
      and v_experiment.starts_at > v_decision_at
    )
  then
    raise exception using
      errcode = '55000',
      message = 'experiment start time is unavailable for the cycle boundary';
  end if;

  v_slot_at := date_trunc('hour', v_decision_at)
    + make_interval(mins => (extract(minute from v_decision_at)::integer / 15) * 15);
  v_slot_key := 'hosted-paper-cycle:' || p_experiment_id::text || ':'
    || to_char(v_slot_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  perform pg_advisory_xact_lock(
    hashtextextended(v_owner_id::text || ':' || v_slot_key, 0)
  );

  select slot.*
  into v_existing_slot
  from private.scheduler_slots as slot
  where slot.slot_key = v_slot_key
  for update;

  if found then
    if v_existing_slot.owner_id <> v_owner_id
      or v_existing_slot.experiment_id is distinct from p_experiment_id
      or v_existing_slot.job_type <> 'hosted_paper_cycle'
      or v_existing_slot.scheduler_provider <> 'manual'
      or v_existing_slot.status <> 'skipped'
      or v_existing_slot.result is null
      or v_existing_slot.result ->> 'contract_id' <> 'capital_lab_hosted_manual_cycle_v1'
      or v_existing_slot.result ->> 'scheduler_run_id' is null
      or v_existing_slot.result ->> 'simulator_run_id' is null
    then
      raise exception using
        errcode = '55000',
        message = 'manual cycle slot has inconsistent prior evidence';
    end if;

    v_scheduler_run_id := (v_existing_slot.result ->> 'scheduler_run_id')::uuid;
    v_simulator_run_id := (v_existing_slot.result ->> 'simulator_run_id')::uuid;
    v_decision_at := (v_existing_slot.result ->> 'decision_at')::timestamptz;
    v_status := v_existing_slot.result ->> 'status';
    v_reason := v_existing_slot.result ->> 'reason';

    if not exists (
      select 1
      from private.scheduler_runs as run
      where run.id = v_scheduler_run_id
        and run.owner_id = v_owner_id
        and run.experiment_id = p_experiment_id
        and run.slot_key = v_slot_key
        and run.status = v_status
        and run.skipped_reason = v_reason
    ) or not exists (
      select 1
      from public.simulator_runs as run
      where run.id = v_simulator_run_id
        and run.owner_id = v_owner_id
        and run.experiment_id = p_experiment_id
        and run.slot_key = v_slot_key
        and run.status = 'skipped'
    ) then
      raise exception using
        errcode = '55000',
        message = 'manual cycle duplicate result is incomplete';
    end if;
  else
    select session.*
    into v_xnas_session
    from public.market_sessions as session
    join public.exchanges as exchange on exchange.id = session.exchange_id
    where session.calendar_manifest_id = v_locked_version.market_calendar_manifest_id
      and session.session_date = (v_decision_at at time zone 'America/New_York')::date
      and session.available_at <= v_decision_at
      and exchange.mic = 'XNAS';

    select session.*
    into v_arcx_session
    from public.market_sessions as session
    join public.exchanges as exchange on exchange.id = session.exchange_id
    where session.calendar_manifest_id = v_locked_version.market_calendar_manifest_id
      and session.session_date = (v_decision_at at time zone 'America/New_York')::date
      and session.available_at <= v_decision_at
      and exchange.mic = 'ARCX';

    if v_xnas_session.id is null and v_arcx_session.id is null then
      v_reason := 'market_closed';
    elsif v_xnas_session.id is null
      or v_arcx_session.id is null
      or v_xnas_session.session_type <> v_arcx_session.session_type
      or v_xnas_session.opens_at is distinct from v_arcx_session.opens_at
      or v_xnas_session.closes_at is distinct from v_arcx_session.closes_at
    then
      raise exception using
        errcode = '55000',
        message = 'official market session evidence is inconsistent';
    elsif v_xnas_session.session_type = 'closed' then
      v_reason := 'market_closed';
    elsif v_xnas_session.opens_at is null
      or v_xnas_session.closes_at is null
      or v_decision_at < v_xnas_session.opens_at
      or v_decision_at >= v_xnas_session.closes_at
    then
      v_reason := 'outside_regular_session';
    else
      v_reason := 'market_data_runtime_disabled';
    end if;

    v_scheduler_run_id := gen_random_uuid();
    v_simulator_run_id := gen_random_uuid();
    v_result := jsonb_build_object(
      'contract_id', 'capital_lab_hosted_manual_cycle_v1',
      'decision_at', v_decision_at,
      'scheduler_run_id', v_scheduler_run_id,
      'simulator_run_id', v_simulator_run_id,
      'status', v_status,
      'reason', v_reason,
      'model_calls', 0,
      'paper_orders_created', 0,
      'paper_fills_created', 0
    );

    insert into private.scheduler_slots (
      slot_key,
      owner_id,
      experiment_id,
      job_type,
      scheduler_provider,
      exchange_session_id,
      slot_at,
      lease_until,
      status,
      result
    ) values (
      v_slot_key,
      v_owner_id,
      p_experiment_id,
      'hosted_paper_cycle',
      'manual',
      v_xnas_session.id,
      v_slot_at,
      v_decision_at + interval '60 seconds',
      'skipped',
      v_result
    );

    insert into private.scheduler_runs (
      id,
      slot_key,
      owner_id,
      experiment_id,
      correlation_id,
      status,
      started_at,
      finished_at,
      skipped_reason,
      retry_eligible,
      metadata
    ) values (
      v_scheduler_run_id,
      v_slot_key,
      v_owner_id,
      p_experiment_id,
      p_operation_id,
      'skipped',
      v_decision_at,
      v_decision_at,
      v_reason,
      false,
      jsonb_build_object(
        'contract_id', 'capital_lab_hosted_manual_cycle_v1',
        'decision_at', v_decision_at,
        'execution_mode', v_experiment.execution_mode,
        'paper_only', true,
        'provider_request_made', false,
        'agent_enabled', false,
        'model_calls', 0,
        'paper_orders_created', 0,
        'paper_fills_created', 0
      )
    );

    insert into public.simulator_runs (
      id,
      experiment_id,
      owner_id,
      slot_key,
      simulator_config_version_id,
      status,
      started_at,
      finished_at,
      correlation_id,
      metadata
    ) values (
      v_simulator_run_id,
      p_experiment_id,
      v_owner_id,
      v_slot_key,
      v_locked_version.simulator_config_version_id,
      'skipped',
      v_decision_at,
      v_decision_at,
      p_operation_id,
      jsonb_build_object(
        'contract_id', 'capital_lab_hosted_manual_cycle_v1',
        'decision_at', v_decision_at,
        'paper_only', true,
        'reason', v_reason,
        'orders_created', 0,
        'fills_created', 0,
        'ledger_entries_created', 0
      )
    );
  end if;

  insert into private.audit_log (
    owner_id,
    experiment_id,
    actor_type,
    actor_id,
    action,
    target_type,
    target_id,
    correlation_id,
    metadata
  ) values (
    v_owner_id,
    p_experiment_id,
    'owner',
    v_owner_id,
    'scheduler.hosted_manual_cycle_requested',
    'scheduler_run',
    v_scheduler_run_id,
    p_operation_id,
    jsonb_build_object(
      'contract_id', 'capital_lab_hosted_manual_cycle_v1',
      'decision_at', v_decision_at,
      'duplicate_slot', v_existing_slot.slot_key is not null,
      'paper_only', true,
      'provider_request_made', false,
      'agent_enabled', false,
      'remote_scheduler_enabled', false,
      'slot_key', v_slot_key,
      'status', v_status,
      'reason', v_reason,
      'simulator_run_id', v_simulator_run_id,
      'model_calls', 0,
      'paper_orders_created', 0,
      'paper_fills_created', 0,
      'ledger_entries_created', 0
    )
  );

  update private.idempotency_records as record
  set status = 'completed',
      result_ref_type = 'scheduler_run',
      result_ref_id = v_scheduler_run_id,
      completed_at = statement_timestamp()
  where record.id = v_idempotency.id
    and record.owner_id = v_owner_id
    and record.status = 'processing';

  if not found then
    raise exception using
      errcode = '55000',
      message = 'manual cycle could not finalize its idempotency record';
  end if;

  return query
  select
    v_scheduler_run_id,
    v_simulator_run_id,
    v_slot_key,
    v_decision_at,
    v_status,
    v_reason,
    0,
    0,
    0,
    v_existing_slot.slot_key is not null;
end;
$$;

create function public.run_hosted_manual_cycle(
  p_operation_id uuid,
  p_experiment_id uuid,
  p_expected_control_state_version text,
  p_decision_at timestamptz,
  p_confirmation text
)
returns table (
  scheduler_run_id uuid,
  simulator_run_id uuid,
  slot_key text,
  decision_at timestamptz,
  status text,
  reason text,
  model_calls integer,
  paper_orders_created integer,
  paper_fills_created integer,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.run_hosted_manual_cycle(
    p_operation_id,
    p_experiment_id,
    p_expected_control_state_version,
    p_decision_at,
    p_confirmation
  );
$$;

revoke all on function private.hosted_manual_cycle_scope(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.hosted_manual_cycle_state(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.hosted_manual_cycle_state(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.run_hosted_manual_cycle(uuid, uuid, text, timestamptz, text)
from public, anon, authenticated, service_role;
revoke all on function public.run_hosted_manual_cycle(uuid, uuid, text, timestamptz, text)
from public, anon, authenticated, service_role;

grant execute on function private.hosted_manual_cycle_scope(uuid, uuid)
to authenticated;
grant execute on function private.hosted_manual_cycle_state(uuid)
to authenticated;
grant execute on function public.hosted_manual_cycle_state(uuid)
to authenticated;
grant execute on function private.run_hosted_manual_cycle(uuid, uuid, text, timestamptz, text)
to authenticated;
grant execute on function public.run_hosted_manual_cycle(uuid, uuid, text, timestamptz, text)
to authenticated;

comment on function public.hosted_manual_cycle_state(uuid) is
'Owner-only state projection for the manual paper-cycle scheduler envelope. It exposes no credential, environment, provider payload, or mutable runtime control.';
comment on function public.run_hosted_manual_cycle(uuid, uuid, text, timestamptz, text) is
'Owner-only, control-revision-checked, idempotent manual paper-cycle envelope. It records only skipped scheduler/simulator evidence and cannot fetch data, call a model, create an order/fill, or write financial state.';

commit;
