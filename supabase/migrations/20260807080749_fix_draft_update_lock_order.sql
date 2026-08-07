begin;

create or replace function private.update_draft_experiment(
  p_operation_id uuid,
  p_experiment_id uuid,
  p_expected_revision text,
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
  v_expected_revision bigint;
  v_experiment public.experiments%rowtype;
  v_controls public.experiment_controls%rowtype;
  v_request_payload jsonb;
  v_request_hash text;
  v_idempotency private.idempotency_records%rowtype;
  v_inserted_idempotency boolean;
  v_changed_fields text[];
begin
  if v_owner_id is null or not private.current_user_is_owner() then
    raise exception using
      errcode = '42501',
      message = 'draft experiment is unavailable';
  end if;

  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'operation id is required';
  end if;
  if p_experiment_id is null then
    raise exception using errcode = '22023', message = 'experiment id is required';
  end if;
  if p_expected_revision is null
    or p_expected_revision !~ '^(0|[1-9][0-9]*)$'
  then
    raise exception using
      errcode = '22023',
      message = 'expected draft revision must be a canonical nonnegative integer';
  end if;

  begin
    v_expected_revision := p_expected_revision::bigint;
  exception
    when numeric_value_out_of_range then
      raise exception using
        errcode = '22023',
        message = 'expected draft revision is outside the supported range';
  end;

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
    'experiment_id', p_experiment_id::text,
    'expected_revision', p_expected_revision,
    'name', v_name,
    'objective', v_objective
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
    'experiment.update_draft.v1',
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
      and record.scope = 'experiment.update_draft.v1'
      and record.idempotency_key = p_operation_id::text
    for update;

    if v_idempotency.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'draft update operation id was reused with different input';
    end if;

    if v_idempotency.status <> 'completed'
      or v_idempotency.result_ref_type <> 'experiment'
      or v_idempotency.result_ref_id <> p_experiment_id
    then
      raise exception using
        errcode = '55000',
        message = 'draft update operation has an inconsistent idempotency record';
    end if;

    if not exists (
      select 1
      from public.experiments as experiment
      where experiment.id = p_experiment_id
        and experiment.owner_id = v_owner_id
    ) or not exists (
      select 1
      from private.audit_log as audit
      where audit.experiment_id = p_experiment_id
        and audit.owner_id = v_owner_id
        and audit.actor_type = 'owner'
        and audit.actor_id = v_owner_id
        and audit.action = 'experiment.draft_updated'
        and audit.target_type = 'experiment'
        and audit.target_id = p_experiment_id
        and audit.correlation_id = p_operation_id
    ) then
      raise exception using
        errcode = '55000',
        message = 'draft update operation result is missing its audit evidence';
    end if;

    return p_experiment_id;
  end if;

  -- Global order shared with budget auto-pause: controls, then experiment.
  select controls.*
  into v_controls
  from public.experiment_controls as controls
  where controls.experiment_id = p_experiment_id
    and controls.owner_id = v_owner_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'draft experiment is unavailable';
  end if;

  select experiment.*
  into v_experiment
  from public.experiments as experiment
  where experiment.id = p_experiment_id
    and experiment.owner_id = v_owner_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'draft experiment is unavailable';
  end if;

  if v_experiment.lifecycle_status <> 'draft'
    or v_experiment.execution_mode is not null
    or v_experiment.starts_at is not null
    or v_experiment.ends_at is not null
    or v_experiment.pause_reason is not null
    or v_experiment.locked_at is not null
    or v_experiment.locked_version_id is not null
    or v_controls.scheduler_enabled
    or v_controls.agent_enabled
    or v_controls.emergency_paused
    or v_controls.pause_reason is not null
  then
    raise exception using
      errcode = '55000',
      message = 'draft experiment is not editable';
  end if;

  if v_experiment.draft_revision <> v_expected_revision then
    raise exception using
      errcode = '40001',
      message = 'draft experiment changed; reload before saving again';
  end if;

  if v_experiment.name = v_name and v_experiment.objective = v_objective then
    raise exception using
      errcode = '22023',
      message = 'draft update must change the name or objective';
  end if;

  v_changed_fields := array_remove(array[
    case when v_experiment.name <> v_name then 'name' end,
    case when v_experiment.objective <> v_objective then 'objective' end
  ], null);

  update public.experiments
  set name = v_name,
      objective = v_objective,
      draft_revision = draft_revision + 1
  where id = p_experiment_id
    and owner_id = v_owner_id;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'draft experiment could not be updated';
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
    'experiment.draft_updated',
    'experiment',
    p_experiment_id,
    p_operation_id,
    jsonb_build_object(
      'contract_version', 1,
      'changed_fields', to_jsonb(v_changed_fields),
      'old_revision', v_expected_revision::text,
      'new_revision', (v_expected_revision + 1)::text,
      'paper_only', true
    )
  );

  update private.idempotency_records
  set status = 'completed',
      result_ref_type = 'experiment',
      result_ref_id = p_experiment_id,
      completed_at = statement_timestamp()
  where id = v_idempotency.id
    and owner_id = v_owner_id;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'draft update operation could not finalize its idempotency record';
  end if;

  return p_experiment_id;
end;
$$;

revoke all on function private.update_draft_experiment(uuid, uuid, text, text, text)
from public, anon, authenticated, service_role;

grant execute on function private.update_draft_experiment(uuid, uuid, text, text, text)
to authenticated, service_role;

commit;
