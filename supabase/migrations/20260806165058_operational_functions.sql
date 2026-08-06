begin;

create function private.post_cash_ledger_entry(
  p_owner_id uuid,
  p_simulation_account_id uuid,
  p_experiment_id uuid,
  p_idempotency_key text,
  p_entry_type text,
  p_currency text,
  p_amount numeric,
  p_effective_at timestamptz,
  p_source_type text,
  p_source_id uuid,
  p_source_component text,
  p_correlation_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry_row private.cash_ledger_entries%rowtype;
begin
  insert into private.cash_ledger_entries (
    owner_id, simulation_account_id, experiment_id, idempotency_key, entry_type,
    currency, amount, effective_at, source_type, source_id, source_component,
    correlation_id, metadata
  ) values (
    p_owner_id, p_simulation_account_id, p_experiment_id, p_idempotency_key,
    p_entry_type, p_currency, p_amount, p_effective_at, p_source_type,
    p_source_id, p_source_component, p_correlation_id, coalesce(p_metadata, '{}'::jsonb)
  ) on conflict (simulation_account_id, idempotency_key) do nothing
  returning * into entry_row;

  if not found then
    select * into strict entry_row
    from private.cash_ledger_entries
    where simulation_account_id = p_simulation_account_id
      and idempotency_key = p_idempotency_key;
    if entry_row.owner_id <> p_owner_id
       or entry_row.experiment_id <> p_experiment_id
       or entry_row.entry_type <> p_entry_type
       or entry_row.currency <> p_currency
       or entry_row.amount <> p_amount
       or entry_row.effective_at <> p_effective_at
       or entry_row.source_type <> p_source_type
       or entry_row.source_id <> p_source_id
       or entry_row.source_component <> p_source_component then
      raise exception using errcode = '23505', message = 'ledger idempotency key reused with different input';
    end if;
  end if;
  return entry_row.id;
end;
$$;

revoke all on function private.post_cash_ledger_entry(uuid, uuid, uuid, text, text, text, numeric, timestamptz, text, uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function private.post_cash_ledger_entry(uuid, uuid, uuid, text, text, text, numeric, timestamptz, text, uuid, text, uuid, jsonb) to service_role;

create function public.post_cash_ledger_entry(
  p_owner_id uuid,
  p_simulation_account_id uuid,
  p_experiment_id uuid,
  p_idempotency_key text,
  p_entry_type text,
  p_currency text,
  p_amount numeric,
  p_effective_at timestamptz,
  p_source_type text,
  p_source_id uuid,
  p_source_component text,
  p_correlation_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.post_cash_ledger_entry(
    p_owner_id, p_simulation_account_id, p_experiment_id, p_idempotency_key,
    p_entry_type, p_currency, p_amount, p_effective_at, p_source_type,
    p_source_id, p_source_component, p_correlation_id, p_metadata
  );
$$;

revoke all on function public.post_cash_ledger_entry(uuid, uuid, uuid, text, text, text, numeric, timestamptz, text, uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.post_cash_ledger_entry(uuid, uuid, uuid, text, text, text, numeric, timestamptz, text, uuid, text, uuid, jsonb) to service_role;

create function private.acquire_scheduler_slot(
  p_owner_id uuid,
  p_experiment_id uuid,
  p_slot_key text,
  p_job_type text,
  p_scheduler_provider text,
  p_exchange_session_id uuid,
  p_slot_at timestamptz,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  slot_row private.scheduler_slots%rowtype;
  current_provider text;
begin
  if p_lease_seconds < 1 or p_lease_seconds > 900 then
    raise exception using errcode = '22023', message = 'scheduler lease must be between 1 and 900 seconds';
  end if;
  select value #>> '{}' into current_provider
  from private.application_settings
  where owner_id = p_owner_id and setting_key = 'scheduler_provider';
  if current_provider is not null and current_provider <> p_scheduler_provider then
    return jsonb_build_object('acquired', false, 'reason', 'inactive_scheduler_provider', 'active_provider', current_provider);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_slot_key, 0));
  insert into private.scheduler_slots (
    slot_key, owner_id, experiment_id, job_type, scheduler_provider,
    exchange_session_id, slot_at, lease_until
  ) values (
    p_slot_key, p_owner_id, p_experiment_id, p_job_type, p_scheduler_provider,
    p_exchange_session_id, p_slot_at, statement_timestamp() + make_interval(secs => p_lease_seconds)
  ) on conflict (slot_key) do update
    set lease_until = excluded.lease_until,
        attempt_count = private.scheduler_slots.attempt_count + 1,
        status = 'running',
        result = null
    where private.scheduler_slots.status = 'running'
      and private.scheduler_slots.lease_until < statement_timestamp()
  returning * into slot_row;

  if found then
    return jsonb_build_object('acquired', true, 'slot_key', slot_row.slot_key, 'attempt_count', slot_row.attempt_count, 'lease_until', slot_row.lease_until);
  end if;
  select * into strict slot_row from private.scheduler_slots where slot_key = p_slot_key;
  return jsonb_build_object('acquired', false, 'reason', 'duplicate_slot', 'slot_key', slot_row.slot_key, 'status', slot_row.status, 'result', slot_row.result);
end;
$$;

revoke all on function private.acquire_scheduler_slot(uuid, uuid, text, text, text, uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function private.acquire_scheduler_slot(uuid, uuid, text, text, text, uuid, timestamptz, integer) to service_role;

create function public.acquire_scheduler_slot(
  p_owner_id uuid,
  p_experiment_id uuid,
  p_slot_key text,
  p_job_type text,
  p_scheduler_provider text,
  p_exchange_session_id uuid,
  p_slot_at timestamptz,
  p_lease_seconds integer default 300
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.acquire_scheduler_slot(
    p_owner_id, p_experiment_id, p_slot_key, p_job_type, p_scheduler_provider,
    p_exchange_session_id, p_slot_at, p_lease_seconds
  );
$$;

revoke all on function public.acquire_scheduler_slot(uuid, uuid, text, text, text, uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.acquire_scheduler_slot(uuid, uuid, text, text, text, uuid, timestamptz, integer) to service_role;

commit;
