begin;

create function private.reserve_ai_budget(
  p_owner_id uuid,
  p_experiment_id uuid,
  p_agent_run_id uuid,
  p_budget_policy_id uuid,
  p_pricing_id uuid,
  p_call_kind text,
  p_max_input_tokens integer,
  p_max_output_tokens integer,
  p_max_tool_calls integer,
  p_requested_at timestamptz,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  policy_row public.ai_budget_policies%rowtype;
  pricing_row public.model_pricing%rowtype;
  existing_row private.ai_budget_reservations%rowtype;
  day_id uuid;
  month_id uuid;
  life_id uuid;
  quota_one_id uuid;
  quota_two_id uuid;
  reservation_id uuid;
  local_date date;
  local_month timestamp;
  day_start timestamptz;
  day_end timestamptz;
  month_start timestamptz;
  month_end timestamptz;
  slot_start timestamptz;
  worst_cost numeric(20,8);
  quota_one_key text;
  quota_one_kind text;
  quota_one_start timestamptz;
  quota_one_end timestamptz;
  quota_one_limit integer;
  quota_two_key text;
  quota_two_kind text;
  quota_two_start timestamptz;
  quota_two_end timestamptz;
  quota_two_limit integer;
  period_row private.ai_budget_periods%rowtype;
  quota_row private.ai_quota_periods%rowtype;
begin
  if p_requested_at is null
     or p_max_input_tokens is null or p_max_input_tokens < 0
     or p_max_output_tokens is null or p_max_output_tokens < 0
     or p_max_tool_calls is null or p_max_tool_calls < 0 then
    raise exception using errcode = '22023', message = 'invalid budget reservation inputs';
  end if;
  if p_call_kind not in ('luna', 'terra', 'sol', 'web_search') then
    raise exception using errcode = '22023', message = 'invalid call kind';
  end if;
  if auth.uid() is not null and auth.uid() <> p_owner_id then
    raise exception using errcode = '42501', message = 'owner mismatch';
  end if;
  if not exists (select 1 from public.app_users where user_id = p_owner_id and role = 'owner' and is_active) then
    raise exception using errcode = '42501', message = 'inactive or unknown owner';
  end if;

  select * into existing_row
  from private.ai_budget_reservations
  where owner_id = p_owner_id and idempotency_key = p_idempotency_key;
  if found then
    if existing_row.request_hash <> p_request_hash then
      raise exception using errcode = '23505', message = 'idempotency key reused with different request';
    end if;
    return jsonb_build_object('allowed', true, 'reservation_id', existing_row.id, 'status', existing_row.status, 'idempotent', true);
  end if;

  select * into strict policy_row
  from public.ai_budget_policies
  where id = p_budget_policy_id and owner_id = p_owner_id
    and effective_from <= p_requested_at
    and (effective_to is null or p_requested_at < effective_to);

  select * into strict pricing_row
  from public.model_pricing
  where id = p_pricing_id and currency = 'USD'
    and is_verified
    and effective_from <= p_requested_at
    and (effective_to is null or p_requested_at < effective_to);

  worst_cost := round(
    (p_max_input_tokens::numeric * greatest(pricing_row.input_per_million, pricing_row.cache_write_per_million) / 1000000::numeric)
    + (p_max_output_tokens::numeric * pricing_row.output_per_million / 1000000::numeric)
    + (p_max_tool_calls::numeric * pricing_row.tool_call_price),
    8
  );

  local_date := (p_requested_at at time zone policy_row.timezone)::date;
  local_month := date_trunc('month', p_requested_at at time zone policy_row.timezone);
  day_start := local_date::timestamp at time zone policy_row.timezone;
  day_end := (local_date + 1)::timestamp at time zone policy_row.timezone;
  month_start := local_month at time zone policy_row.timezone;
  month_end := (local_month + interval '1 month') at time zone policy_row.timezone;
  slot_start := to_timestamp(floor(extract(epoch from p_requested_at) / 900) * 900);

  insert into private.ai_budget_periods (
    owner_id, budget_policy_id, period_kind, period_start, period_end, hard_limit, soft_limit
  ) values (
    p_owner_id, p_budget_policy_id, 'lifetime', '1970-01-01 00:00:00+00', null, policy_row.lifetime_hard_limit, null
  ) on conflict (owner_id, period_kind, period_start) do update
    set budget_policy_id = excluded.budget_policy_id, hard_limit = excluded.hard_limit
  returning id into life_id;

  insert into private.ai_budget_periods (
    owner_id, budget_policy_id, period_kind, period_start, period_end, hard_limit, soft_limit
  ) values (
    p_owner_id, p_budget_policy_id, 'month', month_start, month_end,
    policy_row.monthly_hard_limit, policy_row.monthly_soft_limit
  ) on conflict (owner_id, period_kind, period_start) do update
    set budget_policy_id = excluded.budget_policy_id,
        hard_limit = excluded.hard_limit,
        soft_limit = excluded.soft_limit,
        period_end = excluded.period_end
  returning id into month_id;

  insert into private.ai_budget_periods (
    owner_id, budget_policy_id, period_kind, period_start, period_end, hard_limit, soft_limit
  ) values (
    p_owner_id, p_budget_policy_id, 'trading_day', day_start, day_end,
    policy_row.trading_day_hard_limit, null
  ) on conflict (owner_id, period_kind, period_start) do update
    set budget_policy_id = excluded.budget_policy_id,
        hard_limit = excluded.hard_limit,
        period_end = excluded.period_end
  returning id into day_id;

  if p_call_kind = 'luna' then
    quota_one_key := 'luna'; quota_one_kind := 'slot';
    quota_one_start := slot_start; quota_one_end := slot_start + interval '15 minutes'; quota_one_limit := 1;
  elsif p_call_kind = 'terra' then
    quota_one_key := 'terra'; quota_one_kind := 'trading_day';
    quota_one_start := day_start; quota_one_end := day_end;
    quota_one_limit := coalesce((policy_row.quota_config ->> 'terra_daily')::integer, 2);
  elsif p_call_kind = 'sol' then
    quota_one_key := 'sol'; quota_one_kind := 'trading_day';
    quota_one_start := day_start; quota_one_end := day_end;
    quota_one_limit := coalesce((policy_row.quota_config ->> 'sol_daily')::integer, 1);
  else
    quota_one_key := 'web_search'; quota_one_kind := 'trading_day';
    quota_one_start := day_start; quota_one_end := day_end;
    quota_one_limit := coalesce((policy_row.quota_config ->> 'web_daily')::integer, 2);
    quota_two_key := 'web_search'; quota_two_kind := 'month';
    quota_two_start := month_start; quota_two_end := month_end;
    quota_two_limit := coalesce((policy_row.quota_config ->> 'web_monthly')::integer, 25);
  end if;

  insert into private.ai_quota_periods (
    owner_id, budget_policy_id, quota_key, period_kind, period_start, period_end, hard_limit
  ) values (
    p_owner_id, p_budget_policy_id, quota_one_key, quota_one_kind,
    quota_one_start, quota_one_end, quota_one_limit
  ) on conflict (owner_id, quota_key, period_kind, period_start) do update
    set budget_policy_id = excluded.budget_policy_id,
        period_end = excluded.period_end,
        hard_limit = excluded.hard_limit
  returning id into quota_one_id;

  if quota_two_key is not null then
    insert into private.ai_quota_periods (
      owner_id, budget_policy_id, quota_key, period_kind, period_start, period_end, hard_limit
    ) values (
      p_owner_id, p_budget_policy_id, quota_two_key, quota_two_kind,
      quota_two_start, quota_two_end, quota_two_limit
    ) on conflict (owner_id, quota_key, period_kind, period_start) do update
      set budget_policy_id = excluded.budget_policy_id,
          period_end = excluded.period_end,
          hard_limit = excluded.hard_limit
    returning id into quota_two_id;
  end if;

  -- A deterministic lock order prevents deadlocks between concurrent call kinds.
  perform 1
  from private.ai_budget_periods
  where id in (life_id, month_id, day_id)
  order by case period_kind when 'lifetime' then 1 when 'month' then 2 else 3 end
  for update;

  perform 1
  from private.ai_quota_periods
  where id = quota_one_id or id = quota_two_id
  order by period_kind, quota_key
  for update;

  select * into existing_row
  from private.ai_budget_reservations
  where owner_id = p_owner_id and idempotency_key = p_idempotency_key
  for update;
  if found then
    if existing_row.request_hash <> p_request_hash then
      raise exception using errcode = '23505', message = 'idempotency key reused with different request';
    end if;
    return jsonb_build_object('allowed', true, 'reservation_id', existing_row.id, 'status', existing_row.status, 'idempotent', true);
  end if;

  for period_row in
    select * from private.ai_budget_periods where id in (life_id, month_id, day_id)
  loop
    if period_row.settled_amount + period_row.reserved_amount + period_row.unknown_amount + worst_cost > period_row.hard_limit then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'monetary_limit',
        'period_kind', period_row.period_kind,
        'remaining', greatest(period_row.hard_limit - period_row.settled_amount - period_row.reserved_amount - period_row.unknown_amount, 0)
      );
    end if;
  end loop;

  for quota_row in
    select * from private.ai_quota_periods where id = quota_one_id or id = quota_two_id
  loop
    if quota_row.settled_count + quota_row.reserved_count + quota_row.unknown_count + 1 > quota_row.hard_limit then
      return jsonb_build_object('allowed', false, 'reason', 'call_limit', 'quota_key', quota_row.quota_key, 'period_kind', quota_row.period_kind);
    end if;
  end loop;

  insert into private.ai_budget_reservations (
    owner_id, experiment_id, agent_run_id, budget_policy_id, pricing_id,
    daily_period_id, monthly_period_id, lifetime_period_id, idempotency_key,
    request_hash, call_kind, max_input_tokens, max_output_tokens, max_tool_calls,
    reserved_amount
  ) values (
    p_owner_id, p_experiment_id, p_agent_run_id, p_budget_policy_id, p_pricing_id,
    day_id, month_id, life_id, p_idempotency_key, p_request_hash, p_call_kind,
    p_max_input_tokens, p_max_output_tokens, p_max_tool_calls, worst_cost
  ) returning id into reservation_id;

  update private.ai_budget_periods
  set reserved_amount = reserved_amount + worst_cost
  where id in (life_id, month_id, day_id);

  update private.ai_quota_periods
  set reserved_count = reserved_count + 1
  where id = quota_one_id or id = quota_two_id;

  insert into private.ai_reservation_quotas(reservation_id, quota_period_id, owner_id)
  select reservation_id, id, p_owner_id
  from private.ai_quota_periods
  where id = quota_one_id or id = quota_two_id;

  return jsonb_build_object('allowed', true, 'reservation_id', reservation_id, 'status', 'reserved', 'reserved_amount', worst_cost, 'idempotent', false);
end;
$$;

revoke all on function private.reserve_ai_budget(uuid, uuid, uuid, uuid, uuid, text, integer, integer, integer, timestamptz, text, text) from public, anon;
grant execute on function private.reserve_ai_budget(uuid, uuid, uuid, uuid, uuid, text, integer, integer, integer, timestamptz, text, text) to service_role;

create function private.settle_ai_budget(
  p_owner_id uuid,
  p_reservation_id uuid,
  p_provider_response_id text,
  p_input_tokens integer,
  p_cached_input_tokens integer,
  p_cache_write_tokens integer,
  p_output_tokens integer,
  p_reasoning_tokens integer,
  p_tool_calls integer,
  p_web_search_calls integer,
  p_latency_ms integer,
  p_finish_state text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_row private.ai_budget_reservations%rowtype;
  pricing_row public.model_pricing%rowtype;
  actual_cost numeric(20,8);
  previous_bucket text;
  monthly_total numeric(20,8);
  monthly_limit numeric(20,8);
  lifetime_total numeric(20,8);
  lifetime_limit numeric(20,8);
  alert_threshold integer;
begin
  if auth.uid() is not null and auth.uid() <> p_owner_id then
    raise exception using errcode = '42501', message = 'owner mismatch';
  end if;
  if p_input_tokens is null or p_cached_input_tokens is null or p_cache_write_tokens is null
     or p_output_tokens is null or p_reasoning_tokens is null or p_tool_calls is null
     or p_web_search_calls is null
     or least(p_input_tokens, p_cached_input_tokens, p_cache_write_tokens, p_output_tokens, p_reasoning_tokens, p_tool_calls, p_web_search_calls) < 0
     or p_cached_input_tokens > p_input_tokens then
    raise exception using errcode = '22023', message = 'usage values must be non-negative';
  end if;

  select * into strict reservation_row
  from private.ai_budget_reservations
  where id = p_reservation_id and owner_id = p_owner_id
  for update;

  if reservation_row.status in ('settled', 'reconciled') then
    return jsonb_build_object('reservation_id', reservation_row.id, 'status', reservation_row.status, 'settled_amount', reservation_row.settled_amount, 'idempotent', true);
  end if;
  if reservation_row.status = 'released' then
    raise exception using errcode = '55000', message = 'released reservation cannot be settled';
  end if;

  select * into strict pricing_row from public.model_pricing where id = reservation_row.pricing_id;
  actual_cost := round(
    (greatest(p_input_tokens - p_cached_input_tokens, 0)::numeric * pricing_row.input_per_million / 1000000::numeric)
    + (p_cached_input_tokens::numeric * pricing_row.cached_input_per_million / 1000000::numeric)
    + (p_cache_write_tokens::numeric * pricing_row.cache_write_per_million / 1000000::numeric)
    + (p_output_tokens::numeric * pricing_row.output_per_million / 1000000::numeric)
    + (p_tool_calls::numeric * pricing_row.tool_call_price),
    8
  );

  perform 1 from private.ai_budget_periods
  where id in (reservation_row.lifetime_period_id, reservation_row.monthly_period_id, reservation_row.daily_period_id)
  order by case period_kind when 'lifetime' then 1 when 'month' then 2 else 3 end
  for update;
  perform 1 from private.ai_quota_periods q
  join private.ai_reservation_quotas rq on rq.quota_period_id = q.id
  where rq.reservation_id = reservation_row.id
  order by q.period_kind, q.quota_key
  for update of q;

  previous_bucket := reservation_row.status;
  update private.ai_budget_periods
  set reserved_amount = reserved_amount - case when previous_bucket = 'reserved' then reservation_row.reserved_amount else 0 end,
      unknown_amount = unknown_amount - case when previous_bucket = 'unknown' then reservation_row.reserved_amount else 0 end,
      settled_amount = settled_amount + actual_cost
  where id in (reservation_row.lifetime_period_id, reservation_row.monthly_period_id, reservation_row.daily_period_id);

  update private.ai_quota_periods q
  set reserved_count = reserved_count - case when previous_bucket = 'reserved' then rq.reserved_count else 0 end,
      unknown_count = unknown_count - case when previous_bucket = 'unknown' then rq.reserved_count else 0 end,
      settled_count = settled_count + rq.reserved_count
  from private.ai_reservation_quotas rq
  where rq.reservation_id = reservation_row.id and rq.quota_period_id = q.id;

  insert into private.ai_usage_events (
    reservation_id, owner_id, experiment_id, agent_run_id, provider_response_id,
    input_tokens, cached_input_tokens, cache_write_tokens, output_tokens,
    reasoning_tokens, tool_calls, web_search_calls, actual_cost, latency_ms, finish_state
  ) values (
    reservation_row.id, reservation_row.owner_id, reservation_row.experiment_id,
    reservation_row.agent_run_id, p_provider_response_id, p_input_tokens,
    p_cached_input_tokens, p_cache_write_tokens, p_output_tokens, p_reasoning_tokens,
    p_tool_calls, p_web_search_calls, actual_cost, p_latency_ms, p_finish_state
  ) on conflict (reservation_id) do nothing;

  update private.ai_budget_reservations
  set status = case when previous_bucket = 'unknown' then 'reconciled' else 'settled' end,
      settled_amount = actual_cost,
      settled_at = statement_timestamp(),
      provider_response_id = p_provider_response_id
  where id = reservation_row.id;

  select settled_amount + reserved_amount + unknown_amount, hard_limit
  into monthly_total, monthly_limit
  from private.ai_budget_periods where id = reservation_row.monthly_period_id;
  select settled_amount + reserved_amount + unknown_amount, hard_limit
  into lifetime_total, lifetime_limit
  from private.ai_budget_periods where id = reservation_row.lifetime_period_id;

  foreach alert_threshold in array array[70, 90, 100] loop
    if monthly_total >= monthly_limit * alert_threshold / 100::numeric then
      insert into public.budget_alerts(owner_id, budget_period_id, threshold_percent, amount_at_alert)
      values (reservation_row.owner_id, reservation_row.monthly_period_id, alert_threshold, monthly_total)
      on conflict (budget_period_id, threshold_percent) do nothing;
    end if;
  end loop;

  if monthly_total >= monthly_limit or lifetime_total >= lifetime_limit or actual_cost > reservation_row.reserved_amount then
    update public.experiment_controls
    set emergency_paused = true,
        agent_enabled = false,
        scheduler_enabled = false,
        pause_reason = case when actual_cost > reservation_row.reserved_amount then 'budget_actual_exceeded_reservation' else 'budget_hard_limit' end,
        state_version = state_version + 1
    where owner_id = reservation_row.owner_id and (reservation_row.experiment_id is null or experiment_id = reservation_row.experiment_id);

    update public.experiments
    set lifecycle_status = 'paused',
        pause_reason = case when actual_cost > reservation_row.reserved_amount then 'budget_actual_exceeded_reservation' else 'budget_hard_limit' end
    where owner_id = reservation_row.owner_id
      and lifecycle_status = 'active'
      and (reservation_row.experiment_id is null or id = reservation_row.experiment_id);
  end if;

  return jsonb_build_object('reservation_id', reservation_row.id, 'status', case when previous_bucket = 'unknown' then 'reconciled' else 'settled' end, 'actual_cost', actual_cost, 'idempotent', false);
end;
$$;

revoke all on function private.settle_ai_budget(uuid, uuid, text, integer, integer, integer, integer, integer, integer, integer, integer, text) from public, anon;
grant execute on function private.settle_ai_budget(uuid, uuid, text, integer, integer, integer, integer, integer, integer, integer, integer, text) to service_role;

create function private.transition_ai_reservation(
  p_owner_id uuid,
  p_reservation_id uuid,
  p_target_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_row private.ai_budget_reservations%rowtype;
begin
  if p_target_status not in ('released', 'unknown') then
    raise exception using errcode = '22023', message = 'invalid reservation transition';
  end if;
  if auth.uid() is not null and auth.uid() <> p_owner_id then
    raise exception using errcode = '42501', message = 'owner mismatch';
  end if;
  select * into strict reservation_row
  from private.ai_budget_reservations
  where id = p_reservation_id and owner_id = p_owner_id
  for update;
  if reservation_row.status = p_target_status then
    return jsonb_build_object('reservation_id', reservation_row.id, 'status', p_target_status, 'idempotent', true);
  end if;
  if reservation_row.status <> 'reserved' then
    raise exception using errcode = '55000', message = 'only a reserved reservation can transition';
  end if;

  perform 1 from private.ai_budget_periods
  where id in (reservation_row.lifetime_period_id, reservation_row.monthly_period_id, reservation_row.daily_period_id)
  order by case period_kind when 'lifetime' then 1 when 'month' then 2 else 3 end
  for update;
  perform 1 from private.ai_quota_periods q
  join private.ai_reservation_quotas rq on rq.quota_period_id = q.id
  where rq.reservation_id = reservation_row.id
  order by q.period_kind, q.quota_key
  for update of q;

  update private.ai_budget_periods
  set reserved_amount = reserved_amount - reservation_row.reserved_amount,
      unknown_amount = unknown_amount + case when p_target_status = 'unknown' then reservation_row.reserved_amount else 0 end
  where id in (reservation_row.lifetime_period_id, reservation_row.monthly_period_id, reservation_row.daily_period_id);

  update private.ai_quota_periods q
  set reserved_count = reserved_count - rq.reserved_count,
      unknown_count = unknown_count + case when p_target_status = 'unknown' then rq.reserved_count else 0 end
  from private.ai_reservation_quotas rq
  where rq.reservation_id = reservation_row.id and rq.quota_period_id = q.id;

  update private.ai_budget_reservations
  set status = p_target_status,
      settled_at = case when p_target_status = 'released' then statement_timestamp() else null end
  where id = reservation_row.id;

  return jsonb_build_object('reservation_id', reservation_row.id, 'status', p_target_status, 'idempotent', false);
end;
$$;

revoke all on function private.transition_ai_reservation(uuid, uuid, text) from public, anon;
grant execute on function private.transition_ai_reservation(uuid, uuid, text) to service_role;

create function public.reserve_ai_budget(
  p_owner_id uuid,
  p_experiment_id uuid,
  p_agent_run_id uuid,
  p_budget_policy_id uuid,
  p_pricing_id uuid,
  p_call_kind text,
  p_max_input_tokens integer,
  p_max_output_tokens integer,
  p_max_tool_calls integer,
  p_requested_at timestamptz,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.reserve_ai_budget(
    p_owner_id, p_experiment_id, p_agent_run_id, p_budget_policy_id, p_pricing_id,
    p_call_kind, p_max_input_tokens, p_max_output_tokens, p_max_tool_calls,
    p_requested_at, p_idempotency_key, p_request_hash
  );
$$;

create function public.settle_ai_budget(
  p_owner_id uuid,
  p_reservation_id uuid,
  p_provider_response_id text,
  p_input_tokens integer,
  p_cached_input_tokens integer,
  p_cache_write_tokens integer,
  p_output_tokens integer,
  p_reasoning_tokens integer,
  p_tool_calls integer,
  p_web_search_calls integer,
  p_latency_ms integer,
  p_finish_state text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.settle_ai_budget(
    p_owner_id, p_reservation_id, p_provider_response_id, p_input_tokens,
    p_cached_input_tokens, p_cache_write_tokens, p_output_tokens, p_reasoning_tokens,
    p_tool_calls, p_web_search_calls, p_latency_ms, p_finish_state
  );
$$;

create function public.transition_ai_reservation(p_owner_id uuid, p_reservation_id uuid, p_target_status text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.transition_ai_reservation(p_owner_id, p_reservation_id, p_target_status);
$$;

revoke all on function public.reserve_ai_budget(uuid, uuid, uuid, uuid, uuid, text, integer, integer, integer, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.settle_ai_budget(uuid, uuid, text, integer, integer, integer, integer, integer, integer, integer, integer, text) from public, anon, authenticated;
revoke all on function public.transition_ai_reservation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_ai_budget(uuid, uuid, uuid, uuid, uuid, text, integer, integer, integer, timestamptz, text, text) to service_role;
grant execute on function public.settle_ai_budget(uuid, uuid, text, integer, integer, integer, integer, integer, integer, integer, integer, text) to service_role;
grant execute on function public.transition_ai_reservation(uuid, uuid, text) to service_role;

commit;
