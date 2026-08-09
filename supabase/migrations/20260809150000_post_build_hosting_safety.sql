begin;

-- Pricing records remain append-only, but verified records now carry enough
-- metadata to expire closed instead of silently becoming stale.
alter table public.model_pricing
  add column verified_at timestamptz,
  add column verification_expires_at timestamptz,
  add column pricing_version text,
  add column checksum text;

alter table public.model_pricing
  add constraint model_pricing_verified_metadata_check check (
    not is_verified or (
      verified_at is not null
      and verification_expires_at is not null
      and verification_expires_at > verified_at
      and pricing_version is not null
      and length(btrim(pricing_version)) > 0
      and checksum ~ '^[0-9a-f]{64}$'
    )
  );

insert into public.model_pricing (
  provider,
  model,
  pricing_mode,
  context_tier,
  input_per_million,
  cached_input_per_million,
  cache_write_per_million,
  output_per_million,
  tool_call_price,
  currency,
  source_url,
  verified_at,
  verification_expires_at,
  pricing_version,
  checksum,
  effective_from,
  is_verified
)
values
  (
    'openai', 'gpt-5.6-luna', 'tokens', 'short',
    0.20, 0.02, 0.25, 1.20, 0, 'USD',
    'https://developers.openai.com/api/docs/models/gpt-5.6-luna',
    '2026-08-09T09:30:00Z', '2026-09-08T09:30:00Z',
    'openai-2026-08-09-v1',
    'e07583b08166d4caf8dd558b5c78dc84a8074bbd30ea04726128b6a1bd9375be',
    '2026-08-09T09:30:00Z', true
  ),
  (
    'openai', 'gpt-5.6-terra', 'tokens', 'short',
    2.00, 0.20, 2.50, 12.00, 0, 'USD',
    'https://developers.openai.com/api/docs/models/gpt-5.6-terra',
    '2026-08-09T09:30:00Z', '2026-09-08T09:30:00Z',
    'openai-2026-08-09-v1',
    '359ecd53cac150625dd1a626e6edaa2caab005406a4a75a99db1b026e19df131',
    '2026-08-09T09:30:00Z', true
  ),
  (
    'openai', 'gpt-5.6-sol', 'tokens', 'short',
    5.00, 0.50, 6.25, 30.00, 0, 'USD',
    'https://developers.openai.com/api/docs/models/gpt-5.6-sol',
    '2026-08-09T09:30:00Z', '2026-09-08T09:30:00Z',
    'openai-2026-08-09-v1',
    '90bb0dff76a5ef66bcc71015808f05fc2b53ba3fa44fa6a867419ca05a120567',
    '2026-08-09T09:30:00Z', true
  )
on conflict (provider, model, pricing_mode, context_tier, effective_from)
do nothing;

alter table public.ai_budget_policies
  add column trading_day_soft_limit numeric(20,8) not null default 0.25,
  add column experiment_hard_limit numeric(20,8) not null default 30.00;

alter table public.ai_budget_policies
  alter column trading_day_hard_limit set default 0.40,
  alter column monthly_soft_limit set default 8.00,
  alter column monthly_hard_limit set default 10.00,
  alter column lifetime_hard_limit set default 50.00,
  add constraint ai_budget_policies_post_build_limits_check check (
    trading_day_soft_limit >= 0
    and trading_day_soft_limit <= trading_day_hard_limit
    and experiment_hard_limit > 0
    and monthly_hard_limit <= experiment_hard_limit
    and experiment_hard_limit <= lifetime_hard_limit
  );

create table public.budget_threshold_alerts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  experiment_id uuid,
  scope_kind text not null check (
    scope_kind in ('trading_day', 'month', 'experiment', 'lifetime')
  ),
  scope_key text not null,
  threshold_percent integer not null check (threshold_percent in (70, 90, 100)),
  used_amount numeric(20,8) not null check (used_amount >= 0),
  limit_amount numeric(20,8) not null check (limit_amount > 0),
  emitted_at timestamptz not null default statement_timestamp(),
  acknowledged_at timestamptz,
  foreign key (experiment_id, owner_id)
    references public.experiments(id, owner_id) on delete restrict,
  unique (owner_id, scope_kind, scope_key, threshold_percent),
  unique (id, owner_id)
);

create index budget_threshold_alerts_owner_idx
on public.budget_threshold_alerts(owner_id, emitted_at desc);

alter table public.budget_threshold_alerts enable row level security;
alter table public.budget_threshold_alerts force row level security;
create policy owner_read on public.budget_threshold_alerts
for select to authenticated
using (owner_id = (select auth.uid()) and private.current_user_is_owner());
revoke all on table public.budget_threshold_alerts from public, anon, authenticated;
grant select on table public.budget_threshold_alerts to authenticated;
grant all on table public.budget_threshold_alerts to service_role;

create function private.validate_ai_budget_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pricing_row public.model_pricing%rowtype;
  experiment_limit numeric(20,8);
  experiment_used numeric(20,8);
begin
  select pricing.*
  into strict pricing_row
  from public.model_pricing as pricing
  where pricing.id = new.pricing_id
  for share;

  if pricing_row.provider <> 'openai'
    or pricing_row.model not in ('gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol')
    or not pricing_row.is_verified
    or pricing_row.verified_at is null
    or pricing_row.verification_expires_at is null
    or pricing_row.verification_expires_at <= new.reserved_at
    or pricing_row.pricing_version is null
    or pricing_row.checksum is null
  then
    raise exception using
      errcode = '55000',
      message = 'verified current model pricing is unavailable';
  end if;

  if new.experiment_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(new.owner_id::text || ':' || new.experiment_id::text || ':experiment-budget', 0)
    );

    select policy.experiment_hard_limit
    into strict experiment_limit
    from public.ai_budget_policies as policy
    where policy.id = new.budget_policy_id
      and policy.owner_id = new.owner_id;

    select coalesce(sum(
      case
        when reservation.status = 'released' then 0
        when reservation.status in ('settled', 'reconciled')
          then coalesce(reservation.settled_amount, reservation.reserved_amount)
        else reservation.reserved_amount
      end
    ), 0)
    into experiment_used
    from private.ai_budget_reservations as reservation
    where reservation.owner_id = new.owner_id
      and reservation.experiment_id = new.experiment_id;

    if experiment_used + new.reserved_amount > experiment_limit then
      raise exception using
        errcode = '22003',
        message = 'experiment AI budget hard limit exceeded';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_ai_budget_reservation()
from public, anon, authenticated;
grant execute on function private.validate_ai_budget_reservation()
to service_role;

create trigger ai_budget_reservations_validate_current_pricing
before insert on private.ai_budget_reservations
for each row execute function private.validate_ai_budget_reservation();

create function private.refresh_budget_threshold_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  policy_row public.ai_budget_policies%rowtype;
  day_key text := to_char(new.reserved_at at time zone 'America/New_York', 'YYYY-MM-DD');
  month_key text := to_char(new.reserved_at at time zone 'America/New_York', 'YYYY-MM');
  used_amount numeric(20,8);
  limit_amount numeric(20,8);
  threshold integer;
  scope_name text;
  scope_value text;
begin
  select policy.*
  into strict policy_row
  from public.ai_budget_policies as policy
  where policy.id = new.budget_policy_id
    and policy.owner_id = new.owner_id;

  foreach scope_name in array array['trading_day', 'month', 'experiment', 'lifetime']
  loop
    if scope_name = 'experiment' and new.experiment_id is null then
      continue;
    end if;

    scope_value := case scope_name
      when 'trading_day' then day_key
      when 'month' then month_key
      when 'experiment' then new.experiment_id::text
      else 'lifetime'
    end;
    limit_amount := case scope_name
      when 'trading_day' then policy_row.trading_day_hard_limit
      when 'month' then policy_row.monthly_hard_limit
      when 'experiment' then policy_row.experiment_hard_limit
      else policy_row.lifetime_hard_limit
    end;

    select coalesce(sum(
      case
        when reservation.status = 'released' then 0
        when reservation.status in ('settled', 'reconciled')
          then coalesce(reservation.settled_amount, reservation.reserved_amount)
        else reservation.reserved_amount
      end
    ), 0)
    into used_amount
    from private.ai_budget_reservations as reservation
    where reservation.owner_id = new.owner_id
      and case scope_name
        when 'trading_day' then
          to_char(reservation.reserved_at at time zone 'America/New_York', 'YYYY-MM-DD') = day_key
        when 'month' then
          to_char(reservation.reserved_at at time zone 'America/New_York', 'YYYY-MM') = month_key
        when 'experiment' then reservation.experiment_id = new.experiment_id
        else true
      end;

    foreach threshold in array array[70, 90, 100]
    loop
      if used_amount * 100 >= limit_amount * threshold then
        insert into public.budget_threshold_alerts (
          owner_id,
          experiment_id,
          scope_kind,
          scope_key,
          threshold_percent,
          used_amount,
          limit_amount
        ) values (
          new.owner_id,
          case when scope_name = 'experiment' then new.experiment_id else null end,
          scope_name,
          scope_value,
          threshold,
          used_amount,
          limit_amount
        ) on conflict (owner_id, scope_kind, scope_key, threshold_percent)
        do nothing;
      end if;
    end loop;
  end loop;

  return new;
end;
$$;

revoke all on function private.refresh_budget_threshold_alerts()
from public, anon, authenticated;
grant execute on function private.refresh_budget_threshold_alerts()
to service_role;

create trigger ai_budget_reservations_refresh_threshold_alerts
after insert or update on private.ai_budget_reservations
for each row execute function private.refresh_budget_threshold_alerts();

-- Scheduler recovery metadata is additive so historical manual-cycle evidence
-- remains valid.
alter table private.scheduler_slots
  drop constraint if exists scheduler_slots_status_check;
alter table private.scheduler_slots
  add constraint scheduler_slots_status_check check (
    status in (
      'pending', 'running', 'succeeded', 'completed', 'failed', 'skipped',
      'timed_out', 'unknown'
    )
  ),
  add column session_date date,
  add column slot_number smallint,
  add column lease_owner uuid,
  add column heartbeat_at timestamptz,
  add column max_attempts integer not null default 2 check (max_attempts between 1 and 5),
  add constraint scheduler_slots_cycle_identity_fields_check check (
    (session_date is null and slot_number is null)
    or (session_date is not null and slot_number between 0 and 95)
  );

create unique index scheduler_slots_cycle_identity_idx
on private.scheduler_slots(experiment_id, session_date, slot_number, job_type)
where experiment_id is not null and session_date is not null and slot_number is not null;

create index scheduler_slots_recovery_idx
on private.scheduler_slots(status, lease_until, heartbeat_at)
where status in ('pending', 'running', 'unknown');

alter table private.scheduler_runs
  drop constraint if exists scheduler_runs_status_check;
alter table private.scheduler_runs
  add constraint scheduler_runs_status_check check (
    status in (
      'pending', 'running', 'succeeded', 'completed', 'failed', 'skipped',
      'duplicate', 'timed_out', 'unknown'
    )
  ),
  add column heartbeat_at timestamptz,
  add column deadline_at timestamptz,
  add column attempt_number integer not null default 1 check (attempt_number between 1 and 5);

create table private.scheduler_reconciliation_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  experiment_id uuid,
  slot_key text not null references private.scheduler_slots(slot_key) on delete restrict,
  from_status text not null,
  to_status text not null check (to_status in ('timed_out', 'unknown', 'failed', 'skipped')),
  reason_code text not null,
  correlation_id uuid not null,
  occurred_at timestamptz not null default statement_timestamp(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  foreign key (experiment_id, owner_id)
    references public.experiments(id, owner_id) on delete restrict,
  unique (slot_key, from_status, to_status, reason_code),
  unique (id, owner_id)
);

create index scheduler_reconciliation_events_owner_idx
on private.scheduler_reconciliation_events(owner_id, occurred_at desc);

alter table private.scheduler_reconciliation_events enable row level security;
alter table private.scheduler_reconciliation_events force row level security;
create policy owner_read on private.scheduler_reconciliation_events
for select to authenticated
using (owner_id = (select auth.uid()) and private.current_user_is_owner());
revoke all on table private.scheduler_reconciliation_events
from public, anon, authenticated;
grant select on table private.scheduler_reconciliation_events to authenticated;
grant all on table private.scheduler_reconciliation_events to service_role;

-- A local-only paid Canary lock. It contains no prompt, API key, or provider
-- secret, and does not touch an experiment, portfolio, order, or fill.
create table private.paid_canary_runs (
  operation_id uuid primary key,
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  status text not null default 'claimed' check (
    status in ('claimed', 'completed', 'stopped', 'unknown')
  ),
  created_at timestamptz not null default statement_timestamp(),
  finished_at timestamptz,
  result jsonb,
  unique (operation_id, owner_id),
  check (finished_at is null or finished_at >= created_at)
);

alter table private.paid_canary_runs enable row level security;
alter table private.paid_canary_runs force row level security;
revoke all on table private.paid_canary_runs from public, anon, authenticated;
grant all on table private.paid_canary_runs to service_role;

create function private.claim_paid_canary(
  p_owner_id uuid,
  p_operation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.app_users as app_user
    where app_user.user_id = p_owner_id
      and app_user.role = 'owner'
      and app_user.is_active
  ) then
    raise exception using errcode = '42501', message = 'paid Canary owner is unavailable';
  end if;

  insert into private.paid_canary_runs(operation_id, owner_id)
  values (p_operation_id, p_owner_id)
  on conflict (operation_id) do nothing;
  return found;
end;
$$;

create function public.claim_paid_canary(
  p_owner_id uuid,
  p_operation_id uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.claim_paid_canary(p_owner_id, p_operation_id);
$$;

create function private.paid_canary_context(p_requested_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  policy_id uuid;
  pricing_ids jsonb;
begin
  if p_requested_at is null
    or p_requested_at > statement_timestamp() + interval '1 minute'
    or p_requested_at < statement_timestamp() - interval '5 minutes'
  then
    raise exception using errcode = '22023', message = 'paid Canary timestamp is invalid';
  end if;

  select app_user.user_id
  into strict owner_id
  from public.app_users as app_user
  where app_user.role = 'owner' and app_user.is_active;

  select policy.id
  into strict policy_id
  from public.ai_budget_policies as policy
  where policy.owner_id = owner_id
    and policy.effective_from <= p_requested_at
    and (policy.effective_to is null or p_requested_at < policy.effective_to)
  order by policy.effective_from desc
  limit 1;

  select jsonb_object_agg(pricing.model, pricing.id)
  into pricing_ids
  from public.model_pricing as pricing
  where pricing.provider = 'openai'
    and pricing.model in ('gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol')
    and pricing.pricing_mode = 'tokens'
    and pricing.context_tier = 'short'
    and pricing.currency = 'USD'
    and pricing.is_verified
    and pricing.verified_at is not null
    and pricing.verification_expires_at > p_requested_at
    and pricing.effective_from <= p_requested_at
    and (pricing.effective_to is null or p_requested_at < pricing.effective_to);

  if jsonb_object_length(coalesce(pricing_ids, '{}'::jsonb)) <> 3 then
    raise exception using
      errcode = '55000',
      message = 'paid Canary requires three current verified exact model prices';
  end if;

  return jsonb_build_object(
    'owner_id', owner_id,
    'budget_policy_id', policy_id,
    'pricing_ids', pricing_ids
  );
end;
$$;

create function public.paid_canary_context(p_requested_at timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.paid_canary_context(p_requested_at);
$$;

revoke all on function private.claim_paid_canary(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.claim_paid_canary(uuid, uuid)
from public, anon, authenticated;
revoke all on function private.paid_canary_context(timestamptz)
from public, anon, authenticated;
revoke all on function public.paid_canary_context(timestamptz)
from public, anon, authenticated;
grant execute on function private.claim_paid_canary(uuid, uuid) to service_role;
grant execute on function public.claim_paid_canary(uuid, uuid) to service_role;
grant execute on function private.paid_canary_context(timestamptz) to service_role;
grant execute on function public.paid_canary_context(timestamptz) to service_role;

-- Shadow challenger evidence is paired and immutable. No automatic promotion
-- field exists, and Sol decisions are prohibited from originating orders.
create table public.model_comparisons (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null unique,
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  experiment_id uuid not null,
  event_id uuid references public.news_events(id) on delete restrict,
  context_snapshot_id uuid not null,
  terra_decision_id uuid not null,
  sol_decision_id uuid not null,
  prompt_version_id uuid not null,
  call_order text not null check (call_order in ('terra_first', 'sol_first', 'parallel')),
  terra_cost numeric(20,8) not null check (terra_cost >= 0),
  sol_cost numeric(20,8) not null check (sol_cost >= 0),
  terra_latency_ms integer not null check (terra_latency_ms >= 0),
  sol_latency_ms integer not null check (sol_latency_ms >= 0),
  standardized_risk numeric(24,12) not null check (standardized_risk > 0),
  decision_summary jsonb not null check (jsonb_typeof(decision_summary) = 'object'),
  outcome_15m jsonb,
  outcome_1h jsonb,
  outcome_eod jsonb,
  outcome_1d jsonb,
  outcome_5d jsonb,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (experiment_id, owner_id)
    references public.experiments(id, owner_id) on delete restrict,
  foreign key (context_snapshot_id, owner_id)
    references public.decision_context_snapshots(id, owner_id) on delete restrict,
  foreign key (terra_decision_id, owner_id)
    references public.agent_decisions(id, owner_id) on delete restrict,
  foreign key (sol_decision_id, owner_id)
    references public.agent_decisions(id, owner_id) on delete restrict,
  foreign key (prompt_version_id, owner_id)
    references public.prompt_versions(id, owner_id) on delete restrict,
  unique (terra_decision_id, sol_decision_id),
  unique (id, owner_id)
);

create index model_comparisons_owner_idx
on public.model_comparisons(owner_id, created_at desc);
create index model_comparisons_experiment_idx
on public.model_comparisons(experiment_id, created_at desc);

alter table public.model_comparisons enable row level security;
alter table public.model_comparisons force row level security;
create policy owner_read on public.model_comparisons
for select to authenticated
using (owner_id = (select auth.uid()) and private.current_user_is_owner());
revoke all on table public.model_comparisons from public, anon, authenticated;
grant select on table public.model_comparisons to authenticated;
grant all on table public.model_comparisons to service_role;

create trigger model_comparisons_reject_mutation
before update or delete on public.model_comparisons
for each row execute function private.reject_mutation();

create function private.reject_sol_originated_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.agent_decision_id is not null and exists (
    select 1
    from public.agent_decisions as decision
    join public.agent_runs as run
      on run.id = decision.agent_run_id
     and run.owner_id = decision.owner_id
    where decision.id = new.agent_decision_id
      and decision.owner_id = new.owner_id
      and run.role = 'sol'
  ) then
    raise exception using
      errcode = '42501',
      message = 'Sol shadow decisions cannot originate paper orders';
  end if;
  return new;
end;
$$;

revoke all on function private.reject_sol_originated_order()
from public, anon, authenticated;
grant execute on function private.reject_sol_originated_order() to service_role;

create trigger orders_reject_sol_origin
before insert on public.orders
for each row execute function private.reject_sol_originated_order();

-- Free-plan storage monitoring and audited cleanup of regenerable raw payloads.
create table public.storage_monitor_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  captured_on date not null,
  captured_at timestamptz not null default statement_timestamp(),
  database_bytes numeric(20,0) not null check (database_bytes >= 0),
  limit_bytes numeric(20,0) not null check (limit_bytes > 0),
  utilization_percent numeric(9,4) not null check (utilization_percent >= 0),
  threshold_state text not null check (
    threshold_state in ('normal', 'warning_60', 'archive_75', 'block_raw_85', 'pause_90')
  ),
  largest_relations jsonb not null check (jsonb_typeof(largest_relations) = 'array'),
  unique (owner_id, captured_on),
  unique (id, owner_id)
);

create index storage_monitor_snapshots_owner_idx
on public.storage_monitor_snapshots(owner_id, captured_on desc);

alter table public.storage_monitor_snapshots enable row level security;
alter table public.storage_monitor_snapshots force row level security;
create policy owner_read on public.storage_monitor_snapshots
for select to authenticated
using (owner_id = (select auth.uid()) and private.current_user_is_owner());
revoke all on table public.storage_monitor_snapshots from public, anon, authenticated;
grant select on table public.storage_monitor_snapshots to authenticated;
grant all on table public.storage_monitor_snapshots to service_role;

create table private.retention_cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  operation_id uuid not null,
  payloads_compacted integer not null check (payloads_compacted >= 0),
  status text not null check (status in ('completed', 'failed')),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  unique (owner_id, operation_id),
  unique (id, owner_id),
  check (finished_at >= started_at)
);

alter table private.retention_cleanup_runs enable row level security;
alter table private.retention_cleanup_runs force row level security;
create policy owner_read on private.retention_cleanup_runs
for select to authenticated
using (owner_id = (select auth.uid()) and private.current_user_is_owner());
revoke all on table private.retention_cleanup_runs from public, anon, authenticated;
grant select on table private.retention_cleanup_runs to authenticated;
grant all on table private.retention_cleanup_runs to service_role;

insert into private.application_settings (owner_id, setting_key, value, is_secret)
select app_user.user_id, setting.setting_key, setting.value, false
from public.app_users as app_user
cross join lateral (
  values
    ('agent_enabled', 'false'::jsonb),
    ('autonomous_paper_execution_enabled', 'false'::jsonb),
    ('paid_model_calls_enabled', 'false'::jsonb),
    ('openai_canary_enabled', 'false'::jsonb),
    ('openai_web_search_enabled', 'false'::jsonb),
    ('sol_challenger_enabled', 'false'::jsonb),
    ('sol_live_execution_enabled', 'false'::jsonb),
    ('real_broker_enabled', 'false'::jsonb),
    ('scheduler_enabled', 'false'::jsonb),
    ('scheduler_provider', '"supabase"'::jsonb),
    ('nonessential_raw_ingest_enabled', 'true'::jsonb)
) as setting(setting_key, value)
where app_user.role = 'owner'
on conflict (owner_id, setting_key) do nothing;

create function private.capture_storage_monitor_snapshot(
  p_owner_id uuid,
  p_limit_bytes numeric default 524288000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  database_size numeric(20,0);
  utilization numeric(9,4);
  threshold_name text;
  relation_sizes jsonb;
begin
  if p_limit_bytes <= 0 or not exists (
    select 1 from public.app_users as app_user
    where app_user.user_id = p_owner_id
      and app_user.role = 'owner'
      and app_user.is_active
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
    else 'normal'
  end;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'schema', relation.schema_name,
      'relation', relation.relation_name,
      'total_bytes', relation.total_bytes::text
    ) order by relation.total_bytes desc
  ), '[]'::jsonb)
  into relation_sizes
  from (
    select
      namespace.nspname as schema_name,
      class.relname as relation_name,
      pg_total_relation_size(class.oid) as total_bytes
    from pg_class as class
    join pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname in ('public', 'private')
      and class.relkind in ('r', 'p', 'i')
    order by pg_total_relation_size(class.oid) desc
    limit 15
  ) as relation;

  insert into public.storage_monitor_snapshots (
    owner_id,
    captured_on,
    database_bytes,
    limit_bytes,
    utilization_percent,
    threshold_state,
    largest_relations
  ) values (
    p_owner_id,
    (statement_timestamp() at time zone 'UTC')::date,
    database_size,
    p_limit_bytes,
    utilization,
    threshold_name,
    relation_sizes
  ) on conflict (owner_id, captured_on) do update
  set captured_at = excluded.captured_at,
      database_bytes = excluded.database_bytes,
      limit_bytes = excluded.limit_bytes,
      utilization_percent = excluded.utilization_percent,
      threshold_state = excluded.threshold_state,
      largest_relations = excluded.largest_relations;

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
    set agent_enabled = false,
        scheduler_enabled = false,
        emergency_paused = true,
        pause_reason = 'database_storage_90_percent',
        state_version = state_version + 1
    where owner_id = p_owner_id
      and (agent_enabled or scheduler_enabled or not emergency_paused);

    insert into private.application_settings (owner_id, setting_key, value, is_secret)
    values (p_owner_id, 'scheduler_enabled', 'false'::jsonb, false)
    on conflict (owner_id, setting_key) do update
    set value = excluded.value,
        version = private.application_settings.version + 1;
  end if;

  return jsonb_build_object(
    'database_bytes', database_size::text,
    'limit_bytes', p_limit_bytes::text,
    'utilization_percent', utilization::text,
    'threshold_state', threshold_name,
    'largest_relations', relation_sizes
  );
end;
$$;

create function private.reject_raw_ingest_when_blocked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from private.application_settings as setting
    where setting.owner_id = new.owner_id
      and setting.setting_key = 'nonessential_raw_ingest_enabled'
      and setting.value = 'false'::jsonb
  ) then
    raise exception using
      errcode = '55000',
      message = 'nonessential raw ingestion is paused by storage guard';
  end if;
  return new;
end;
$$;

create trigger raw_source_events_storage_guard
before insert on private.raw_source_events
for each row execute function private.reject_raw_ingest_when_blocked();

create function private.compact_regenerable_raw_payloads(
  p_owner_id uuid,
  p_operation_id uuid,
  p_batch_size integer default 250
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  started timestamptz := statement_timestamp();
  compacted integer;
begin
  if p_batch_size < 1 or p_batch_size > 1000 then
    raise exception using errcode = '22023', message = 'cleanup batch size is invalid';
  end if;

  if exists (
    select 1 from private.retention_cleanup_runs as run
    where run.owner_id = p_owner_id and run.operation_id = p_operation_id
  ) then
    select run.payloads_compacted
    into compacted
    from private.retention_cleanup_runs as run
    where run.owner_id = p_owner_id and run.operation_id = p_operation_id;
    return jsonb_build_object('status', 'completed', 'compacted', compacted, 'idempotent', true);
  end if;

  with candidates as (
    select raw_event.id
    from private.raw_source_events as raw_event
    join lateral (
      select policy.retention_days
      from public.source_policies as policy
      where policy.source_id = raw_event.source_id
        and policy.retention_days is not null
        and policy.effective_from <= statement_timestamp()
        and (policy.effective_to is null or statement_timestamp() < policy.effective_to)
      order by policy.effective_from desc
      limit 1
    ) as policy on true
    where raw_event.owner_id = p_owner_id
      and raw_event.normalized_payload is not null
      and raw_event.storage_path is not null
      and raw_event.ingested_at < statement_timestamp() - make_interval(days => policy.retention_days)
    order by raw_event.ingested_at, raw_event.id
    for update of raw_event skip locked
    limit p_batch_size
  ), compacted_rows as (
    update private.raw_source_events as raw_event
    set normalized_payload = null
    from candidates
    where raw_event.id = candidates.id
    returning raw_event.id
  )
  select count(*)::integer into compacted from compacted_rows;

  insert into private.retention_cleanup_runs (
    owner_id,
    operation_id,
    payloads_compacted,
    status,
    started_at,
    finished_at,
    metadata
  ) values (
    p_owner_id,
    p_operation_id,
    compacted,
    'completed',
    started,
    statement_timestamp(),
    jsonb_build_object('batch_size', p_batch_size, 'metadata_preserved', true)
  );

  return jsonb_build_object('status', 'completed', 'compacted', compacted, 'idempotent', false);
end;
$$;

revoke all on function private.capture_storage_monitor_snapshot(uuid, numeric)
from public, anon, authenticated;
revoke all on function private.reject_raw_ingest_when_blocked()
from public, anon, authenticated;
revoke all on function private.compact_regenerable_raw_payloads(uuid, uuid, integer)
from public, anon, authenticated;
grant execute on function private.capture_storage_monitor_snapshot(uuid, numeric)
to service_role;
grant execute on function private.reject_raw_ingest_when_blocked()
to service_role;
grant execute on function private.compact_regenerable_raw_payloads(uuid, uuid, integer)
to service_role;

create function public.hosted_storage_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  latest public.storage_monitor_snapshots%rowtype;
  seven_day numeric;
  thirty_day numeric;
  daily_growth numeric;
  cleanup private.retention_cleanup_runs%rowtype;
begin
  if owner_id is null or not private.current_user_is_owner() then
    raise exception using errcode = '42501', message = 'owner storage status is unavailable';
  end if;

  select snapshot.*
  into latest
  from public.storage_monitor_snapshots as snapshot
  where snapshot.owner_id = owner_id
  order by snapshot.captured_on desc
  limit 1;

  if latest.id is null then
    return jsonb_build_object('available', false, 'reason', 'snapshot_not_captured');
  end if;

  select latest.database_bytes - snapshot.database_bytes
  into seven_day
  from public.storage_monitor_snapshots as snapshot
  where snapshot.owner_id = owner_id
    and snapshot.captured_on <= latest.captured_on - 7
  order by snapshot.captured_on desc
  limit 1;

  select latest.database_bytes - snapshot.database_bytes
  into thirty_day
  from public.storage_monitor_snapshots as snapshot
  where snapshot.owner_id = owner_id
    and snapshot.captured_on <= latest.captured_on - 30
  order by snapshot.captured_on desc
  limit 1;

  select run.*
  into cleanup
  from private.retention_cleanup_runs as run
  where run.owner_id = owner_id
  order by run.finished_at desc
  limit 1;

  daily_growth := case
    when coalesce(thirty_day, 0) > 0 then thirty_day / 30
    when coalesce(seven_day, 0) > 0 then seven_day / 7
    else 0
  end;

  return jsonb_build_object(
    'available', true,
    'captured_at', latest.captured_at,
    'database_bytes', latest.database_bytes::text,
    'limit_bytes', latest.limit_bytes::text,
    'utilization_percent', latest.utilization_percent::text,
    'threshold_state', latest.threshold_state,
    'largest_relations', latest.largest_relations,
    'growth_7_bytes', coalesce(seven_day, 0)::text,
    'growth_30_bytes', coalesce(thirty_day, 0)::text,
    'forecast_days', jsonb_build_object(
      'warning_60', case when daily_growth > 0 then greatest(ceil((latest.limit_bytes * 0.60 - latest.database_bytes) / daily_growth), 0)::text else null end,
      'archive_75', case when daily_growth > 0 then greatest(ceil((latest.limit_bytes * 0.75 - latest.database_bytes) / daily_growth), 0)::text else null end,
      'block_raw_85', case when daily_growth > 0 then greatest(ceil((latest.limit_bytes * 0.85 - latest.database_bytes) / daily_growth), 0)::text else null end,
      'pause_90', case when daily_growth > 0 then greatest(ceil((latest.limit_bytes * 0.90 - latest.database_bytes) / daily_growth), 0)::text else null end
    ),
    'last_cleanup_at', cleanup.finished_at,
    'last_cleanup_count', coalesce(cleanup.payloads_compacted, 0)
  );
end;
$$;

revoke all on function public.hosted_storage_status()
from public, anon, authenticated;
grant execute on function public.hosted_storage_status() to authenticated;

create function public.hosted_budget_threshold_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  policy_row public.ai_budget_policies%rowtype;
  alerts jsonb;
begin
  if owner_id is null or not private.current_user_is_owner() then
    raise exception using errcode = '42501', message = 'owner budget status is unavailable';
  end if;

  select policy.*
  into policy_row
  from public.ai_budget_policies as policy
  where policy.owner_id = owner_id
    and policy.effective_from <= statement_timestamp()
    and (policy.effective_to is null or statement_timestamp() < policy.effective_to)
  order by policy.effective_from desc
  limit 1;

  if policy_row.id is null then
    return jsonb_build_object('available', false, 'reason', 'budget_policy_unavailable');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'scope_kind', alert.scope_kind,
      'scope_key', alert.scope_key,
      'threshold_percent', alert.threshold_percent,
      'used_amount', alert.used_amount::text,
      'limit_amount', alert.limit_amount::text,
      'emitted_at', alert.emitted_at,
      'acknowledged_at', alert.acknowledged_at
    ) order by alert.emitted_at desc
  ), '[]'::jsonb)
  into alerts
  from (
    select threshold.*
    from public.budget_threshold_alerts as threshold
    where threshold.owner_id = owner_id
    order by threshold.emitted_at desc
    limit 50
  ) as alert;

  return jsonb_build_object(
    'available', true,
    'policy_id', policy_row.id,
    'trading_day_soft_limit', policy_row.trading_day_soft_limit::text,
    'trading_day_hard_limit', policy_row.trading_day_hard_limit::text,
    'monthly_soft_limit', policy_row.monthly_soft_limit::text,
    'monthly_hard_limit', policy_row.monthly_hard_limit::text,
    'experiment_hard_limit', policy_row.experiment_hard_limit::text,
    'lifetime_hard_limit', policy_row.lifetime_hard_limit::text,
    'alerts', alerts
  );
end;
$$;

revoke all on function public.hosted_budget_threshold_status()
from public, anon, authenticated;
grant execute on function public.hosted_budget_threshold_status() to authenticated;

-- The only remote scheduler authority. This v1 contract intentionally records
-- no-AI shadow slots only; it cannot reach the agent, order, fill, or ledger
-- writers. A later reviewed migration is required for any broader behavior.
create function private.run_hosted_scheduler_request(
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
  owner_row record;
  experiment_row record;
  stale_row private.scheduler_slots%rowtype;
  slot_at timestamptz;
  slot_no smallint;
  slot_identifier text;
  claimed integer := 0;
  reconciled integer := 0;
  inserted_rows integer;
begin
  if p_job not in ('market_dispatcher', 'reconciler')
    or p_correlation_id is null
    or p_cycle_id is null
    or p_requested_at is null
    or p_requested_at > statement_timestamp() + interval '1 minute'
    or p_requested_at < statement_timestamp() - interval '5 minutes'
  then
    raise exception using errcode = '22023', message = 'scheduler request is invalid';
  end if;

  for owner_row in
    select app_user.user_id as owner_id
    from public.app_users as app_user
    where app_user.role = 'owner'
      and app_user.is_active
      and exists (
        select 1 from private.application_settings as setting
        where setting.owner_id = app_user.user_id
          and setting.setting_key = 'scheduler_provider'
          and setting.value = '"supabase"'::jsonb
      )
      and exists (
        select 1 from private.application_settings as setting
        where setting.owner_id = app_user.user_id
          and setting.setting_key = 'scheduler_enabled'
          and setting.value = 'true'::jsonb
      )
      and not exists (
        select 1 from private.application_settings as setting
        where setting.owner_id = app_user.user_id
          and setting.setting_key in (
            'agent_enabled', 'autonomous_paper_execution_enabled',
            'paid_model_calls_enabled', 'openai_canary_enabled',
            'openai_web_search_enabled', 'sol_challenger_enabled',
            'sol_live_execution_enabled', 'real_broker_enabled'
          )
          and setting.value <> 'false'::jsonb
      )
  loop
    if p_job = 'reconciler' then
      for stale_row in
        select slot.*
        from private.scheduler_slots as slot
        where slot.owner_id = owner_row.owner_id
          and slot.status in ('pending', 'running', 'unknown')
          and slot.lease_until < p_requested_at
        order by slot.lease_until, slot.slot_key
        for update skip locked
      loop
        update private.scheduler_slots
        set status = 'timed_out',
            heartbeat_at = p_requested_at,
            result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
              'reason', 'lease_expired_without_terminal_evidence',
              'model_calls', 0,
              'paper_orders_created', 0,
              'paper_fills_created', 0,
              'ledger_entries_created', 0
            )
        where slot_key = stale_row.slot_key;

        update private.scheduler_runs
        set status = 'timed_out',
            finished_at = p_requested_at,
            error_class = 'LeaseExpired',
            retry_eligible = false,
            heartbeat_at = p_requested_at
        where slot_key = stale_row.slot_key
          and status in ('pending', 'running', 'unknown');

        insert into private.scheduler_reconciliation_events (
          owner_id,
          experiment_id,
          slot_key,
          from_status,
          to_status,
          reason_code,
          correlation_id,
          metadata
        ) values (
          stale_row.owner_id,
          stale_row.experiment_id,
          stale_row.slot_key,
          stale_row.status,
          'timed_out',
          'lease_expired_without_terminal_evidence',
          p_correlation_id,
          jsonb_build_object(
            'cycle_id', p_cycle_id,
            'attempt_count', stale_row.attempt_count,
            'retry_performed', false,
            'model_calls', 0
          )
        ) on conflict (slot_key, from_status, to_status, reason_code) do nothing;
        reconciled := reconciled + 1;
      end loop;

      perform private.capture_storage_monitor_snapshot(owner_row.owner_id, 524288000);
    else
      for experiment_row in
        select
          experiment.id as experiment_id,
          experiment.owner_id,
          session.session_date,
          session.id as exchange_session_id
        from public.experiments as experiment
        join public.experiment_controls as controls
          on controls.experiment_id = experiment.id
         and controls.owner_id = experiment.owner_id
        join public.experiment_versions as version
          on version.id = experiment.locked_version_id
         and version.experiment_id = experiment.id
         and version.owner_id = experiment.owner_id
        join public.market_sessions as session
          on session.calendar_manifest_id = version.market_calendar_manifest_id
         and session.session_date = (p_requested_at at time zone 'America/New_York')::date
         and session.available_at <= p_requested_at
        join public.exchanges as exchange
          on exchange.id = session.exchange_id
         and exchange.mic = 'XNAS'
        where experiment.owner_id = owner_row.owner_id
          and experiment.lifecycle_status = 'active'
          and experiment.execution_mode = 'shadow'
          and controls.scheduler_enabled
          and not controls.agent_enabled
          and not controls.emergency_paused
          and session.session_type in ('regular', 'early_close')
          and p_requested_at >= session.opens_at
          and p_requested_at < session.closes_at
        order by experiment.id
      loop
        slot_at := date_trunc('hour', p_requested_at)
          + make_interval(mins => (extract(minute from p_requested_at)::integer / 15) * 15);
        slot_no := (
          extract(hour from slot_at at time zone 'UTC')::integer * 4
          + extract(minute from slot_at at time zone 'UTC')::integer / 15
        )::smallint;
        slot_identifier := 'no-ai-shadow:' || experiment_row.experiment_id::text
          || ':' || experiment_row.session_date::text || ':' || slot_no::text;

        perform pg_advisory_xact_lock(hashtextextended(slot_identifier, 0));
        insert into private.scheduler_slots (
          slot_key,
          owner_id,
          experiment_id,
          job_type,
          scheduler_provider,
          exchange_session_id,
          slot_at,
          lease_until,
          attempt_count,
          status,
          result,
          session_date,
          slot_number,
          lease_owner,
          heartbeat_at,
          max_attempts
        ) values (
          slot_identifier,
          experiment_row.owner_id,
          experiment_row.experiment_id,
          'hosted_no_ai_shadow',
          'supabase',
          experiment_row.exchange_session_id,
          slot_at,
          p_requested_at + interval '120 seconds',
          1,
          'running',
          null,
          experiment_row.session_date,
          slot_no,
          p_cycle_id,
          p_requested_at,
          2
        ) on conflict do nothing;
        get diagnostics inserted_rows = row_count;

        if inserted_rows = 1 then
          insert into private.scheduler_runs (
            slot_key,
            owner_id,
            experiment_id,
            correlation_id,
            status,
            started_at,
            finished_at,
            skipped_reason,
            retry_eligible,
            metadata,
            heartbeat_at,
            deadline_at,
            attempt_number
          ) values (
            slot_identifier,
            experiment_row.owner_id,
            experiment_row.experiment_id,
            p_correlation_id,
            'skipped',
            p_requested_at,
            p_requested_at,
            'no_ai_shadow_dry_run',
            false,
            jsonb_build_object(
              'cycle_id', p_cycle_id,
              'paper_only', true,
              'agent_enabled', false,
              'provider_request_made', false,
              'model_calls', 0,
              'paper_orders_created', 0,
              'paper_fills_created', 0,
              'ledger_entries_created', 0
            ),
            p_requested_at,
            p_requested_at + interval '110 seconds',
            1
          );

          update private.scheduler_slots
          set status = 'skipped',
              heartbeat_at = p_requested_at,
              result = jsonb_build_object(
                'status', 'skipped',
                'reason', 'no_ai_shadow_dry_run',
                'cycle_id', p_cycle_id,
                'model_calls', 0,
                'paper_orders_created', 0,
                'paper_fills_created', 0,
                'ledger_entries_created', 0
              )
          where slot_key = slot_identifier;
          claimed := claimed + 1;
        end if;
      end loop;
    end if;
  end loop;

  return jsonb_build_object(
    'status', case when claimed > 0 or reconciled > 0 then 'completed' else 'skipped' end,
    'reason', case
      when p_job = 'reconciler' and reconciled > 0 then 'expired_leases_reconciled'
      when p_job = 'reconciler' then 'nothing_to_reconcile'
      when claimed > 0 then 'no_ai_shadow_slots_recorded'
      else 'no_eligible_open_market_slot'
    end,
    'cycles_claimed', claimed,
    'cycles_reconciled', reconciled,
    'model_calls', 0,
    'paper_orders_created', 0,
    'paper_fills_created', 0,
    'ledger_entries_created', 0
  );
end;
$$;

create function public.run_hosted_scheduler_request(
  p_job text,
  p_correlation_id uuid,
  p_cycle_id uuid,
  p_requested_at timestamptz
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.run_hosted_scheduler_request(
    p_job, p_correlation_id, p_cycle_id, p_requested_at
  );
$$;

revoke all on function private.run_hosted_scheduler_request(text, uuid, uuid, timestamptz)
from public, anon, authenticated;
revoke all on function public.run_hosted_scheduler_request(text, uuid, uuid, timestamptz)
from public, anon, authenticated;
grant execute on function private.run_hosted_scheduler_request(text, uuid, uuid, timestamptz)
to service_role;
grant execute on function public.run_hosted_scheduler_request(text, uuid, uuid, timestamptz)
to service_role;

commit;
