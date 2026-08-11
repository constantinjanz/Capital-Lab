begin;

alter table public.experiments
  add column source_experiment_id uuid;

alter table public.experiments
  add constraint experiments_source_experiment_fk
  foreign key (source_experiment_id, owner_id)
  references public.experiments(id, owner_id)
  on delete restrict;

create index experiments_source_experiment_idx
on public.experiments(source_experiment_id)
where source_experiment_id is not null;

alter table public.experiment_status_events
  add column from_execution_mode text,
  add column to_execution_mode text,
  add constraint experiment_status_events_from_execution_mode_check
    check (from_execution_mode is null or from_execution_mode in ('replay', 'shadow', 'live_paper')),
  add constraint experiment_status_events_to_execution_mode_check
    check (to_execution_mode is null or to_execution_mode in ('replay', 'shadow', 'live_paper'));

create or replace function private.guard_experiment_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_immutable jsonb;
  new_immutable jsonb;
begin
  if old.locked_at is not null and new.locked_at is null then
    raise exception using errcode = '55000', message = 'an experiment lock cannot be removed';
  end if;

  if new.lifecycle_status <> 'draft'
     and (new.locked_at is null or new.locked_version_id is null or new.execution_mode is null) then
    raise exception using errcode = '23514', message = 'a non-draft experiment requires a locked version, lock time, and execution mode';
  end if;

  if old.locked_at is not null then
    if old.execution_mode is distinct from new.execution_mode
      and not (
        old.lifecycle_status = 'active'
        and new.lifecycle_status = 'active'
        and old.execution_mode = 'shadow'
        and new.execution_mode = 'live_paper'
      )
    then
      raise exception using
        errcode = '55000',
        message = 'locked execution mode may change only from shadow to live-paper';
    end if;

    old_immutable := to_jsonb(old) - array[
      'lifecycle_status', 'execution_mode', 'pause_reason', 'ends_at', 'updated_at'
    ];
    new_immutable := to_jsonb(new) - array[
      'lifecycle_status', 'execution_mode', 'pause_reason', 'ends_at', 'updated_at'
    ];
    if old_immutable <> new_immutable then
      raise exception using errcode = '55000', message = 'locked experiment configuration is immutable';
    end if;
  end if;

  if old.lifecycle_status in ('completed', 'failed') and new.lifecycle_status <> old.lifecycle_status then
    raise exception using errcode = '55000', message = 'terminal experiment status is immutable';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_experiment_update()
from public, anon, authenticated;

create or replace view public.experiment_detail_read_view
with (security_invoker = true)
as
select
  experiment.id,
  experiment.owner_id,
  experiment.name,
  experiment.lifecycle_status,
  experiment.execution_mode,
  experiment.base_currency,
  experiment.initial_capital::text as initial_capital,
  experiment.objective,
  experiment.starts_at,
  experiment.ends_at,
  experiment.pause_reason as lifecycle_pause_reason,
  experiment.locked_at,
  experiment.locked_version_id,
  experiment.created_at,
  experiment.updated_at,
  controls.scheduler_enabled,
  controls.agent_enabled,
  controls.emergency_paused,
  controls.pause_reason as control_pause_reason,
  controls.state_version::text as control_state_version,
  controls.created_at as control_created_at,
  controls.updated_at as control_updated_at,
  locked_version.version as locked_version,
  locked_version.initial_capital::text as locked_initial_capital,
  locked_version.base_currency as locked_base_currency,
  locked_version.objective as locked_objective,
  locked_version.content_hash as locked_version_content_hash,
  locked_version.market_universe_id,
  locked_version.simulator_config_version_id,
  locked_version.risk_config_version_id,
  locked_version.model_routing_version_id,
  locked_version.data_source_config_version_id,
  locked_version.agent_prompt_version_id,
  locked_version.knowledge_corpus_version_id,
  locked_version.budget_policy_id,
  locked_version.created_at as locked_version_created_at,
  experiment.draft_revision::text as draft_revision,
  experiment.source_experiment_id
from public.experiments as experiment
left join public.experiment_controls as controls
  on controls.experiment_id = experiment.id
  and controls.owner_id = experiment.owner_id
left join public.experiment_versions as locked_version
  on locked_version.id = experiment.locked_version_id
  and locked_version.experiment_id = experiment.id
  and locked_version.owner_id = experiment.owner_id;

revoke all on public.experiment_detail_read_view
from public, anon, authenticated, service_role;

grant select on public.experiment_detail_read_view
to authenticated, service_role;

create function private.mutate_locked_experiment_lifecycle(
  p_operation_id uuid,
  p_experiment_id uuid,
  p_expected_control_state_version text,
  p_action text,
  p_reason text default null,
  p_confirmation text default null,
  p_locked_version_id uuid default null,
  p_clone_name text default null
)
returns table (
  experiment_id uuid,
  source_experiment_id uuid,
  lifecycle_status text,
  execution_mode text,
  control_state_version text,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_action text := btrim(coalesce(p_action, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_confirmation text := coalesce(p_confirmation, '');
  v_clone_name text := btrim(coalesce(p_clone_name, ''));
  v_expected_control_state_version bigint;
  v_controls public.experiment_controls%rowtype;
  v_experiment public.experiments%rowtype;
  v_locked_version public.experiment_versions%rowtype;
  v_simulation_account public.simulation_accounts%rowtype;
  v_request_payload jsonb;
  v_request_hash text;
  v_idempotency private.idempotency_records%rowtype;
  v_inserted_idempotency boolean;
  v_audit_action text;
  v_reason_code text;
  v_from_status text;
  v_to_status text;
  v_from_execution_mode text;
  v_to_execution_mode text;
  v_result_experiment_id uuid;
  v_result_source_experiment_id uuid;
  v_result_lifecycle_status text;
  v_result_execution_mode text;
  v_result_control_state_version bigint;
  v_audit private.audit_log%rowtype;
begin
  if v_owner_id is null or not private.current_user_is_owner() then
    raise exception using
      errcode = '42501',
      message = 'locked experiment lifecycle is unavailable';
  end if;

  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'operation id is required';
  end if;
  if p_experiment_id is null then
    raise exception using errcode = '22023', message = 'experiment id is required';
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

  if v_action not in ('promote_live_paper', 'pause', 'resume', 'complete', 'clone') then
    raise exception using errcode = '22023', message = 'unsupported lifecycle action';
  end if;

  if v_action = 'pause' then
    if char_length(v_reason) < 3 or char_length(v_reason) > 200 then
      raise exception using
        errcode = '22023',
        message = 'pause reason must contain between 3 and 200 characters';
    end if;
  elsif v_reason <> '' then
    raise exception using errcode = '22023', message = 'reason is not accepted for this lifecycle action';
  end if;

  if v_action = 'promote_live_paper' then
    if v_confirmation <> 'PROMOTE TO LIVE PAPER' or p_locked_version_id is null then
      raise exception using
        errcode = '22023',
        message = 'exact live-paper confirmation and locked version are required';
    end if;
  elsif v_confirmation <> '' or p_locked_version_id is not null then
    raise exception using errcode = '22023', message = 'confirmation is not accepted for this lifecycle action';
  end if;

  if v_action = 'clone' then
    if char_length(v_clone_name) < 3 or char_length(v_clone_name) > 100 then
      raise exception using
        errcode = '22023',
        message = 'clone name must contain between 3 and 100 characters';
    end if;
  elsif v_clone_name <> '' then
    raise exception using errcode = '22023', message = 'clone name is not accepted for this lifecycle action';
  end if;

  v_audit_action := case v_action
    when 'promote_live_paper' then 'experiment.promoted_live_paper'
    when 'pause' then 'experiment.paused'
    when 'resume' then 'experiment.resumed'
    when 'complete' then 'experiment.completed'
    when 'clone' then 'experiment.cloned'
  end;

  v_request_payload := jsonb_build_object(
    'contract_version', 1,
    'experiment_id', p_experiment_id::text,
    'expected_control_state_version', p_expected_control_state_version,
    'action', v_action,
    'reason', nullif(v_reason, ''),
    'confirmation', nullif(v_confirmation, ''),
    'locked_version_id', p_locked_version_id,
    'clone_name', nullif(v_clone_name, '')
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
    'experiment.locked_lifecycle.v1',
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
      and record.scope = 'experiment.locked_lifecycle.v1'
      and record.idempotency_key = p_operation_id::text
    for update;

    if v_idempotency.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'lifecycle operation id was reused with different input';
    end if;

    if v_idempotency.status <> 'completed'
      or v_idempotency.result_ref_type <> (
        case when v_action = 'clone' then 'experiment_clone' else 'experiment' end
      )
      or v_idempotency.result_ref_id is null
    then
      raise exception using
        errcode = '55000',
        message = 'lifecycle operation has an inconsistent idempotency record';
    end if;

    select audit.*
    into v_audit
    from private.audit_log as audit
    where audit.owner_id = v_owner_id
      and audit.experiment_id = p_experiment_id
      and audit.actor_type = 'owner'
      and audit.actor_id = v_owner_id
      and audit.action = v_audit_action
      and audit.target_type = 'experiment'
      and audit.target_id = v_idempotency.result_ref_id
      and audit.correlation_id = p_operation_id;

    if not found
      or v_audit.metadata ->> 'contract_version' <> '1'
      or v_audit.metadata ->> 'paper_only' <> 'true'
      or v_audit.metadata ->> 'result_control_state_version' !~ '^(0|[1-9][0-9]*)$'
      or v_audit.metadata ->> 'result_lifecycle_status' not in ('draft', 'active', 'paused', 'completed')
      or (
        v_audit.metadata ->> 'result_execution_mode' is not null
        and v_audit.metadata ->> 'result_execution_mode' not in ('replay', 'shadow', 'live_paper')
      )
      or not exists (
        select 1
        from public.experiments as result_experiment
        where result_experiment.id = v_idempotency.result_ref_id
          and result_experiment.owner_id = v_owner_id
      )
    then
      raise exception using
        errcode = '55000',
        message = 'lifecycle operation result is missing immutable evidence';
    end if;

    return query select
      v_idempotency.result_ref_id,
      case when v_action = 'clone' then p_experiment_id else null::uuid end,
      v_audit.metadata ->> 'result_lifecycle_status',
      v_audit.metadata ->> 'result_execution_mode',
      v_audit.metadata ->> 'result_control_state_version',
      true;
    return;
  end if;

  -- Shared global order with budget auto-pause and draft editing: controls first.
  select controls.*
  into v_controls
  from public.experiment_controls as controls
  where controls.experiment_id = p_experiment_id
    and controls.owner_id = v_owner_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'locked experiment lifecycle is unavailable';
  end if;

  select source_experiment.*
  into v_experiment
  from public.experiments as source_experiment
  where source_experiment.id = p_experiment_id
    and source_experiment.owner_id = v_owner_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'locked experiment lifecycle is unavailable';
  end if;

  if v_controls.state_version <> v_expected_control_state_version then
    raise exception using
      errcode = '40001',
      message = 'experiment controls changed; reload before trying again';
  end if;

  if v_experiment.lifecycle_status = 'draft'
    or v_experiment.lifecycle_status = 'starting'
    or v_experiment.locked_at is null
    or v_experiment.locked_version_id is null
    or v_experiment.execution_mode is null
  then
    raise exception using errcode = '55000', message = 'experiment is not a locked lifecycle target';
  end if;

  select locked_version.*
  into v_locked_version
  from public.experiment_versions as locked_version
  where locked_version.id = v_experiment.locked_version_id
    and locked_version.experiment_id = v_experiment.id
    and locked_version.owner_id = v_owner_id;

  if not found then
    raise exception using errcode = '55000', message = 'locked experiment version is unavailable';
  end if;

  v_from_status := v_experiment.lifecycle_status;
  v_from_execution_mode := v_experiment.execution_mode;
  v_result_experiment_id := p_experiment_id;
  v_result_source_experiment_id := null;
  v_result_lifecycle_status := v_experiment.lifecycle_status;
  v_result_execution_mode := v_experiment.execution_mode;
  v_result_control_state_version := v_controls.state_version + 1;

  if v_action in ('promote_live_paper', 'pause', 'resume', 'complete') then
    select account.*
    into v_simulation_account
    from public.simulation_accounts as account
    where account.experiment_id = p_experiment_id
      and account.owner_id = v_owner_id
    for update;

    if not found then
      raise exception using errcode = '55000', message = 'simulation account is unavailable';
    end if;
  end if;

  if v_action = 'promote_live_paper' then
    if v_experiment.lifecycle_status <> 'active'
      or v_experiment.execution_mode <> 'shadow'
      or v_controls.emergency_paused
      or v_controls.scheduler_enabled
      or v_controls.agent_enabled
      or v_simulation_account.status <> 'active'
      or p_locked_version_id <> v_experiment.locked_version_id
    then
      raise exception using errcode = '55000', message = 'shadow experiment is not eligible for live-paper simulation promotion';
    end if;

    update public.experiments as experiment
    set execution_mode = 'live_paper'
    where experiment.id = p_experiment_id and experiment.owner_id = v_owner_id;

    update public.experiment_controls as controls
    set state_version = controls.state_version + 1
    where controls.experiment_id = p_experiment_id and controls.owner_id = v_owner_id;

    v_reason_code := 'live_paper_promoted';
    v_to_status := 'active';
    v_to_execution_mode := 'live_paper';
    v_result_lifecycle_status := 'active';
    v_result_execution_mode := 'live_paper';
  elsif v_action = 'pause' then
    if v_experiment.lifecycle_status <> 'active'
      or v_simulation_account.status <> 'active'
    then
      raise exception using errcode = '55000', message = 'only an active experiment may be paused';
    end if;

    update public.experiments as experiment
    set lifecycle_status = 'paused', pause_reason = v_reason
    where experiment.id = p_experiment_id and experiment.owner_id = v_owner_id;

    update public.experiment_controls as controls
    set scheduler_enabled = false,
        agent_enabled = false,
        pause_reason = v_reason,
        state_version = controls.state_version + 1
    where controls.experiment_id = p_experiment_id and controls.owner_id = v_owner_id;

    update public.simulation_accounts as account
    set status = 'paused'
    where account.id = v_simulation_account.id and account.owner_id = v_owner_id;

    v_reason_code := 'owner_paused';
    v_to_status := 'paused';
    v_to_execution_mode := v_experiment.execution_mode;
    v_result_lifecycle_status := 'paused';
  elsif v_action = 'resume' then
    if v_experiment.lifecycle_status <> 'paused'
      or v_controls.emergency_paused
      or v_controls.scheduler_enabled
      or v_controls.agent_enabled
      or v_simulation_account.status <> 'paused'
    then
      raise exception using errcode = '55000', message = 'paused experiment is not eligible to resume';
    end if;

    update public.experiments as experiment
    set lifecycle_status = 'active', pause_reason = null
    where experiment.id = p_experiment_id and experiment.owner_id = v_owner_id;

    update public.experiment_controls as controls
    set pause_reason = null,
        state_version = controls.state_version + 1
    where controls.experiment_id = p_experiment_id and controls.owner_id = v_owner_id;

    update public.simulation_accounts as account
    set status = 'active'
    where account.id = v_simulation_account.id and account.owner_id = v_owner_id;

    v_reason_code := 'owner_resumed';
    v_to_status := 'active';
    v_to_execution_mode := v_experiment.execution_mode;
    v_result_lifecycle_status := 'active';
  elsif v_action = 'complete' then
    if v_experiment.lifecycle_status not in ('active', 'paused')
      or (
        v_experiment.lifecycle_status = 'active'
        and v_simulation_account.status <> 'active'
      )
      or (
        v_experiment.lifecycle_status = 'paused'
        and v_simulation_account.status <> 'paused'
      )
      or exists (
        select 1
        from public.orders as open_order
        where open_order.experiment_id = p_experiment_id
          and open_order.owner_id = v_owner_id
          and open_order.current_status in ('accepted', 'pending', 'triggered', 'partially_filled')
      )
    then
      raise exception using errcode = '55000', message = 'experiment is not eligible for completion';
    end if;

    update public.experiments as experiment
    set lifecycle_status = 'completed',
        pause_reason = null,
        ends_at = statement_timestamp()
    where experiment.id = p_experiment_id and experiment.owner_id = v_owner_id;

    update public.experiment_controls as controls
    set scheduler_enabled = false,
        agent_enabled = false,
        emergency_paused = false,
        pause_reason = null,
        state_version = controls.state_version + 1
    where controls.experiment_id = p_experiment_id and controls.owner_id = v_owner_id;

    update public.simulation_accounts as account
    set status = 'closed', closed_at = statement_timestamp()
    where account.id = v_simulation_account.id and account.owner_id = v_owner_id;

    v_reason_code := 'owner_completed';
    v_to_status := 'completed';
    v_to_execution_mode := v_experiment.execution_mode;
    v_result_lifecycle_status := 'completed';
  else
    v_result_experiment_id := gen_random_uuid();
    v_result_source_experiment_id := p_experiment_id;
    v_result_lifecycle_status := 'draft';
    v_result_execution_mode := null;
    v_result_control_state_version := 0;

    insert into public.experiments (
      id,
      owner_id,
      source_experiment_id,
      name,
      lifecycle_status,
      execution_mode,
      base_currency,
      initial_capital,
      objective,
      starts_at,
      ends_at,
      pause_reason,
      locked_at,
      locked_version_id,
      draft_revision
    ) values (
      v_result_experiment_id,
      v_owner_id,
      p_experiment_id,
      v_clone_name,
      'draft',
      null,
      v_locked_version.base_currency,
      v_locked_version.initial_capital,
      v_locked_version.objective,
      null,
      null,
      null,
      null,
      null,
      0
    );

    insert into public.experiment_controls (
      experiment_id,
      owner_id,
      scheduler_enabled,
      agent_enabled,
      emergency_paused,
      pause_reason,
      state_version
    ) values (
      v_result_experiment_id,
      v_owner_id,
      false,
      false,
      false,
      null,
      0
    );

    update public.experiment_controls as controls
    set state_version = controls.state_version + 1
    where controls.experiment_id = p_experiment_id and controls.owner_id = v_owner_id;

    insert into public.experiment_status_events (
      experiment_id,
      owner_id,
      from_status,
      to_status,
      from_execution_mode,
      to_execution_mode,
      reason_code,
      reason,
      actor_type,
      correlation_id
    ) values (
      v_result_experiment_id,
      v_owner_id,
      null,
      'draft',
      null,
      null,
      'cloned_to_draft',
      'Cloned from an immutable paper experiment',
      'owner',
      p_operation_id
    );
  end if;

  if v_action <> 'clone' then
    insert into public.experiment_status_events (
      experiment_id,
      owner_id,
      from_status,
      to_status,
      from_execution_mode,
      to_execution_mode,
      reason_code,
      reason,
      actor_type,
      correlation_id
    ) values (
      p_experiment_id,
      v_owner_id,
      v_from_status,
      v_to_status,
      v_from_execution_mode,
      v_to_execution_mode,
      v_reason_code,
      case when v_action = 'pause' then v_reason else null end,
      'owner',
      p_operation_id
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
    v_audit_action,
    'experiment',
    v_result_experiment_id,
    p_operation_id,
    jsonb_build_object(
      'contract_version', 1,
      'source_experiment_id', p_experiment_id::text,
      'locked_version_id', v_experiment.locked_version_id::text,
      'result_lifecycle_status', v_result_lifecycle_status,
      'result_execution_mode', v_result_execution_mode,
      'result_control_state_version', v_result_control_state_version::text,
      'paper_only', true,
      'scheduler_enabled', false,
      'agent_enabled', false
    )
  );

  update private.idempotency_records
  set status = 'completed',
      result_ref_type = case when v_action = 'clone' then 'experiment_clone' else 'experiment' end,
      result_ref_id = v_result_experiment_id,
      completed_at = statement_timestamp()
  where id = v_idempotency.id
    and owner_id = v_owner_id;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'lifecycle operation could not finalize its idempotency record';
  end if;

  return query select
    v_result_experiment_id,
    v_result_source_experiment_id,
    v_result_lifecycle_status,
    v_result_execution_mode,
    v_result_control_state_version::text,
    false;
end;
$$;

create function public.mutate_locked_experiment_lifecycle(
  p_operation_id uuid,
  p_experiment_id uuid,
  p_expected_control_state_version text,
  p_action text,
  p_reason text default null,
  p_confirmation text default null,
  p_locked_version_id uuid default null,
  p_clone_name text default null
)
returns table (
  experiment_id uuid,
  source_experiment_id uuid,
  lifecycle_status text,
  execution_mode text,
  control_state_version text,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.mutate_locked_experiment_lifecycle(
    p_operation_id,
    p_experiment_id,
    p_expected_control_state_version,
    p_action,
    p_reason,
    p_confirmation,
    p_locked_version_id,
    p_clone_name
  );
$$;

revoke all on function private.mutate_locked_experiment_lifecycle(
  uuid, uuid, text, text, text, text, uuid, text
)
from public, anon, authenticated, service_role;

revoke all on function public.mutate_locked_experiment_lifecycle(
  uuid, uuid, text, text, text, text, uuid, text
)
from public, anon, authenticated, service_role;

grant execute on function private.mutate_locked_experiment_lifecycle(
  uuid, uuid, text, text, text, text, uuid, text
)
to authenticated, service_role;

grant execute on function public.mutate_locked_experiment_lifecycle(
  uuid, uuid, text, text, text, text, uuid, text
)
to authenticated, service_role;

commit;
