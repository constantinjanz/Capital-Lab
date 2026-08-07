begin;

create index market_bars_feature_input_idx
on public.market_bars (
  owner_id,
  source_id,
  instrument_id,
  timeframe,
  bar_start desc,
  available_at desc,
  revision_no desc
);

create function public.market_feature_bars_at(
  p_source_ids uuid[],
  p_instrument_ids uuid[],
  p_timeframe text,
  p_decision_at timestamptz,
  p_limit_per_feed integer default 21
)
returns table (
  owner_id uuid,
  decision_at timestamptz,
  instrument_id uuid,
  source_id uuid,
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
  if p_timeframe is distinct from '1m' then
    raise exception using errcode = '22023', message = 'deterministic market features require one-minute bars';
  end if;
  if p_limit_per_feed is null or p_limit_per_feed not between 1 and 21 then
    raise exception using errcode = '22023', message = 'feature-bar limit must be between 1 and 21';
  end if;
  if p_source_ids is null or cardinality(p_source_ids) > 10 then
    raise exception using errcode = '22023', message = 'market source selection must contain at most 10 identifiers';
  end if;
  if p_instrument_ids is null or cardinality(p_instrument_ids) > 100 then
    raise exception using errcode = '22023', message = 'instrument selection must contain at most 100 identifiers';
  end if;
  if exists (select 1 from unnest(p_source_ids) as requested(id) where requested.id is null) then
    raise exception using errcode = '22023', message = 'market source identifiers cannot be null';
  end if;
  if exists (select 1 from unnest(p_instrument_ids) as requested(id) where requested.id is null) then
    raise exception using errcode = '22023', message = 'instrument identifiers cannot be null';
  end if;
  if cardinality(p_source_ids) <> (
    select count(distinct requested.id)::integer
    from unnest(p_source_ids) as requested(id)
  ) then
    raise exception using errcode = '22023', message = 'market source identifiers must be unique';
  end if;
  if cardinality(p_instrument_ids) <> (
    select count(distinct requested.id)::integer
    from unnest(p_instrument_ids) as requested(id)
  ) then
    raise exception using errcode = '22023', message = 'instrument identifiers must be unique';
  end if;

  select count(*)::integer
  into v_found_count
  from public.sources as source
  where source.id = any(p_source_ids)
    and source.source_type in ('market_data', 'mock')
    and source.created_at <= p_decision_at
    and source.updated_at <= p_decision_at;
  if v_found_count <> cardinality(p_source_ids) then
    raise exception using errcode = '22023', message = 'market source selection contains an unavailable identifier';
  end if;

  select count(*)::integer
  into v_found_count
  from public.instruments as instrument
  where instrument.id = any(p_instrument_ids)
    and instrument.created_at <= p_decision_at
    and instrument.updated_at <= p_decision_at;
  if v_found_count <> cardinality(p_instrument_ids) then
    raise exception using errcode = '22023', message = 'instrument selection contains an unavailable identifier';
  end if;

  return query
  with latest_revisions as (
    select distinct on (bar.source_id, bar.instrument_id, bar.bar_start)
      bar.*
    from public.market_bars as bar
    where bar.owner_id = v_owner_id
      and bar.source_id = any(p_source_ids)
      and bar.instrument_id = any(p_instrument_ids)
      and bar.timeframe = p_timeframe
      and bar.available_at <= p_decision_at
    order by
      bar.source_id,
      bar.instrument_id,
      bar.bar_start,
      bar.revision_no desc,
      bar.available_at desc,
      bar.id desc
  ),
  eligible_revisions as (
    select revision.*
    from latest_revisions as revision
    where revision.correction_state <> 'cancelled'
      and revision.provider_event_at <= p_decision_at
      and revision.bar_end <= p_decision_at
      and (
        revision.provider_received_at is null
        or revision.provider_received_at <= p_decision_at
      )
  ),
  ranked_revisions as (
    select
      revision.*,
      row_number() over (
        partition by revision.instrument_id, revision.source_id
        order by
          revision.bar_end desc,
          revision.bar_start desc,
          revision.provider_event_at desc,
          revision.available_at desc,
          revision.revision_no desc,
          revision.id desc
      ) as feature_rank
    from eligible_revisions as revision
  )
  select
    v_owner_id,
    p_decision_at,
    revision.instrument_id,
    revision.source_id,
    revision.id,
    revision.provider_record_key,
    revision.timeframe,
    revision.revision_no,
    revision.correction_state,
    revision.bar_start,
    revision.bar_end,
    revision.open_price::text,
    revision.high_price::text,
    revision.low_price::text,
    revision.close_price::text,
    revision.volume::text,
    revision.provider_event_at,
    revision.provider_received_at,
    revision.first_seen_at,
    revision.available_at
  from ranked_revisions as revision
  where revision.feature_rank <= p_limit_per_feed
  order by
    revision.instrument_id,
    revision.source_id,
    revision.bar_end desc,
    revision.bar_start desc,
    revision.id desc;
end;
$$;

revoke all on function public.market_feature_bars_at(uuid[], uuid[], text, timestamptz, integer)
from public, anon, authenticated, service_role;
grant execute on function public.market_feature_bars_at(uuid[], uuid[], text, timestamptz, integer)
to authenticated, service_role;

comment on function public.market_feature_bars_at(uuid[], uuid[], text, timestamptz, integer)
is 'Owner-only, read-only bounded point-in-time input rows for versioned deterministic one-minute market features. Financial values are returned as exact text.';

drop function public.market_snapshot_read(text, integer);

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
  feature_bar_rows jsonb,
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
  feature_bar_snapshot as materialized (
    select feature_bar.*
    from scope_with_instruments as scope
    cross join lateral public.market_feature_bars_at(
      scope.source_ids,
      scope.instrument_ids,
      p_timeframe,
      scope.decision_at,
      21
    ) as feature_bar
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
          to_jsonb(feature_bar)
          order by
            feature_bar.instrument_id,
            feature_bar.source_id,
            feature_bar.bar_end desc,
            feature_bar.bar_start desc,
            feature_bar.bar_id desc
        )
        from feature_bar_snapshot as feature_bar
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

revoke all on function public.market_snapshot_read(text, integer)
from public, anon, authenticated, service_role;
grant execute on function public.market_snapshot_read(text, integer)
to authenticated, service_role;

comment on function public.market_snapshot_read(text, integer)
is 'Owner-only atomic hosted market read: current configuration, point-in-time evidence, and bounded deterministic feature inputs share one PostgreSQL statement snapshot.';

commit;
