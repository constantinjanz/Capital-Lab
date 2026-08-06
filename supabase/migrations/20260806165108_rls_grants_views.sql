begin;

create view public.cash_ledger_view
with (security_invoker = true)
as
select
  id,
  owner_id,
  experiment_id,
  simulation_account_id,
  entry_type,
  currency,
  amount,
  effective_at,
  source_type,
  source_id,
  source_component,
  correlation_id,
  created_at
from private.cash_ledger_entries;

create view public.ai_budget_status_view
with (security_invoker = true)
as
select
  p.id,
  p.owner_id,
  p.budget_policy_id,
  p.period_kind,
  p.period_start,
  p.period_end,
  p.soft_limit,
  p.hard_limit,
  p.settled_amount,
  p.reserved_amount,
  p.unknown_amount,
  greatest(p.hard_limit - p.settled_amount - p.reserved_amount - p.unknown_amount, 0::numeric) as remaining_amount,
  p.updated_at
from private.ai_budget_periods as p;

create view public.ai_usage_view
with (security_invoker = true)
as
select
  u.id,
  u.owner_id,
  u.experiment_id,
  u.agent_run_id,
  r.call_kind,
  p.model,
  u.input_tokens,
  u.cached_input_tokens,
  u.cache_write_tokens,
  u.output_tokens,
  u.reasoning_tokens,
  u.tool_calls,
  u.web_search_calls,
  u.actual_cost,
  u.latency_ms,
  u.finish_state,
  u.occurred_at
from private.ai_usage_events as u
join private.ai_budget_reservations as r on r.id = u.reservation_id
join public.model_pricing as p on p.id = r.pricing_id;

create view public.scheduler_health_view
with (security_invoker = true)
as
select distinct on (r.owner_id, r.experiment_id)
  r.id,
  r.owner_id,
  r.experiment_id,
  r.slot_key,
  r.status,
  r.started_at,
  r.finished_at,
  r.skipped_reason,
  r.error_class,
  r.retry_eligible
from private.scheduler_runs as r
order by r.owner_id, r.experiment_id, r.started_at desc;

create view public.audit_log_view
with (security_invoker = true)
as
select
  id,
  owner_id,
  experiment_id,
  actor_type,
  action,
  target_type,
  target_id,
  correlation_id,
  metadata,
  occurred_at
from private.audit_log;

do $$
declare
  relation_record record;
begin
  for relation_record in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
    order by n.nspname, c.relname
  loop
    execute format('alter table %I.%I enable row level security', relation_record.schema_name, relation_record.table_name);
    execute format('alter table %I.%I force row level security', relation_record.schema_name, relation_record.table_name);
  end loop;
end;
$$;

create policy app_users_owner_read
on public.app_users
for select
to authenticated
using (user_id = (select auth.uid()) and private.current_user_is_owner());

do $$
declare
  relation_record record;
begin
  for relation_record in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    join pg_attribute as a on a.attrelid = c.oid
    where n.nspname in ('public', 'private')
      and c.relkind in ('r', 'p')
      and a.attname = 'owner_id'
      and not a.attisdropped
    order by n.nspname, c.relname
  loop
    execute format(
      'create policy owner_read on %I.%I for select to authenticated using (owner_id = (select auth.uid()) and private.current_user_is_owner())',
      relation_record.schema_name,
      relation_record.table_name
    );
  end loop;
end;
$$;

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'exchanges', 'instruments', 'instrument_aliases', 'sources',
    'source_policies', 'market_sessions', 'model_pricing'
  ] loop
    execute format(
      'create policy owner_reference_read on public.%I for select to authenticated using (private.current_user_is_owner())',
      relation_name
    );
  end loop;
end;
$$;

revoke all privileges on all tables in schema public from public, anon, authenticated;
revoke all privileges on all tables in schema private from public, anon, authenticated;
revoke all privileges on all sequences in schema public from public, anon, authenticated;
revoke all privileges on all sequences in schema private from public, anon, authenticated;

revoke all on schema public from anon;
grant usage on schema public to authenticated, service_role;
grant usage on schema private to authenticated, service_role;

grant select on all tables in schema public to authenticated;
grant select (
  id, owner_id, experiment_id, simulation_account_id, entry_type, currency,
  amount, effective_at, source_type, source_id, source_component, correlation_id, created_at
) on private.cash_ledger_entries to authenticated;
grant select on private.ai_budget_periods to authenticated;
grant select on private.ai_budget_reservations to authenticated;
grant select on private.ai_usage_events to authenticated;
grant select on private.scheduler_runs to authenticated;
grant select on private.audit_log to authenticated;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all tables in schema private to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all sequences in schema private to service_role;
grant execute on all functions in schema private to service_role;

grant execute on function private.current_user_is_owner() to authenticated;
grant execute on function private.market_quotes_as_of(uuid, uuid[], timestamptz) to authenticated;
grant execute on function private.event_revisions_as_of(uuid, timestamptz) to authenticated;
grant execute on function private.knowledge_chunks_as_of(uuid, timestamptz) to authenticated;

grant execute on function public.market_quotes_as_of(uuid[], timestamptz) to authenticated;
grant execute on function public.event_revisions_as_of(timestamptz) to authenticated;
grant execute on function public.knowledge_chunks_as_of(timestamptz) to authenticated;

commit;
