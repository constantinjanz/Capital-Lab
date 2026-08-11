begin;

create table public.market_calendar_manifests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  manifest_id text not null check (manifest_id ~ '^[a-z0-9_]+$'),
  calendar_year integer not null check (calendar_year between 2000 and 2100),
  timezone text not null,
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  reviewed_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (owner_id, manifest_id),
  unique (id, owner_id)
);

create trigger market_calendar_manifests_reject_mutation
before update or delete on public.market_calendar_manifests
for each row execute function private.reject_mutation();

alter table public.market_calendar_manifests enable row level security;
alter table public.market_calendar_manifests force row level security;

create policy owner_read
on public.market_calendar_manifests
for select
to authenticated
using (
  owner_id = (select auth.uid())
  and private.current_user_is_owner()
);

revoke all privileges on table public.market_calendar_manifests
from public, anon, authenticated, service_role;
grant select on table public.market_calendar_manifests
to authenticated;
grant all privileges on table public.market_calendar_manifests
to service_role;

alter table public.market_sessions
add column calendar_manifest_id uuid
references public.market_calendar_manifests(id) on delete restrict;

create index market_sessions_manifest_idx
on public.market_sessions(calendar_manifest_id, exchange_id, session_date);

create function private.reviewed_hosted_official_calendar_manifest_id(
  p_owner_id uuid,
  p_manifest_record_id uuid,
  p_decision_at timestamptz
)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  with expected_definition as (
    select jsonb_build_object(
      'calendar_year', 2026,
      'contract_version', 1,
      'early_closes', jsonb_build_array(
        jsonb_build_object('close_local', '13:00:00', 'date', '2026-11-27'),
        jsonb_build_object('close_local', '13:00:00', 'date', '2026-12-24')
      ),
      'exchanges', jsonb_build_array(
        jsonb_build_object(
          'country_code', 'US',
          'mic', 'ARCX',
          'name', 'NYSE Arca',
          'source_code', 'nyse_official_calendar_2026',
          'source_url', 'https://www.nyse.com/markets/hours-calendars',
          'timezone', 'America/New_York'
        ),
        jsonb_build_object(
          'country_code', 'US',
          'mic', 'XNAS',
          'name', 'Nasdaq Stock Market',
          'source_code', 'nasdaq_official_calendar_2026',
          'source_url', 'https://www.nasdaqtrader.com/trader.aspx?id=Calendar',
          'timezone', 'America/New_York'
        )
      ),
      'holidays', jsonb_build_array(
        '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03',
        '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07',
        '2026-11-26', '2026-12-25'
      ),
      'regular_close_local', '16:00:00',
      'regular_open_local', '09:30:00',
      'timezone', 'America/New_York',
      'weekday_rule', 'ISO Monday-Friday'
    ) as definition
  ),
  expected_sources (
    mic,
    code,
    name,
    provider,
    base_url
  ) as (
    values
      (
        'ARCX'::text,
        'nyse_official_calendar_2026'::text,
        'NYSE Official 2026 Trading Calendar'::text,
        'nyse'::text,
        'https://www.nyse.com/markets/hours-calendars'::text
      ),
      (
        'XNAS'::text,
        'nasdaq_official_calendar_2026'::text,
        'Nasdaq Trader Official 2026 Calendar'::text,
        'nasdaq_trader'::text,
        'https://www.nasdaqtrader.com/trader.aspx?id=Calendar'::text
      )
  ),
  reviewed_sources as (
    select expected.mic, source.id
    from expected_sources as expected
    join public.sources as source
      on source.code = expected.code
      and source.name = expected.name
      and source.source_type = 'research'
      and source.provider = expected.provider
      and source.base_url = expected.base_url
      and not source.is_mock
      and not source.is_enabled
      and source.created_at <= p_decision_at
      and source.updated_at <= p_decision_at
  ),
  reviewed_policies as (
    select policy.source_id
    from public.source_policies as policy
    join reviewed_sources as source on source.id = policy.source_id
    where policy.version = 1
      and policy.allowed_use = 'Official exchange-session reference evidence for paper-trading research only; no live feed, brokerage, account, or order access.'
      and policy.licensing_metadata = '{"calendar_year":2026,"official_exchange_source":true,"paper_trading_only":true,"runtime_fetch":false}'::jsonb
      and policy.retention_days is null
      and not policy.requires_authentication
      and not policy.enabled
      and policy.effective_from <= p_decision_at
      and policy.effective_to is null
      and policy.created_at <= p_decision_at
  ),
  expected_sessions as (
    select
      exchange_manifest.mic,
      day_value.session_date,
      case
        when day_value.session_date = any (array[
          date '2026-01-01', date '2026-01-19', date '2026-02-16',
          date '2026-04-03', date '2026-05-25', date '2026-06-19',
          date '2026-07-03', date '2026-09-07', date '2026-11-26',
          date '2026-12-25'
        ]) then 'closed'::text
        when day_value.session_date = any (array[
          date '2026-11-27', date '2026-12-24'
        ]) then 'early_close'::text
        else 'regular'::text
      end as session_type,
      case
        when day_value.session_date = any (array[
          date '2026-01-01', date '2026-01-19', date '2026-02-16',
          date '2026-04-03', date '2026-05-25', date '2026-06-19',
          date '2026-07-03', date '2026-09-07', date '2026-11-26',
          date '2026-12-25'
        ]) then null::timestamptz
        else (day_value.session_date + time '09:30:00') at time zone 'America/New_York'
      end as opens_at,
      case
        when day_value.session_date = any (array[
          date '2026-01-01', date '2026-01-19', date '2026-02-16',
          date '2026-04-03', date '2026-05-25', date '2026-06-19',
          date '2026-07-03', date '2026-09-07', date '2026-11-26',
          date '2026-12-25'
        ]) then null::timestamptz
        when day_value.session_date = any (array[
          date '2026-11-27', date '2026-12-24'
        ]) then (day_value.session_date + time '13:00:00') at time zone 'America/New_York'
        else (day_value.session_date + time '16:00:00') at time zone 'America/New_York'
      end as closes_at,
      'capital_lab_us_equities_calendar_2026_v1:'
        || exchange_manifest.mic
        || ':'
        || to_char(day_value.session_date, 'YYYY-MM-DD') as source_identifier
    from (values ('ARCX'::text), ('XNAS'::text)) as exchange_manifest(mic)
    cross join lateral (
      select generated_day::date as session_date
      from generate_series(
        date '2026-01-01',
        date '2026-12-31',
        interval '1 day'
      ) as generated_day
      where extract(isodow from generated_day) between 1 and 5
    ) as day_value
  ),
  actual_sessions as (
    select
      session.id,
      exchange.mic,
      session.session_date,
      session.session_type,
      session.opens_at,
      session.closes_at,
      session.calendar_manifest_id,
      session.calendar_source_id,
      session.source_identifier,
      session.available_at,
      session.created_at
    from public.market_sessions as session
    join public.exchanges as exchange on exchange.id = session.exchange_id
    where exchange.mic in ('ARCX', 'XNAS')
      and session.session_date between date '2026-01-01' and date '2026-12-31'
  )
  select case
    when p_owner_id = (select auth.uid())
      and (select private.current_user_is_owner())
      and p_manifest_record_id is not null
      and p_decision_at is not null
      and exists (
        select 1
        from public.market_calendar_manifests as manifest
        cross join expected_definition as expected
        where manifest.id = p_manifest_record_id
          and manifest.owner_id = p_owner_id
          and manifest.manifest_id = 'capital_lab_us_equities_calendar_2026_v1'
          and manifest.calendar_year = 2026
          and manifest.timezone = 'America/New_York'
          and manifest.definition = expected.definition
          and manifest.content_hash = encode(
            extensions.digest(expected.definition::text, 'sha256'),
            'hex'
          )
          and manifest.reviewed_at <= p_decision_at
          and manifest.created_at <= p_decision_at
      )
      and (select count(*) from reviewed_sources) = 2
      and (select count(*) from reviewed_policies) = 2
      and not exists (
        select 1
        from public.source_policies as policy
        join reviewed_sources as source on source.id = policy.source_id
        where policy.version <> 1
      )
      and (select count(*) from expected_sessions) = 522
      and (select count(*) from actual_sessions) = 522
      and not exists (
        select 1
        from expected_sessions as expected
        join reviewed_sources as source on source.mic = expected.mic
        left join actual_sessions as actual
          on actual.mic = expected.mic
          and actual.session_date = expected.session_date
        where actual.id is null
          or actual.session_type <> expected.session_type
          or actual.opens_at is distinct from expected.opens_at
          or actual.closes_at is distinct from expected.closes_at
          or actual.calendar_manifest_id is distinct from p_manifest_record_id
          or actual.calendar_source_id <> source.id
          or actual.source_identifier <> expected.source_identifier
          or actual.available_at > p_decision_at
          or actual.created_at > p_decision_at
      )
      and exists (
        select 1
        from private.audit_log as audit
        where audit.owner_id = p_owner_id
          and audit.actor_type = 'owner'
          and audit.actor_id = p_owner_id
          and audit.action = 'market.official_calendar_configured'
          and audit.target_type = 'market_calendar_manifest'
          and audit.target_id = p_manifest_record_id
          and audit.metadata ->> 'manifest_id' = 'capital_lab_us_equities_calendar_2026_v1'
          and audit.metadata ->> 'calendar_year' = '2026'
          and audit.metadata ->> 'exchange_count' = '2'
          and audit.metadata ->> 'session_count' = '522'
          and audit.metadata ->> 'source_count' = '2'
          and audit.metadata ->> 'provider_request_made' = 'false'
          and audit.metadata ->> 'scheduler_enabled' = 'false'
          and audit.occurred_at <= p_decision_at
      )
    then 'capital_lab_us_equities_calendar_2026_v1'::text
    else null::text
  end;
$$;

create function private.configure_hosted_official_calendar_manifest(
  p_operation_id uuid
)
returns table (
  operation_id uuid,
  status text,
  manifest_record_id uuid,
  source_count integer,
  session_count integer,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_effective_at timestamptz := statement_timestamp();
  v_scope constant text := 'market.configure_official_calendar.v1';
  v_manifest_id constant text := 'capital_lab_us_equities_calendar_2026_v1';
  v_policy_allowed_use constant text := 'Official exchange-session reference evidence for paper-trading research only; no live feed, brokerage, account, or order access.';
  v_policy_licensing constant jsonb := '{"calendar_year":2026,"official_exchange_source":true,"paper_trading_only":true,"runtime_fetch":false}'::jsonb;
  v_definition jsonb;
  v_request_hash text;
  v_idempotency private.idempotency_records%rowtype;
  v_inserted_idempotency boolean;
  v_exchange public.exchanges%rowtype;
  v_exchange_manifest record;
  v_source public.sources%rowtype;
  v_source_manifest record;
  v_policy public.source_policies%rowtype;
  v_manifest public.market_calendar_manifests%rowtype;
  v_manifest_reused boolean := false;
begin
  if v_owner_id is null or not private.current_user_is_owner() then
    raise exception using
      errcode = '42501',
      message = 'active owner authentication required';
  end if;

  if p_operation_id is null then
    raise exception using
      errcode = '22023',
      message = 'operation id is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'capital-lab:official-calendar:' || v_owner_id::text,
      0
    )
  );

  v_definition := jsonb_build_object(
    'calendar_year', 2026,
    'contract_version', 1,
    'early_closes', jsonb_build_array(
      jsonb_build_object('close_local', '13:00:00', 'date', '2026-11-27'),
      jsonb_build_object('close_local', '13:00:00', 'date', '2026-12-24')
    ),
    'exchanges', jsonb_build_array(
      jsonb_build_object(
        'country_code', 'US',
        'mic', 'ARCX',
        'name', 'NYSE Arca',
        'source_code', 'nyse_official_calendar_2026',
        'source_url', 'https://www.nyse.com/markets/hours-calendars',
        'timezone', 'America/New_York'
      ),
      jsonb_build_object(
        'country_code', 'US',
        'mic', 'XNAS',
        'name', 'Nasdaq Stock Market',
        'source_code', 'nasdaq_official_calendar_2026',
        'source_url', 'https://www.nasdaqtrader.com/trader.aspx?id=Calendar',
        'timezone', 'America/New_York'
      )
    ),
    'holidays', jsonb_build_array(
      '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03',
      '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07',
      '2026-11-26', '2026-12-25'
    ),
    'regular_close_local', '16:00:00',
    'regular_open_local', '09:30:00',
    'timezone', 'America/New_York',
    'weekday_rule', 'ISO Monday-Friday'
  );
  v_request_hash := encode(
    extensions.digest(v_definition::text, 'sha256'),
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
    v_scope,
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
      and record.scope = v_scope
      and record.idempotency_key = p_operation_id::text
    for update;

    if v_idempotency.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'official calendar operation id was reused with a different manifest contract';
    end if;

    if v_idempotency.status <> 'completed'
      or v_idempotency.result_ref_type <> 'market_calendar_manifest'
      or v_idempotency.result_ref_id is null
    then
      raise exception using
        errcode = '55000',
        message = 'official calendar operation has an inconsistent idempotency record';
    end if;

    if private.reviewed_hosted_official_calendar_manifest_id(
      v_owner_id,
      v_idempotency.result_ref_id,
      v_effective_at
    ) is distinct from v_manifest_id then
      raise exception using
        errcode = '55000',
        message = 'official calendar operation result no longer matches its reviewed manifest';
    end if;

    return query
    select
      p_operation_id,
      'configured'::text,
      v_idempotency.result_ref_id,
      2,
      522,
      true;
    return;
  end if;

  for v_exchange_manifest in
    select manifest.*
    from (values
      ('ARCX'::text, 'NYSE Arca'::text, 'America/New_York'::text, 'US'::text),
      ('XNAS'::text, 'Nasdaq Stock Market'::text, 'America/New_York'::text, 'US'::text)
    ) as manifest(mic, name, timezone, country_code)
    order by manifest.mic
  loop
    select exchange.*
    into v_exchange
    from public.exchanges as exchange
    where exchange.mic = v_exchange_manifest.mic;

    if found then
      if v_exchange.name <> v_exchange_manifest.name
        or v_exchange.timezone <> v_exchange_manifest.timezone
        or v_exchange.country_code <> v_exchange_manifest.country_code
      then
        raise exception using
          errcode = '23514',
          message = format(
            'official calendar exchange %s conflicts with the reviewed manifest',
            v_exchange_manifest.mic
          );
      end if;
    else
      insert into public.exchanges (mic, name, timezone, country_code)
      values (
        v_exchange_manifest.mic,
        v_exchange_manifest.name,
        v_exchange_manifest.timezone,
        v_exchange_manifest.country_code
      );
    end if;
  end loop;

  for v_source_manifest in
    select manifest.*
    from (values
      (
        'ARCX'::text,
        'nyse_official_calendar_2026'::text,
        'NYSE Official 2026 Trading Calendar'::text,
        'nyse'::text,
        'https://www.nyse.com/markets/hours-calendars'::text
      ),
      (
        'XNAS'::text,
        'nasdaq_official_calendar_2026'::text,
        'Nasdaq Trader Official 2026 Calendar'::text,
        'nasdaq_trader'::text,
        'https://www.nasdaqtrader.com/trader.aspx?id=Calendar'::text
      )
    ) as manifest(mic, code, name, provider, base_url)
    order by manifest.mic
  loop
    select source.*
    into v_source
    from public.sources as source
    where source.code = v_source_manifest.code;

    if found then
      if v_source.name <> v_source_manifest.name
        or v_source.source_type <> 'research'
        or v_source.provider <> v_source_manifest.provider
        or v_source.base_url is distinct from v_source_manifest.base_url
        or v_source.is_mock
        or v_source.is_enabled
      then
        raise exception using
          errcode = '23514',
          message = format(
            'official calendar source %s conflicts with the reviewed manifest',
            v_source_manifest.code
          );
      end if;
    else
      insert into public.sources (
        code,
        name,
        source_type,
        provider,
        base_url,
        is_mock,
        is_enabled
      ) values (
        v_source_manifest.code,
        v_source_manifest.name,
        'research',
        v_source_manifest.provider,
        v_source_manifest.base_url,
        false,
        false
      )
      returning * into v_source;
    end if;

    if exists (
      select 1
      from public.source_policies as policy
      where policy.source_id = v_source.id
        and policy.version <> 1
    ) then
      raise exception using
        errcode = '23514',
        message = format(
          'official calendar source %s has an unreviewed policy version',
          v_source_manifest.code
        );
    end if;

    select policy.*
    into v_policy
    from public.source_policies as policy
    where policy.source_id = v_source.id
      and policy.version = 1;

    if found then
      if v_policy.allowed_use <> v_policy_allowed_use
        or v_policy.licensing_metadata <> v_policy_licensing
        or v_policy.retention_days is not null
        or v_policy.requires_authentication
        or v_policy.enabled
        or v_policy.effective_from > v_effective_at
        or v_policy.effective_to is not null
      then
        raise exception using
          errcode = '23514',
          message = format(
            'official calendar source policy %s conflicts with the reviewed manifest',
            v_source_manifest.code
          );
      end if;
    else
      insert into public.source_policies (
        source_id,
        version,
        allowed_use,
        licensing_metadata,
        retention_days,
        requires_authentication,
        enabled,
        effective_from,
        effective_to
      ) values (
        v_source.id,
        1,
        v_policy_allowed_use,
        v_policy_licensing,
        null,
        false,
        false,
        v_effective_at,
        null
      );
    end if;
  end loop;

  select manifest.*
  into v_manifest
  from public.market_calendar_manifests as manifest
  where manifest.owner_id = v_owner_id
    and manifest.manifest_id = v_manifest_id;

  if found then
    if v_manifest.calendar_year <> 2026
      or v_manifest.timezone <> 'America/New_York'
      or v_manifest.definition <> v_definition
      or v_manifest.content_hash <> v_request_hash
      or v_manifest.reviewed_at > v_effective_at
    then
      raise exception using
        errcode = '23514',
        message = 'official calendar record conflicts with the reviewed manifest';
    end if;
    v_manifest_reused := true;
  else
    insert into public.market_calendar_manifests (
      owner_id,
      manifest_id,
      calendar_year,
      timezone,
      definition,
      content_hash,
      reviewed_at
    ) values (
      v_owner_id,
      v_manifest_id,
      2026,
      'America/New_York',
      v_definition,
      v_request_hash,
      v_effective_at
    )
    returning * into v_manifest;
  end if;

  if exists (
    with expected_sessions as (
      select
        exchange_manifest.mic,
        day_value.session_date,
        case
          when day_value.session_date = any (array[
            date '2026-01-01', date '2026-01-19', date '2026-02-16',
            date '2026-04-03', date '2026-05-25', date '2026-06-19',
            date '2026-07-03', date '2026-09-07', date '2026-11-26',
            date '2026-12-25'
          ]) then 'closed'::text
          when day_value.session_date = any (array[
            date '2026-11-27', date '2026-12-24'
          ]) then 'early_close'::text
          else 'regular'::text
        end as session_type,
        case
          when day_value.session_date = any (array[
            date '2026-01-01', date '2026-01-19', date '2026-02-16',
            date '2026-04-03', date '2026-05-25', date '2026-06-19',
            date '2026-07-03', date '2026-09-07', date '2026-11-26',
            date '2026-12-25'
          ]) then null::timestamptz
          else (day_value.session_date + time '09:30:00') at time zone 'America/New_York'
        end as opens_at,
        case
          when day_value.session_date = any (array[
            date '2026-01-01', date '2026-01-19', date '2026-02-16',
            date '2026-04-03', date '2026-05-25', date '2026-06-19',
            date '2026-07-03', date '2026-09-07', date '2026-11-26',
            date '2026-12-25'
          ]) then null::timestamptz
          when day_value.session_date = any (array[
            date '2026-11-27', date '2026-12-24'
          ]) then (day_value.session_date + time '13:00:00') at time zone 'America/New_York'
          else (day_value.session_date + time '16:00:00') at time zone 'America/New_York'
        end as closes_at,
        'capital_lab_us_equities_calendar_2026_v1:'
          || exchange_manifest.mic
          || ':'
          || to_char(day_value.session_date, 'YYYY-MM-DD') as source_identifier
      from (values ('ARCX'::text), ('XNAS'::text)) as exchange_manifest(mic)
      cross join lateral (
        select generated_day::date as session_date
        from generate_series(
          date '2026-01-01',
          date '2026-12-31',
          interval '1 day'
        ) as generated_day
        where extract(isodow from generated_day) between 1 and 5
      ) as day_value
    )
    select 1
    from public.market_sessions as session
    join public.exchanges as exchange on exchange.id = session.exchange_id
    left join expected_sessions as expected
      on expected.mic = exchange.mic
      and expected.session_date = session.session_date
    left join public.sources as source
      on source.id = session.calendar_source_id
    where exchange.mic in ('ARCX', 'XNAS')
      and session.session_date between date '2026-01-01' and date '2026-12-31'
      and (
        expected.session_date is null
        or session.calendar_manifest_id is distinct from v_manifest.id
        or session.session_type <> expected.session_type
        or session.opens_at is distinct from expected.opens_at
        or session.closes_at is distinct from expected.closes_at
        or source.code is distinct from case exchange.mic
          when 'ARCX' then 'nyse_official_calendar_2026'
          when 'XNAS' then 'nasdaq_official_calendar_2026'
        end
        or session.source_identifier <> expected.source_identifier
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'existing 2026 market sessions conflict with the reviewed official calendar';
  end if;

  insert into public.market_sessions (
    exchange_id,
    session_date,
    opens_at,
    closes_at,
    session_type,
    calendar_source_id,
    source_identifier,
    available_at,
    calendar_manifest_id
  )
  select
    exchange.id,
    day_value.session_date,
    case
      when day_value.session_date = any (array[
        date '2026-01-01', date '2026-01-19', date '2026-02-16',
        date '2026-04-03', date '2026-05-25', date '2026-06-19',
        date '2026-07-03', date '2026-09-07', date '2026-11-26',
        date '2026-12-25'
      ]) then null::timestamptz
      else (day_value.session_date + time '09:30:00') at time zone 'America/New_York'
    end,
    case
      when day_value.session_date = any (array[
        date '2026-01-01', date '2026-01-19', date '2026-02-16',
        date '2026-04-03', date '2026-05-25', date '2026-06-19',
        date '2026-07-03', date '2026-09-07', date '2026-11-26',
        date '2026-12-25'
      ]) then null::timestamptz
      when day_value.session_date = any (array[
        date '2026-11-27', date '2026-12-24'
      ]) then (day_value.session_date + time '13:00:00') at time zone 'America/New_York'
      else (day_value.session_date + time '16:00:00') at time zone 'America/New_York'
    end,
    case
      when day_value.session_date = any (array[
        date '2026-01-01', date '2026-01-19', date '2026-02-16',
        date '2026-04-03', date '2026-05-25', date '2026-06-19',
        date '2026-07-03', date '2026-09-07', date '2026-11-26',
        date '2026-12-25'
      ]) then 'closed'
      when day_value.session_date = any (array[
        date '2026-11-27', date '2026-12-24'
      ]) then 'early_close'
      else 'regular'
    end,
    source.id,
    v_manifest_id || ':' || exchange.mic || ':'
      || to_char(day_value.session_date, 'YYYY-MM-DD'),
    v_effective_at,
    v_manifest.id
  from public.exchanges as exchange
  join public.sources as source
    on source.code = case exchange.mic
      when 'ARCX' then 'nyse_official_calendar_2026'
      when 'XNAS' then 'nasdaq_official_calendar_2026'
    end
  cross join lateral (
    select generated_day::date as session_date
    from generate_series(
      date '2026-01-01',
      date '2026-12-31',
      interval '1 day'
    ) as generated_day
    where extract(isodow from generated_day) between 1 and 5
  ) as day_value
  where exchange.mic in ('ARCX', 'XNAS')
    and not exists (
      select 1
      from public.market_sessions as existing
      where existing.exchange_id = exchange.id
        and existing.session_date = day_value.session_date
    )
  order by exchange.mic, day_value.session_date;

  insert into private.audit_log (
    owner_id,
    actor_type,
    actor_id,
    action,
    target_type,
    target_id,
    correlation_id,
    metadata
  ) values (
    v_owner_id,
    'owner',
    v_owner_id,
    'market.official_calendar_configured',
    'market_calendar_manifest',
    v_manifest.id,
    p_operation_id,
    jsonb_build_object(
      'calendar_year', 2026,
      'contract_version', 1,
      'exchange_count', 2,
      'manifest_id', v_manifest_id,
      'manifest_reused', v_manifest_reused,
      'paper_only', true,
      'provider_request_made', false,
      'scheduler_enabled', false,
      'session_count', 522,
      'source_count', 2
    )
  );

  if private.reviewed_hosted_official_calendar_manifest_id(
    v_owner_id,
    v_manifest.id,
    v_effective_at
  ) is distinct from v_manifest_id then
    raise exception using
      errcode = '55000',
      message = 'official calendar configuration failed its reviewed manifest postcondition';
  end if;

  update private.idempotency_records
  set status = 'completed',
      result_ref_type = 'market_calendar_manifest',
      result_ref_id = v_manifest.id,
      completed_at = statement_timestamp()
  where id = v_idempotency.id
    and owner_id = v_owner_id;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'official calendar operation could not finalize its idempotency record';
  end if;

  return query
  select
    p_operation_id,
    'configured'::text,
    v_manifest.id,
    2,
    522,
    false;
end;
$$;

create function public.configure_hosted_official_calendar_manifest(
  p_operation_id uuid
)
returns table (
  operation_id uuid,
  status text,
  manifest_record_id uuid,
  source_count integer,
  session_count integer,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.configure_hosted_official_calendar_manifest(p_operation_id);
$$;

create function public.hosted_official_calendar_state()
returns table (
  owner_id uuid,
  decision_at timestamptz,
  configured boolean,
  manifest_id text,
  manifest_record_id uuid,
  calendar_year integer,
  exchange_count integer,
  session_count integer,
  regular_session_count integer,
  early_close_session_count integer,
  closed_session_count integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_decision_at timestamptz := statement_timestamp();
  v_manifest public.market_calendar_manifests%rowtype;
  v_reviewed_manifest_id text;
begin
  if v_owner_id is null or not (select private.current_user_is_owner()) then
    raise exception using
      errcode = '42501',
      message = 'active owner authentication required';
  end if;

  select manifest.*
  into v_manifest
  from public.market_calendar_manifests as manifest
  where manifest.owner_id = v_owner_id
    and manifest.manifest_id = 'capital_lab_us_equities_calendar_2026_v1';

  if found then
    v_reviewed_manifest_id := private.reviewed_hosted_official_calendar_manifest_id(
      v_owner_id,
      v_manifest.id,
      v_decision_at
    );
  end if;

  return query
  select
    v_owner_id,
    v_decision_at,
    coalesce(
      v_reviewed_manifest_id = 'capital_lab_us_equities_calendar_2026_v1',
      false
    ),
    v_reviewed_manifest_id,
    case when v_reviewed_manifest_id is not null then v_manifest.id else null::uuid end,
    2026,
    case when v_reviewed_manifest_id is not null then 2 else 0 end,
    case when v_reviewed_manifest_id is not null then 522 else 0 end,
    case when v_reviewed_manifest_id is not null then 498 else 0 end,
    case when v_reviewed_manifest_id is not null then 4 else 0 end,
    case when v_reviewed_manifest_id is not null then 20 else 0 end;
end;
$$;

revoke all on function private.reviewed_hosted_official_calendar_manifest_id(uuid, uuid, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function private.configure_hosted_official_calendar_manifest(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.configure_hosted_official_calendar_manifest(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.hosted_official_calendar_state()
from public, anon, authenticated, service_role;

grant execute on function private.reviewed_hosted_official_calendar_manifest_id(uuid, uuid, timestamptz)
to authenticated, service_role;
grant execute on function private.configure_hosted_official_calendar_manifest(uuid)
to authenticated;
grant execute on function public.configure_hosted_official_calendar_manifest(uuid)
to authenticated;
grant execute on function public.hosted_official_calendar_state()
to authenticated, service_role;

comment on table public.market_calendar_manifests is
'Append-only owner reviews of fixed official market-session manifests. A manifest attests reference evidence only and authorizes no scheduler, provider, AI, or trading action.';
comment on function public.configure_hosted_official_calendar_manifest(uuid) is
'Owner-only, idempotent persistence of the fixed 2026 XNAS/ARCX official regular-session calendar. Performs no runtime provider request and enables no source or scheduler.';
comment on function public.hosted_official_calendar_state() is
'Owner-only, read-only attestation of the complete fixed 2026 XNAS/ARCX official regular-session calendar at one database decision timestamp.';

commit;
