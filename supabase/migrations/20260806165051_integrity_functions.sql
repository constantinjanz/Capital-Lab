begin;

create function private.current_user_is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_users as u
    where u.user_id = auth.uid()
      and u.role = 'owner'
      and u.is_active
  );
$$;

revoke all on function private.current_user_is_owner() from public, anon;
grant execute on function private.current_user_is_owner() to authenticated;

create function private.guard_experiment_update()
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
    old_immutable := to_jsonb(old) - array['lifecycle_status', 'pause_reason', 'ends_at', 'updated_at'];
    new_immutable := to_jsonb(new) - array['lifecycle_status', 'pause_reason', 'ends_at', 'updated_at'];
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

revoke all on function private.guard_experiment_update() from public, anon, authenticated;
create trigger experiments_guard_update
before update on public.experiments
for each row execute function private.guard_experiment_update();

create function private.enforce_experiment_config_kinds()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.configuration_versions where id = new.simulator_config_version_id and owner_id = new.owner_id and config_kind = 'simulator') then
    raise exception using errcode = '23514', message = 'simulator_config_version_id has the wrong config kind';
  end if;
  if not exists (select 1 from public.configuration_versions where id = new.risk_config_version_id and owner_id = new.owner_id and config_kind = 'risk') then
    raise exception using errcode = '23514', message = 'risk_config_version_id has the wrong config kind';
  end if;
  if not exists (select 1 from public.configuration_versions where id = new.model_routing_version_id and owner_id = new.owner_id and config_kind = 'model_routing') then
    raise exception using errcode = '23514', message = 'model_routing_version_id has the wrong config kind';
  end if;
  if not exists (select 1 from public.configuration_versions where id = new.data_source_config_version_id and owner_id = new.owner_id and config_kind = 'data_sources') then
    raise exception using errcode = '23514', message = 'data_source_config_version_id has the wrong config kind';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_experiment_config_kinds() from public, anon, authenticated;
create trigger experiment_versions_enforce_config_kinds
before insert on public.experiment_versions
for each row execute function private.enforce_experiment_config_kinds();

create function private.guard_effective_end_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  end_column text := tg_argv[0];
  old_end jsonb;
  new_end jsonb;
begin
  old_end := to_jsonb(old) -> end_column;
  new_end := to_jsonb(new) -> end_column;
  if (to_jsonb(old) - end_column) <> (to_jsonb(new) - end_column) then
    raise exception using errcode = '55000', message = 'only the effective end timestamp may be changed';
  end if;
  if old_end <> 'null'::jsonb and old_end is not null and old_end <> new_end then
    raise exception using errcode = '55000', message = 'an effective end timestamp cannot be changed twice';
  end if;
  if new_end = 'null'::jsonb or new_end is null then
    raise exception using errcode = '55000', message = 'an effective end timestamp cannot be cleared';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_effective_end_update() from public, anon, authenticated;

create trigger market_universe_members_guard_update
before update on public.market_universe_members
for each row execute function private.guard_effective_end_update('valid_to');
create trigger market_universe_members_reject_delete
before delete on public.market_universe_members
for each row execute function private.reject_mutation();

create trigger source_policies_guard_update
before update on public.source_policies
for each row execute function private.guard_effective_end_update('effective_to');
create trigger source_policies_reject_delete
before delete on public.source_policies
for each row execute function private.reject_mutation();

create trigger model_pricing_guard_update
before update on public.model_pricing
for each row execute function private.guard_effective_end_update('effective_to');
create trigger model_pricing_reject_delete
before delete on public.model_pricing
for each row execute function private.reject_mutation();

create trigger ai_budget_policies_guard_update
before update on public.ai_budget_policies
for each row execute function private.guard_effective_end_update('effective_to');
create trigger ai_budget_policies_reject_delete
before delete on public.ai_budget_policies
for each row execute function private.reject_mutation();

create trigger strategy_assignments_guard_update
before update on public.strategy_assignments
for each row execute function private.guard_effective_end_update('valid_to');
create trigger strategy_assignments_reject_delete
before delete on public.strategy_assignments
for each row execute function private.reject_mutation();

create function private.reject_overlapping_model_pricing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.model_pricing as p
    where p.provider = new.provider
      and p.model = new.model
      and p.pricing_mode = new.pricing_mode
      and p.context_tier = new.context_tier
      and p.id <> new.id
      and tstzrange(p.effective_from, p.effective_to, '[)') &&
          tstzrange(new.effective_from, new.effective_to, '[)')
  ) then
    raise exception using errcode = '23P01', message = 'model pricing effective ranges cannot overlap';
  end if;
  return new;
end;
$$;

revoke all on function private.reject_overlapping_model_pricing() from public, anon, authenticated;
create trigger model_pricing_reject_overlap
before insert or update on public.model_pricing
for each row execute function private.reject_overlapping_model_pricing();

create function private.validate_decision_evidence_time()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  source_available_at timestamptz;
  decision_at timestamptz;
begin
  select d.decided_at into strict decision_at
  from public.agent_decisions as d
  where d.id = new.decision_id and d.owner_id = new.owner_id;

  if new.market_quote_id is not null then
    select q.available_at into strict source_available_at from public.market_quotes as q where q.id = new.market_quote_id and q.owner_id = new.owner_id;
  elsif new.market_bar_id is not null then
    select b.available_at into strict source_available_at from public.market_bars as b where b.id = new.market_bar_id and b.owner_id = new.owner_id;
  elsif new.event_revision_id is not null then
    select e.available_at into strict source_available_at from public.event_revisions as e where e.id = new.event_revision_id and e.owner_id = new.owner_id;
  elsif new.knowledge_chunk_id is not null then
    select k.available_at into strict source_available_at from public.knowledge_chunks as k where k.id = new.knowledge_chunk_id and k.owner_id = new.owner_id;
  elsif new.prior_decision_id is not null then
    select d.decided_at into strict source_available_at from public.agent_decisions as d where d.id = new.prior_decision_id and d.owner_id = new.owner_id;
  end if;

  if source_available_at > decision_at or new.evidence_available_at <> source_available_at then
    raise exception using errcode = '23514', message = 'decision evidence was not available at decision time';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_decision_evidence_time() from public, anon, authenticated;
create trigger decision_evidence_validate_time
before insert on public.decision_evidence
for each row execute function private.validate_decision_evidence_time();

alter table public.risk_events
  add constraint risk_events_order_fk
  foreign key (order_id, experiment_id, owner_id)
  references public.orders(id, experiment_id, owner_id) on delete restrict;

create function private.validate_fill_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  order_row public.orders%rowtype;
  source_available_at timestamptz;
begin
  select * into strict order_row
  from public.orders
  where id = new.order_id and experiment_id = new.experiment_id and owner_id = new.owner_id;

  if order_row.simulation_account_id <> new.simulation_account_id
     or order_row.instrument_id <> new.instrument_id then
    raise exception using errcode = '23514', message = 'fill scope does not match its order';
  end if;
  if new.opportunity_at < order_row.eligible_at then
    raise exception using errcode = '23514', message = 'fill opportunity predates order eligibility';
  end if;

  if new.market_quote_id is not null then
    select available_at into strict source_available_at
    from public.market_quotes
    where id = new.market_quote_id and owner_id = new.owner_id and instrument_id = new.instrument_id;
    if source_available_at > new.observed_at then
      raise exception using errcode = '23514', message = 'fill quote was not available when observed';
    end if;
  end if;
  if new.market_bar_id is not null then
    select available_at into strict source_available_at
    from public.market_bars
    where id = new.market_bar_id and owner_id = new.owner_id and instrument_id = new.instrument_id;
    if source_available_at > new.observed_at then
      raise exception using errcode = '23514', message = 'fill bar was not available when observed';
    end if;
  end if;
  if new.fx_rate_id is not null then
    select available_at into strict source_available_at
    from public.fx_rates
    where id = new.fx_rate_id and owner_id = new.owner_id;
    if source_available_at > new.observed_at then
      raise exception using errcode = '23514', message = 'fill FX rate was not available when observed';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.validate_fill_provenance() from public, anon, authenticated;
create trigger fills_validate_provenance
before insert on public.fills
for each row execute function private.validate_fill_provenance();

create function private.market_quotes_as_of(
  p_owner_id uuid,
  p_instrument_ids uuid[],
  p_as_of timestamptz
)
returns setof public.market_quotes
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (q.source_id, q.instrument_id, q.provider_record_key) q.*
  from public.market_quotes as q
  where p_as_of is not null
    and q.owner_id = p_owner_id
    and q.instrument_id = any(p_instrument_ids)
    and q.available_at <= p_as_of
  order by q.source_id, q.instrument_id, q.provider_record_key,
           q.available_at desc, q.revision_no desc;
$$;

create function private.event_revisions_as_of(
  p_owner_id uuid,
  p_as_of timestamptz
)
returns setof public.event_revisions
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (e.event_id) e.*
  from public.event_revisions as e
  where p_as_of is not null
    and e.owner_id = p_owner_id
    and e.available_at <= p_as_of
  order by e.event_id, e.available_at desc, e.revision_no desc;
$$;

create function private.knowledge_chunks_as_of(
  p_owner_id uuid,
  p_as_of timestamptz
)
returns setof public.knowledge_chunks
language sql
stable
security invoker
set search_path = ''
as $$
  select k.*
  from public.knowledge_chunks as k
  join public.knowledge_document_versions as dv
    on dv.id = k.document_version_id and dv.owner_id = k.owner_id
  where p_as_of is not null
    and k.owner_id = p_owner_id
    and k.available_at <= p_as_of
    and k.valid_from <= p_as_of
    and (k.valid_to is null or p_as_of < k.valid_to)
    and not exists (
      select 1
      from public.knowledge_document_versions as later
      where later.document_id = dv.document_id
        and later.owner_id = dv.owner_id
        and later.available_at <= p_as_of
        and (later.available_at, later.version) > (dv.available_at, dv.version)
    );
$$;

revoke all on function private.market_quotes_as_of(uuid, uuid[], timestamptz) from public, anon;
revoke all on function private.event_revisions_as_of(uuid, timestamptz) from public, anon;
revoke all on function private.knowledge_chunks_as_of(uuid, timestamptz) from public, anon;
grant execute on function private.market_quotes_as_of(uuid, uuid[], timestamptz) to authenticated;
grant execute on function private.event_revisions_as_of(uuid, timestamptz) to authenticated;
grant execute on function private.knowledge_chunks_as_of(uuid, timestamptz) to authenticated;

create function public.market_quotes_as_of(p_instrument_ids uuid[], p_as_of timestamptz)
returns setof public.market_quotes
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.market_quotes_as_of(auth.uid(), p_instrument_ids, p_as_of);
$$;

create function public.event_revisions_as_of(p_as_of timestamptz)
returns setof public.event_revisions
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.event_revisions_as_of(auth.uid(), p_as_of);
$$;

create function public.knowledge_chunks_as_of(p_as_of timestamptz)
returns setof public.knowledge_chunks
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.knowledge_chunks_as_of(auth.uid(), p_as_of);
$$;

revoke all on function public.market_quotes_as_of(uuid[], timestamptz) from public, anon;
revoke all on function public.event_revisions_as_of(timestamptz) from public, anon;
revoke all on function public.knowledge_chunks_as_of(timestamptz) from public, anon;
grant execute on function public.market_quotes_as_of(uuid[], timestamptz) to authenticated;
grant execute on function public.event_revisions_as_of(timestamptz) to authenticated;
grant execute on function public.knowledge_chunks_as_of(timestamptz) to authenticated;

commit;
