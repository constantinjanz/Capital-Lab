begin;

create or replace function private.settle_ai_budget(
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
  set reserved_count = q.reserved_count - case when previous_bucket = 'reserved' then rq.reserved_count else 0 end,
      unknown_count = q.unknown_count - case when previous_bucket = 'unknown' then rq.reserved_count else 0 end,
      settled_count = q.settled_count + rq.reserved_count
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

create or replace function private.transition_ai_reservation(
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
  set reserved_count = q.reserved_count - rq.reserved_count,
      unknown_count = q.unknown_count + case when p_target_status = 'unknown' then rq.reserved_count else 0 end
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

commit;
