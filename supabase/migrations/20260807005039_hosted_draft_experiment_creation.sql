begin;

alter table public.experiments
  add constraint experiments_name_length_check
  check (char_length(btrim(name)) between 3 and 100),
  add constraint experiments_objective_length_check
  check (char_length(btrim(objective)) between 10 and 1000);

create function private.create_draft_experiment(
  p_operation_id uuid,
  p_name text,
  p_objective text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_objective text := btrim(coalesce(p_objective, ''));
  v_experiment_id uuid;
  v_request_payload jsonb;
  v_request_hash text;
  v_idempotency private.idempotency_records%rowtype;
  v_inserted_idempotency boolean;
begin
  if v_owner_id is null or not private.current_user_is_owner() then
    raise exception using
      errcode = '42501',
      message = 'active owner authentication required';
  end if;

  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'operation id is required';
  end if;
  if char_length(v_name) < 3 or char_length(v_name) > 100 then
    raise exception using
      errcode = '22023',
      message = 'experiment name must contain between 3 and 100 characters';
  end if;
  if char_length(v_objective) < 10 or char_length(v_objective) > 1000 then
    raise exception using
      errcode = '22023',
      message = 'experiment objective must contain between 10 and 1000 characters';
  end if;

  v_request_payload := jsonb_build_object(
    'contract_version', 1,
    'name', v_name,
    'objective', v_objective,
    'base_currency', 'EUR',
    'initial_capital', '100000.00000000'
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
    'experiment.create_draft.v1',
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
      and record.scope = 'experiment.create_draft.v1'
      and record.idempotency_key = p_operation_id::text
    for update;

    if v_idempotency.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'draft operation id was reused with different input';
    end if;

    if v_idempotency.status <> 'completed'
      or v_idempotency.result_ref_type <> 'experiment'
      or v_idempotency.result_ref_id is null
    then
      raise exception using
        errcode = '55000',
        message = 'draft operation has an inconsistent idempotency record';
    end if;

    v_experiment_id := v_idempotency.result_ref_id;

    if not exists (
      select 1
      from public.experiments as experiment
      join public.experiment_controls as controls
        on controls.experiment_id = experiment.id
        and controls.owner_id = experiment.owner_id
      where experiment.id = v_experiment_id
        and experiment.owner_id = v_owner_id
        and experiment.name = v_name
        and experiment.objective = v_objective
        and experiment.lifecycle_status = 'draft'
        and experiment.execution_mode is null
        and experiment.base_currency = 'EUR'
        and experiment.initial_capital = '100000.00000000'::numeric(24,8)
        and experiment.starts_at is null
        and experiment.ends_at is null
        and experiment.pause_reason is null
        and experiment.locked_at is null
        and experiment.locked_version_id is null
        and not controls.scheduler_enabled
        and not controls.agent_enabled
        and not controls.emergency_paused
        and controls.pause_reason is null
        and controls.state_version = 0
    ) or not exists (
      select 1
      from public.experiment_status_events as event
      where event.experiment_id = v_experiment_id
        and event.owner_id = v_owner_id
        and event.from_status is null
        and event.to_status = 'draft'
        and event.reason_code = 'draft_created'
        and event.actor_type = 'owner'
        and event.correlation_id = p_operation_id
    ) or not exists (
      select 1
      from private.audit_log as audit
      where audit.experiment_id = v_experiment_id
        and audit.owner_id = v_owner_id
        and audit.actor_type = 'owner'
        and audit.actor_id = v_owner_id
        and audit.action = 'experiment.draft_created'
        and audit.target_type = 'experiment'
        and audit.target_id = v_experiment_id
        and audit.correlation_id = p_operation_id
    ) then
      raise exception using
        errcode = '55000',
        message = 'draft operation result no longer matches its safe defaults';
    end if;

    return v_experiment_id;
  end if;

  v_experiment_id := gen_random_uuid();

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
    ends_at,
    pause_reason,
    locked_at,
    locked_version_id
  ) values (
    v_experiment_id,
    v_owner_id,
    v_name,
    'draft',
    null,
    'EUR',
    '100000.00000000'::numeric(24,8),
    v_objective,
    null,
    null,
    null,
    null,
    null
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
    v_experiment_id,
    v_owner_id,
    false,
    false,
    false,
    null,
    0
  );

  insert into public.experiment_status_events (
    experiment_id,
    owner_id,
    from_status,
    to_status,
    reason_code,
    reason,
    actor_type,
    correlation_id
  ) values (
    v_experiment_id,
    v_owner_id,
    null,
    'draft',
    'draft_created',
    'Draft created by owner',
    'owner',
    p_operation_id
  );

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
    v_experiment_id,
    'owner',
    v_owner_id,
    'experiment.draft_created',
    'experiment',
    v_experiment_id,
    p_operation_id,
    jsonb_build_object(
      'contract_version', 1,
      'base_currency', 'EUR',
      'initial_capital', '100000.00000000',
      'paper_only', true
    )
  );

  update private.idempotency_records
  set status = 'completed',
      result_ref_type = 'experiment',
      result_ref_id = v_experiment_id,
      completed_at = statement_timestamp()
  where id = v_idempotency.id
    and owner_id = v_owner_id;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'draft operation could not finalize its idempotency record';
  end if;

  return v_experiment_id;
end;
$$;

create function public.create_draft_experiment(
  p_operation_id uuid,
  p_name text,
  p_objective text
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_draft_experiment(
    p_operation_id,
    p_name,
    p_objective
  );
$$;

revoke all on function private.create_draft_experiment(uuid, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.create_draft_experiment(uuid, text, text)
from public, anon, authenticated, service_role;

grant execute on function private.create_draft_experiment(uuid, text, text)
to authenticated, service_role;
grant execute on function public.create_draft_experiment(uuid, text, text)
to authenticated, service_role;

commit;
