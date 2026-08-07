begin;

create function public.market_snapshot_scope()
returns table (
  owner_id uuid,
  decision_at timestamptz,
  universe_row jsonb,
  member_rows jsonb,
  source_ids uuid[]
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_decision_at timestamptz := statement_timestamp();
  v_universe public.market_universes%rowtype;
  v_member_count integer;
  v_source_count integer;
begin
  if v_owner_id is null or not (select private.current_user_is_owner()) then
    raise exception using errcode = '42501', message = 'active owner authentication required';
  end if;

  select u.*
  into v_universe
  from public.market_universes as u
  where u.owner_id = v_owner_id
    and u.created_at <= v_decision_at
  order by u.created_at desc, u.version desc, u.id
  limit 1;

  select count(*)::integer
  into v_member_count
  from public.market_universe_members as member
  where v_universe.id is not null
    and member.owner_id = v_owner_id
    and member.universe_id = v_universe.id
    and member.created_at <= v_decision_at
    and member.valid_from <= v_decision_at
    and (member.valid_to is null or member.valid_to > v_decision_at);
  if v_member_count > 100 then
    raise exception using errcode = '22023', message = 'current market universe exceeds 100 instruments';
  end if;

  select count(*)::integer
  into v_source_count
  from public.sources as s
  where s.source_type = 'market_data'
    and s.created_at <= v_decision_at;
  if v_source_count > 10 then
    raise exception using errcode = '22023', message = 'current market configuration exceeds 10 sources';
  end if;

  return query
  select
    v_owner_id,
    v_decision_at,
    case
      when v_universe.id is null then null::jsonb
      else jsonb_build_object(
        'id', v_universe.id,
        'owner_id', v_universe.owner_id,
        'name', v_universe.name,
        'version', v_universe.version,
        'description', v_universe.description,
        'locked_at', v_universe.locked_at,
        'created_at', v_universe.created_at
      )
    end,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'universe_id', member.universe_id,
            'owner_id', member.owner_id,
            'instrument_id', member.instrument_id,
            'valid_from', member.valid_from,
            'valid_to', member.valid_to,
            'created_at', member.created_at
          )
          order by member.instrument_id
        )
        from public.market_universe_members as member
        where v_universe.id is not null
          and member.owner_id = v_owner_id
          and member.universe_id = v_universe.id
          and member.created_at <= v_decision_at
          and member.valid_from <= v_decision_at
          and (member.valid_to is null or member.valid_to > v_decision_at)
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select array_agg(s.id order by s.code, s.id)
        from public.sources as s
        where s.source_type = 'market_data'
          and s.created_at <= v_decision_at
      ),
      array[]::uuid[]
    );
end;
$$;

create function public.market_instrument_snapshot_at(
  p_source_ids uuid[],
  p_instrument_ids uuid[],
  p_timeframe text,
  p_decision_at timestamptz
)
returns table (
  owner_id uuid,
  decision_at timestamptz,
  instrument_id uuid,
  symbol text,
  instrument_name text,
  asset_class text,
  currency text,
  price_increment_text text,
  quantity_increment_text text,
  is_tradable boolean,
  is_shortable boolean,
  active_from timestamptz,
  active_to timestamptz,
  exchange_id uuid,
  exchange_mic text,
  exchange_name text,
  exchange_timezone text,
  source_id uuid,
  source_code text,
  source_name text,
  source_provider text,
  source_type text,
  source_is_mock boolean,
  source_is_enabled boolean,
  quote_id uuid,
  quote_provider_record_key text,
  quote_revision_no integer,
  quote_correction_state text,
  bid_price_text text,
  ask_price_text text,
  bid_size_text text,
  ask_size_text text,
  quote_provider_event_at timestamptz,
  quote_provider_received_at timestamptz,
  quote_first_seen_at timestamptz,
  quote_available_at timestamptz,
  bar_id uuid,
  bar_provider_record_key text,
  bar_timeframe text,
  bar_revision_no integer,
  bar_correction_state text,
  bar_start timestamptz,
  bar_end timestamptz,
  open_price_text text,
  high_price_text text,
  low_price_text text,
  close_price_text text,
  volume_text text,
  bar_provider_event_at timestamptz,
  bar_provider_received_at timestamptz,
  bar_first_seen_at timestamptz,
  bar_available_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_requested_count integer;
  v_found_count integer;
begin
  if v_owner_id is null or not (select private.current_user_is_owner()) then
    raise exception using errcode = '42501', message = 'active owner authentication required';
  end if;
  if p_decision_at is null then
    raise exception using errcode = '22023', message = 'decision timestamp is required';
  end if;
  if p_decision_at > statement_timestamp() then
    raise exception using errcode = '22023', message = 'future decision timestamp is not allowed';
  end if;
  if p_timeframe is null or p_timeframe not in ('1m', '5m', '15m', '1h', '1d') then
    raise exception using errcode = '22023', message = 'unsupported market bar timeframe';
  end if;
  if p_source_ids is null or cardinality(p_source_ids) > 10 then
    raise exception using errcode = '22023', message = 'market source selection must contain at most 10 identifiers';
  end if;
  if p_instrument_ids is null or cardinality(p_instrument_ids) > 100 then
    raise exception using errcode = '22023', message = 'instrument selection must contain at most 100 identifiers';
  end if;
  if exists (select 1 from unnest(p_source_ids) as requested(id) where requested.id is null)
    or exists (select 1 from unnest(p_instrument_ids) as requested(id) where requested.id is null) then
    raise exception using errcode = '22023', message = 'market snapshot identifiers cannot be null';
  end if;
  if cardinality(p_source_ids) <> (
    select count(distinct requested.id)::integer from unnest(p_source_ids) as requested(id)
  ) or cardinality(p_instrument_ids) <> (
    select count(distinct requested.id)::integer from unnest(p_instrument_ids) as requested(id)
  ) then
    raise exception using errcode = '22023', message = 'market snapshot identifiers must be unique';
  end if;

  v_requested_count := cardinality(p_source_ids);
  select count(*)::integer
  into v_found_count
  from public.sources as s
  where s.id = any(p_source_ids)
    and s.source_type in ('market_data', 'mock')
    and s.created_at <= p_decision_at
    and s.updated_at <= p_decision_at;
  if v_found_count <> v_requested_count then
    raise exception using errcode = '22023', message = 'market source selection contains an unavailable identifier';
  end if;

  v_requested_count := cardinality(p_instrument_ids);
  select count(*)::integer
  into v_found_count
  from public.instruments as i
  join public.exchanges as e on e.id = i.primary_exchange_id
  where i.id = any(p_instrument_ids)
    and i.created_at <= p_decision_at
    and i.updated_at <= p_decision_at
    and e.created_at <= p_decision_at
    and e.updated_at <= p_decision_at;
  if v_found_count <> v_requested_count then
    raise exception using errcode = '22023', message = 'instrument selection contains an unavailable identifier';
  end if;

  return query
  with requested_instruments as (
    select i.*
    from unnest(p_instrument_ids) as requested(id)
    join public.instruments as i on i.id = requested.id
    where i.created_at <= p_decision_at
      and i.updated_at <= p_decision_at
  ),
  requested_sources as (
    select s.*
    from unnest(p_source_ids) as requested(id)
    join public.sources as s on s.id = requested.id
    where s.created_at <= p_decision_at
      and s.updated_at <= p_decision_at
  ),
  source_scope as (
    select
      s.id,
      s.code,
      s.name,
      s.provider,
      s.source_type,
      s.is_mock,
      s.is_enabled
    from requested_sources as s
    union all
    select
      null::uuid,
      null::text,
      null::text,
      null::text,
      null::text,
      null::boolean,
      null::boolean
    where cardinality(p_source_ids) = 0
  )
  select
    v_owner_id,
    p_decision_at,
    i.id,
    i.symbol,
    i.name,
    i.asset_class,
    i.currency,
    i.price_increment::text,
    i.quantity_increment::text,
    i.is_tradable,
    i.is_shortable,
    i.active_from,
    i.active_to,
    e.id,
    e.mic,
    e.name,
    e.timezone,
    s.id,
    s.code,
    s.name,
    s.provider,
    s.source_type,
    s.is_mock,
    s.is_enabled,
    q.id,
    q.provider_record_key,
    q.revision_no,
    q.correction_state,
    q.bid_price::text,
    q.ask_price::text,
    q.bid_size::text,
    q.ask_size::text,
    q.provider_event_at,
    q.provider_received_at,
    q.first_seen_at,
    q.available_at,
    b.id,
    b.provider_record_key,
    b.timeframe,
    b.revision_no,
    b.correction_state,
    b.bar_start,
    b.bar_end,
    b.open_price::text,
    b.high_price::text,
    b.low_price::text,
    b.close_price::text,
    b.volume::text,
    b.provider_event_at,
    b.provider_received_at,
    b.first_seen_at,
    b.available_at
  from requested_instruments as i
  join public.exchanges as e on e.id = i.primary_exchange_id
  cross join source_scope as s
  left join lateral (
    with latest_revisions as (
      select distinct on (quote.provider_record_key) quote.*
      from public.market_quotes as quote
      where quote.owner_id = v_owner_id
        and quote.source_id = s.id
        and quote.instrument_id = i.id
        and quote.available_at <= p_decision_at
      order by
        quote.provider_record_key,
        quote.revision_no desc,
        quote.available_at desc,
        quote.id desc
    )
    select revision.*
    from latest_revisions as revision
    where revision.correction_state <> 'cancelled'
      and revision.provider_event_at <= p_decision_at
      and (
        revision.provider_received_at is null
        or revision.provider_received_at <= p_decision_at
      )
    order by
      revision.provider_event_at desc,
      revision.available_at desc,
      revision.revision_no desc,
      revision.id desc
    limit 1
  ) as q on s.id is not null
  left join lateral (
    with latest_revisions as (
      select distinct on (bar.bar_start) bar.*
      from public.market_bars as bar
      where bar.owner_id = v_owner_id
        and bar.source_id = s.id
        and bar.instrument_id = i.id
        and bar.timeframe = p_timeframe
        and bar.available_at <= p_decision_at
      order by
        bar.bar_start,
        bar.revision_no desc,
        bar.available_at desc,
        bar.id desc
    )
    select revision.*
    from latest_revisions as revision
    where revision.correction_state <> 'cancelled'
      and revision.provider_event_at <= p_decision_at
      and revision.bar_end <= p_decision_at
      and (
        revision.provider_received_at is null
        or revision.provider_received_at <= p_decision_at
      )
    order by
      revision.bar_end desc,
      revision.bar_start desc,
      revision.provider_event_at desc,
      revision.available_at desc,
      revision.revision_no desc,
      revision.id desc
    limit 1
  ) as b on s.id is not null
  order by i.symbol, s.code nulls first, i.id, s.id;
end;
$$;

create function public.market_sessions_at(
  p_exchange_ids uuid[],
  p_decision_at timestamptz,
  p_limit_per_exchange integer default 5
)
returns table (
  owner_id uuid,
  decision_at timestamptz,
  exchange_id uuid,
  exchange_mic text,
  exchange_name text,
  exchange_timezone text,
  session_id uuid,
  session_date date,
  opens_at timestamptz,
  closes_at timestamptz,
  session_type text,
  calendar_source_id uuid,
  calendar_source_code text,
  calendar_source_name text,
  source_identifier text,
  session_available_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_found_count integer;
begin
  if v_owner_id is null or not (select private.current_user_is_owner()) then
    raise exception using errcode = '42501', message = 'active owner authentication required';
  end if;
  if p_decision_at is null then
    raise exception using errcode = '22023', message = 'decision timestamp is required';
  end if;
  if p_decision_at > statement_timestamp() then
    raise exception using errcode = '22023', message = 'future decision timestamp is not allowed';
  end if;
  if p_exchange_ids is null or cardinality(p_exchange_ids) > 25 then
    raise exception using errcode = '22023', message = 'exchange selection must contain at most 25 identifiers';
  end if;
  if p_limit_per_exchange is null or p_limit_per_exchange not between 1 and 10 then
    raise exception using errcode = '22023', message = 'session limit must be between 1 and 10';
  end if;
  if exists (select 1 from unnest(p_exchange_ids) as requested(id) where requested.id is null) then
    raise exception using errcode = '22023', message = 'exchange identifiers cannot be null';
  end if;
  if cardinality(p_exchange_ids) <> (
    select count(distinct requested.id)::integer from unnest(p_exchange_ids) as requested(id)
  ) then
    raise exception using errcode = '22023', message = 'exchange identifiers must be unique';
  end if;

  select count(*)::integer
  into v_found_count
  from public.exchanges as e
  where e.id = any(p_exchange_ids)
    and e.created_at <= p_decision_at
    and e.updated_at <= p_decision_at;
  if v_found_count <> cardinality(p_exchange_ids) then
    raise exception using errcode = '22023', message = 'exchange selection contains an unavailable identifier';
  end if;
  if exists (
    select 1
    from public.market_sessions as ms
    join public.sources as calendar_source on calendar_source.id = ms.calendar_source_id
    where ms.exchange_id = any(p_exchange_ids)
      and ms.available_at <= p_decision_at
      and (
        calendar_source.created_at > p_decision_at
        or calendar_source.updated_at > p_decision_at
      )
  ) then
    raise exception using errcode = '22023', message = 'calendar source metadata is unavailable at the decision timestamp';
  end if;

  return query
  with ranked_sessions as (
    select
      e.id as exchange_id,
      e.mic as exchange_mic,
      e.name as exchange_name,
      e.timezone as exchange_timezone,
      ms.id as session_id,
      ms.session_date,
      ms.opens_at,
      ms.closes_at,
      ms.session_type,
      ms.calendar_source_id,
      calendar_source.code as calendar_source_code,
      calendar_source.name as calendar_source_name,
      ms.source_identifier,
      ms.available_at as session_available_at,
      row_number() over (
        partition by e.id
        order by ms.session_date desc, ms.available_at desc, ms.id desc
      ) as session_rank
    from unnest(p_exchange_ids) as requested(id)
    join public.exchanges as e on e.id = requested.id
    join public.market_sessions as ms on ms.exchange_id = e.id
    left join public.sources as calendar_source on calendar_source.id = ms.calendar_source_id
    where ms.available_at <= p_decision_at
      and e.created_at <= p_decision_at
      and e.updated_at <= p_decision_at
      and ms.session_date <= (p_decision_at at time zone e.timezone)::date
  )
  select
    v_owner_id,
    p_decision_at,
    ranked.exchange_id,
    ranked.exchange_mic,
    ranked.exchange_name,
    ranked.exchange_timezone,
    ranked.session_id,
    ranked.session_date,
    ranked.opens_at,
    ranked.closes_at,
    ranked.session_type,
    ranked.calendar_source_id,
    ranked.calendar_source_code,
    ranked.calendar_source_name,
    ranked.source_identifier,
    ranked.session_available_at
  from ranked_sessions as ranked
  where ranked.session_rank <= p_limit_per_exchange
  order by ranked.session_date desc, ranked.exchange_mic, ranked.session_id;
end;
$$;

create function public.market_source_health_at(
  p_source_ids uuid[],
  p_decision_at timestamptz
)
returns table (
  owner_id uuid,
  decision_at timestamptz,
  source_id uuid,
  source_code text,
  source_name text,
  source_provider text,
  source_type text,
  source_is_mock boolean,
  source_is_enabled boolean,
  health_id uuid,
  health_status text,
  checked_at timestamptz,
  last_success_at timestamptz,
  latency_ms integer,
  error_class text,
  health_available_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_found_count integer;
begin
  if v_owner_id is null or not (select private.current_user_is_owner()) then
    raise exception using errcode = '42501', message = 'active owner authentication required';
  end if;
  if p_decision_at is null then
    raise exception using errcode = '22023', message = 'decision timestamp is required';
  end if;
  if p_decision_at > statement_timestamp() then
    raise exception using errcode = '22023', message = 'future decision timestamp is not allowed';
  end if;
  if p_source_ids is null or cardinality(p_source_ids) > 10 then
    raise exception using errcode = '22023', message = 'market source selection must contain at most 10 identifiers';
  end if;
  if exists (select 1 from unnest(p_source_ids) as requested(id) where requested.id is null) then
    raise exception using errcode = '22023', message = 'market source identifiers cannot be null';
  end if;
  if cardinality(p_source_ids) <> (
    select count(distinct requested.id)::integer from unnest(p_source_ids) as requested(id)
  ) then
    raise exception using errcode = '22023', message = 'market source identifiers must be unique';
  end if;

  select count(*)::integer
  into v_found_count
  from public.sources as s
  where s.id = any(p_source_ids)
    and s.source_type in ('market_data', 'mock')
    and s.created_at <= p_decision_at
    and s.updated_at <= p_decision_at;
  if v_found_count <> cardinality(p_source_ids) then
    raise exception using errcode = '22023', message = 'market source selection contains an unavailable identifier';
  end if;

  return query
  select
    v_owner_id,
    p_decision_at,
    s.id,
    s.code,
    s.name,
    s.provider,
    s.source_type,
    s.is_mock,
    s.is_enabled,
    health.id,
    health.status,
    health.checked_at,
    health.last_success_at,
    health.latency_ms,
    health.error_class,
    health.created_at
  from unnest(p_source_ids) as requested(id)
  join public.sources as s on s.id = requested.id
    and s.created_at <= p_decision_at
    and s.updated_at <= p_decision_at
  left join lateral (
    select h.*
    from public.source_health as h
    where h.owner_id = v_owner_id
      and h.source_id = s.id
      and h.checked_at <= p_decision_at
      and h.created_at <= p_decision_at
    order by h.checked_at desc, h.created_at desc, h.id desc
    limit 1
  ) as health on true
  order by s.code, s.id;
end;
$$;

create function public.market_snapshot_read(
  p_timeframe text default '1m',
  p_session_limit integer default 5
)
returns table (
  owner_id uuid,
  decision_at timestamptz,
  universe_row jsonb,
  member_rows jsonb,
  source_ids uuid[],
  instrument_rows jsonb,
  session_rows jsonb,
  health_rows jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with scope as materialized (
    select * from public.market_snapshot_scope()
  ),
  scope_with_instruments as materialized (
    select
      scope.*,
      coalesce(
        array(
          select (member.value ->> 'instrument_id')::uuid
          from jsonb_array_elements(scope.member_rows) as member(value)
          order by member.value ->> 'instrument_id'
        ),
        array[]::uuid[]
      ) as instrument_ids
    from scope
  ),
  instrument_snapshot as materialized (
    select market_row.*
    from scope_with_instruments as scope
    cross join lateral public.market_instrument_snapshot_at(
      scope.source_ids,
      scope.instrument_ids,
      p_timeframe,
      scope.decision_at
    ) as market_row
  ),
  exchange_scope as materialized (
    select coalesce(
      array_agg(distinct market_row.exchange_id order by market_row.exchange_id),
      array[]::uuid[]
    ) as exchange_ids
    from instrument_snapshot as market_row
  ),
  session_snapshot as materialized (
    select session_row.*
    from scope_with_instruments as scope
    cross join exchange_scope
    cross join lateral public.market_sessions_at(
      exchange_scope.exchange_ids,
      scope.decision_at,
      p_session_limit
    ) as session_row
  ),
  health_snapshot as materialized (
    select health_row.*
    from scope_with_instruments as scope
    cross join lateral public.market_source_health_at(
      scope.source_ids,
      scope.decision_at
    ) as health_row
  )
  select
    scope.owner_id,
    scope.decision_at,
    scope.universe_row,
    scope.member_rows,
    scope.source_ids,
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(market_row)
          order by
            market_row.symbol,
            market_row.source_code nulls first,
            market_row.instrument_id,
            market_row.source_id
        )
        from instrument_snapshot as market_row
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(session_row)
          order by
            session_row.session_date desc,
            session_row.exchange_mic,
            session_row.session_id
        )
        from session_snapshot as session_row
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(health_row)
          order by health_row.source_code, health_row.source_id
        )
        from health_snapshot as health_row
      ),
      '[]'::jsonb
    )
  from scope_with_instruments as scope;
$$;

revoke all on function public.market_snapshot_scope()
from public, anon, authenticated, service_role;
revoke all on function public.market_instrument_snapshot_at(uuid[], uuid[], text, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.market_sessions_at(uuid[], timestamptz, integer)
from public, anon, authenticated, service_role;
revoke all on function public.market_source_health_at(uuid[], timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.market_snapshot_read(text, integer)
from public, anon, authenticated, service_role;

grant execute on function public.market_snapshot_scope()
to authenticated, service_role;
grant execute on function public.market_instrument_snapshot_at(uuid[], uuid[], text, timestamptz)
to authenticated, service_role;
grant execute on function public.market_sessions_at(uuid[], timestamptz, integer)
to authenticated, service_role;
grant execute on function public.market_source_health_at(uuid[], timestamptz)
to authenticated, service_role;
grant execute on function public.market_snapshot_read(text, integer)
to authenticated, service_role;

comment on function public.market_snapshot_scope()
is 'Owner-only, read-only atomic selection of the current market configuration and its database decision timestamp.';
comment on function public.market_instrument_snapshot_at(uuid[], uuid[], text, timestamptz)
is 'Owner-only, read-only point-in-time quote and completed-bar snapshot. Financial values are returned as exact text.';
comment on function public.market_sessions_at(uuid[], timestamptz, integer)
is 'Owner-only, read-only bounded exchange-session snapshot at a required decision timestamp.';
comment on function public.market_source_health_at(uuid[], timestamptz)
is 'Owner-only, read-only provider-health snapshot using created_at as the current availability boundary.';
comment on function public.market_snapshot_read(text, integer)
is 'Owner-only atomic hosted market read: current configuration and all point-in-time evidence share one PostgreSQL statement snapshot.';

commit;
