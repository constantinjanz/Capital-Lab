begin;

create function private.configure_hosted_market_manifest(
  p_operation_id uuid
)
returns table (
  operation_id uuid,
  status text,
  universe_id uuid,
  source_id uuid,
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
  v_scope constant text := 'market.configure_hosted_manifest.v1';
  v_manifest_id constant text := 'capital_lab_us_core_alpaca_iex_v1';
  v_universe_name constant text := 'Capital Lab US Core';
  v_universe_description constant text := 'Owner-reviewed paper-only US core market universe.';
  v_source_code constant text := 'alpaca_iex';
  v_source_name constant text := 'Alpaca IEX Market Data';
  v_source_base_url constant text := 'https://data.alpaca.markets';
  v_policy_allowed_use constant text := 'IEX market data for paper-trading research only; no brokerage, account, or order access.';
  v_policy_licensing constant jsonb := '{"data_only":true,"feed":"iex","paper_trading_only":true}'::jsonb;
  v_request_payload jsonb;
  v_request_hash text;
  v_universe_payload jsonb;
  v_universe_hash text;
  v_idempotency private.idempotency_records%rowtype;
  v_inserted_idempotency boolean;
  v_exchange public.exchanges%rowtype;
  v_exchange_manifest record;
  v_instrument public.instruments%rowtype;
  v_instrument_manifest record;
  v_alias_count integer;
  v_alias_instrument_id uuid;
  v_alias_valid_from timestamptz;
  v_alias_valid_to timestamptz;
  v_source public.sources%rowtype;
  v_policy public.source_policies%rowtype;
  v_audit_metadata jsonb;
  v_replayed_source_id uuid;
  v_current_universe public.market_universes%rowtype;
  v_universe_version integer;
  v_universe_is_exact boolean;
  v_reused_universe boolean := false;
  v_prior_reviewed_manifest boolean := false;
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

  -- Every operation for this owner takes the same lock, including distinct UUIDs.
  -- This makes reference conflict checks and universe version allocation atomic.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'capital-lab:hosted-market-configuration:' || v_owner_id::text,
      0
    )
  );

  v_universe_payload := jsonb_build_object(
    'contract_version', 1,
    'name', v_universe_name,
    'members', jsonb_build_array(
      jsonb_build_object('exchange', 'ARCX', 'symbol', 'QQQ'),
      jsonb_build_object('exchange', 'ARCX', 'symbol', 'SPY'),
      jsonb_build_object('exchange', 'XNAS', 'symbol', 'AAPL'),
      jsonb_build_object('exchange', 'XNAS', 'symbol', 'MSFT'),
      jsonb_build_object('exchange', 'XNAS', 'symbol', 'NVDA')
    )
  );
  v_universe_hash := encode(
    extensions.digest(v_universe_payload::text, 'sha256'),
    'hex'
  );

  v_request_payload := jsonb_build_object(
    'contract_version', 1,
    'manifest_id', v_manifest_id,
    'exchanges', jsonb_build_array(
      jsonb_build_object('country_code', 'US', 'mic', 'ARCX', 'name', 'NYSE Arca', 'timezone', 'America/New_York'),
      jsonb_build_object('country_code', 'US', 'mic', 'XNAS', 'name', 'Nasdaq Stock Market', 'timezone', 'America/New_York')
    ),
    'instruments', jsonb_build_array(
      jsonb_build_object('active_from', null, 'active_to', null, 'alias', 'QQQ', 'alias_provider', 'alpaca', 'asset_class', 'etf', 'currency', 'USD', 'exchange', 'ARCX', 'is_shortable', false, 'is_tradable', true, 'name', 'Invesco QQQ Trust', 'price_increment', '0.01', 'quantity_increment', '1', 'symbol', 'QQQ'),
      jsonb_build_object('active_from', null, 'active_to', null, 'alias', 'SPY', 'alias_provider', 'alpaca', 'asset_class', 'etf', 'currency', 'USD', 'exchange', 'ARCX', 'is_shortable', false, 'is_tradable', true, 'name', 'SPDR S&P 500 ETF Trust', 'price_increment', '0.01', 'quantity_increment', '1', 'symbol', 'SPY'),
      jsonb_build_object('active_from', null, 'active_to', null, 'alias', 'AAPL', 'alias_provider', 'alpaca', 'asset_class', 'equity', 'currency', 'USD', 'exchange', 'XNAS', 'is_shortable', false, 'is_tradable', true, 'name', 'Apple Inc.', 'price_increment', '0.01', 'quantity_increment', '1', 'symbol', 'AAPL'),
      jsonb_build_object('active_from', null, 'active_to', null, 'alias', 'MSFT', 'alias_provider', 'alpaca', 'asset_class', 'equity', 'currency', 'USD', 'exchange', 'XNAS', 'is_shortable', false, 'is_tradable', true, 'name', 'Microsoft Corporation', 'price_increment', '0.01', 'quantity_increment', '1', 'symbol', 'MSFT'),
      jsonb_build_object('active_from', null, 'active_to', null, 'alias', 'NVDA', 'alias_provider', 'alpaca', 'asset_class', 'equity', 'currency', 'USD', 'exchange', 'XNAS', 'is_shortable', false, 'is_tradable', true, 'name', 'NVIDIA Corporation', 'price_increment', '0.01', 'quantity_increment', '1', 'symbol', 'NVDA')
    ),
    'universe', v_universe_payload || jsonb_build_object(
      'description', v_universe_description,
      'locked', true,
      'members_effective_immediately', true
    ),
    'source', jsonb_build_object(
      'base_url', v_source_base_url,
      'code', v_source_code,
      'enabled', false,
      'is_mock', false,
      'name', v_source_name,
      'provider', 'alpaca',
      'source_type', 'market_data'
    ),
    'source_policy', jsonb_build_object(
      'allowed_use', v_policy_allowed_use,
      'effective_immediately', true,
      'effective_to', null,
      'enabled', false,
      'licensing_metadata', v_policy_licensing,
      'requires_authentication', true,
      'retention_days', null,
      'version', 1
    )
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
        message = 'hosted market operation id was reused with a different manifest contract';
    end if;

    if v_idempotency.status <> 'completed'
      or v_idempotency.result_ref_type <> 'market_universe'
      or v_idempotency.result_ref_id is null
    then
      raise exception using
        errcode = '55000',
        message = 'hosted market operation has an inconsistent idempotency record';
    end if;

    if not exists (
      select 1
      from public.market_universes as universe
      where universe.id = v_idempotency.result_ref_id
        and universe.owner_id = v_owner_id
    ) then
      raise exception using
        errcode = '55000',
        message = 'hosted market operation result is missing its configuration evidence';
    end if;

    select audit.metadata
    into v_audit_metadata
    from private.audit_log as audit
    where audit.owner_id = v_owner_id
      and audit.actor_type = 'owner'
      and audit.actor_id = v_owner_id
      and audit.action = 'market.hosted_manifest_configured'
      and audit.target_type = 'market_universe'
      and audit.target_id = v_idempotency.result_ref_id
      and audit.correlation_id = p_operation_id;

    if not found or jsonb_typeof(v_audit_metadata -> 'source_id') <> 'string' then
      raise exception using
        errcode = '55000',
        message = 'hosted market operation result is missing its configuration evidence';
    end if;

    begin
      v_replayed_source_id := (v_audit_metadata ->> 'source_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = '55000',
          message = 'hosted market operation result has invalid configuration evidence';
    end;

    select configured_source.*
    into v_source
    from public.sources as configured_source
    where configured_source.id = v_replayed_source_id;

    if not found
      or v_source.code <> v_source_code
      or v_source.name <> v_source_name
      or v_source.source_type <> 'market_data'
      or v_source.provider <> 'alpaca'
      or v_source.base_url is distinct from v_source_base_url
      or v_source.is_mock
    then
      raise exception using
        errcode = '55000',
        message = 'hosted market operation result is missing its source reference';
    end if;

    if (
      select private.reviewed_hosted_market_manifest_id(
        v_owner_id,
        v_idempotency.result_ref_id,
        v_effective_at
      )
    ) is distinct from v_manifest_id then
      raise exception using
        errcode = '55000',
        message = 'hosted market operation result no longer matches its reviewed manifest';
    end if;

    return query
    select
      p_operation_id,
      'configured'::text,
      v_idempotency.result_ref_id,
      v_replayed_source_id,
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
    select exchange_row.*
    into v_exchange
    from public.exchanges as exchange_row
    where exchange_row.mic = v_exchange_manifest.mic;

    if found then
      if v_exchange.name <> v_exchange_manifest.name
        or v_exchange.timezone <> v_exchange_manifest.timezone
        or v_exchange.country_code <> v_exchange_manifest.country_code
      then
        raise exception using
          errcode = '23514',
          message = format(
            'hosted market exchange %s conflicts with the reviewed manifest',
            v_exchange_manifest.mic
          );
      end if;
    else
      insert into public.exchanges (
        mic,
        name,
        timezone,
        country_code
      ) values (
        v_exchange_manifest.mic,
        v_exchange_manifest.name,
        v_exchange_manifest.timezone,
        v_exchange_manifest.country_code
      );
    end if;
  end loop;

  for v_instrument_manifest in
    select manifest.*
    from (values
      ('ARCX'::text, 'QQQ'::text, 'Invesco QQQ Trust'::text, 'etf'::text),
      ('ARCX'::text, 'SPY'::text, 'SPDR S&P 500 ETF Trust'::text, 'etf'::text),
      ('XNAS'::text, 'AAPL'::text, 'Apple Inc.'::text, 'equity'::text),
      ('XNAS'::text, 'MSFT'::text, 'Microsoft Corporation'::text, 'equity'::text),
      ('XNAS'::text, 'NVDA'::text, 'NVIDIA Corporation'::text, 'equity'::text)
    ) as manifest(exchange_mic, symbol, name, asset_class)
    order by manifest.exchange_mic, manifest.symbol
  loop
    select instrument_row.*
    into v_instrument
    from public.instruments as instrument_row
    join public.exchanges as exchange_row
      on exchange_row.id = instrument_row.primary_exchange_id
    where exchange_row.mic = v_instrument_manifest.exchange_mic
      and instrument_row.symbol = v_instrument_manifest.symbol;

    if found then
      if v_instrument.name <> v_instrument_manifest.name
        or v_instrument.asset_class <> v_instrument_manifest.asset_class
        or v_instrument.currency <> 'USD'
        or v_instrument.price_increment <> 0.01::numeric
        or v_instrument.quantity_increment <> 1::numeric
        or not v_instrument.is_tradable
        or v_instrument.is_shortable
        or v_instrument.active_from is not null
        or v_instrument.active_to is not null
      then
        raise exception using
          errcode = '23514',
          message = format(
            'hosted market instrument %s:%s conflicts with the reviewed manifest',
            v_instrument_manifest.exchange_mic,
            v_instrument_manifest.symbol
          );
      end if;
    else
      insert into public.instruments (
        primary_exchange_id,
        symbol,
        name,
        asset_class,
        currency,
        price_increment,
        quantity_increment,
        is_tradable,
        is_shortable
      )
      select
        exchange_row.id,
        v_instrument_manifest.symbol,
        v_instrument_manifest.name,
        v_instrument_manifest.asset_class,
        'USD',
        0.01::numeric,
        1::numeric,
        true,
        false
      from public.exchanges as exchange_row
      where exchange_row.mic = v_instrument_manifest.exchange_mic;

      if not found then
        raise exception using
          errcode = '55000',
          message = 'hosted market exchange reference disappeared during configuration';
      end if;
    end if;

    select
      count(*)::integer,
      (array_agg(alias_row.instrument_id order by alias_row.id))[1],
      (array_agg(alias_row.valid_from order by alias_row.id))[1],
      (array_agg(alias_row.valid_to order by alias_row.id))[1]
    into
      v_alias_count,
      v_alias_instrument_id,
      v_alias_valid_from,
      v_alias_valid_to
    from public.instrument_aliases as alias_row
    where alias_row.provider = 'alpaca'
      and alias_row.alias = v_instrument_manifest.symbol
      and (
        alias_row.valid_to is null
        or alias_row.valid_to > v_effective_at
      );

    select instrument_row.*
    into strict v_instrument
    from public.instruments as instrument_row
    join public.exchanges as exchange_row
      on exchange_row.id = instrument_row.primary_exchange_id
    where exchange_row.mic = v_instrument_manifest.exchange_mic
      and instrument_row.symbol = v_instrument_manifest.symbol;

    if v_alias_count > 1
      or (v_alias_count = 1 and v_alias_instrument_id <> v_instrument.id)
      or (v_alias_count = 1 and v_alias_valid_to is not null)
      or (
        v_alias_count = 1
        and v_alias_valid_from is not null
        and v_alias_valid_from > v_effective_at
      )
    then
      raise exception using
        errcode = '23514',
        message = format(
          'Alpaca alias %s conflicts with the reviewed manifest',
          v_instrument_manifest.symbol
        );
    end if;

    if v_alias_count = 0 then
      insert into public.instrument_aliases (
        instrument_id,
        provider,
        alias,
        valid_from
      ) values (
        v_instrument.id,
        'alpaca',
        v_instrument_manifest.symbol,
        v_effective_at
      );
    end if;
  end loop;

  if (
    select count(*)
    from public.instrument_aliases as alias_row
    join public.instruments as instrument_row
      on instrument_row.id = alias_row.instrument_id
    join public.exchanges as exchange_row
      on exchange_row.id = instrument_row.primary_exchange_id
    where alias_row.provider = 'alpaca'
      and (
        alias_row.valid_to is null
        or alias_row.valid_to > v_effective_at
      )
      and (
        (exchange_row.mic, instrument_row.symbol) in (
          ('ARCX', 'QQQ'),
          ('ARCX', 'SPY'),
          ('XNAS', 'AAPL'),
          ('XNAS', 'MSFT'),
          ('XNAS', 'NVDA')
        )
        or alias_row.alias in ('QQQ', 'SPY', 'AAPL', 'MSFT', 'NVDA')
      )
  ) <> 5 then
    raise exception using
      errcode = '23514',
      message = 'hosted market aliases conflict with the reviewed manifest';
  end if;

  select exists (
    select 1
    from public.market_universes as universe
    where universe.owner_id = v_owner_id
      and private.reviewed_hosted_market_manifest_id(
        v_owner_id,
        universe.id,
        v_effective_at
      ) = v_manifest_id
  )
  into v_prior_reviewed_manifest;

  select source_row.*
  into v_source
  from public.sources as source_row
  where source_row.code = v_source_code;

  if found then
    if v_source.name <> v_source_name
      or v_source.source_type <> 'market_data'
      or v_source.provider <> 'alpaca'
      or v_source.base_url is distinct from v_source_base_url
      or v_source.is_mock
      or (v_source.is_enabled and not v_prior_reviewed_manifest)
    then
      raise exception using
        errcode = '23514',
        message = 'hosted market source conflicts with the reviewed manifest';
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
      v_source_code,
      v_source_name,
      'market_data',
      'alpaca',
      v_source_base_url,
      false,
      false
    )
    returning * into v_source;
  end if;

  if not v_prior_reviewed_manifest and exists (
    select 1
    from public.source_policies as policy_row
    where policy_row.source_id = v_source.id
      and policy_row.version <> 1
  ) then
    raise exception using
      errcode = '23514',
      message = 'hosted market source has an unreviewed policy version';
  end if;

  select policy_row.*
  into v_policy
  from public.source_policies as policy_row
  where policy_row.source_id = v_source.id
    and policy_row.version = 1;

  if found then
    if v_policy.allowed_use <> v_policy_allowed_use
      or v_policy.licensing_metadata <> v_policy_licensing
      or v_policy.retention_days is not null
      or not v_policy.requires_authentication
      or v_policy.effective_from > v_effective_at
      or (
        not v_prior_reviewed_manifest
        and (v_policy.enabled or v_policy.effective_to is not null)
      )
    then
      raise exception using
        errcode = '23514',
        message = 'hosted market source policy conflicts with the reviewed manifest';
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
      true,
      false,
      v_effective_at,
      null
    );
  end if;

  select universe.*
  into v_current_universe
  from public.market_universes as universe
  where universe.owner_id = v_owner_id
  order by universe.created_at desc, universe.version desc, universe.id
  limit 1;

  if found
    and v_current_universe.name = v_universe_name
    and v_current_universe.content_hash = v_universe_hash
  then
    if v_current_universe.description is distinct from v_universe_description
      or v_current_universe.locked_at is null
    then
      raise exception using
        errcode = '55000',
        message = 'hosted market universe metadata does not match its reviewed manifest';
    end if;

    select
      count(*) = 5
      and count(*) filter (
        where member.valid_to is null
          and member.valid_from <= v_effective_at
          and (exchange_row.mic, instrument_row.symbol) in (
            ('ARCX', 'QQQ'),
            ('ARCX', 'SPY'),
            ('XNAS', 'AAPL'),
            ('XNAS', 'MSFT'),
            ('XNAS', 'NVDA')
          )
      ) = 5
      and count(distinct (exchange_row.mic, instrument_row.symbol)) filter (
        where member.valid_to is null
          and member.valid_from <= v_effective_at
          and (exchange_row.mic, instrument_row.symbol) in (
            ('ARCX', 'QQQ'),
            ('ARCX', 'SPY'),
            ('XNAS', 'AAPL'),
            ('XNAS', 'MSFT'),
            ('XNAS', 'NVDA')
          )
      ) = 5
    into v_universe_is_exact
    from public.market_universe_members as member
    join public.instruments as instrument_row on instrument_row.id = member.instrument_id
    join public.exchanges as exchange_row on exchange_row.id = instrument_row.primary_exchange_id
    where member.universe_id = v_current_universe.id
      and member.owner_id = v_owner_id;

    if not v_universe_is_exact then
      raise exception using
        errcode = '55000',
        message = 'hosted market universe hash does not match its members';
    end if;

    v_reused_universe := true;
  else
    select coalesce(max(universe.version), 0) + 1
    into v_universe_version
    from public.market_universes as universe
    where universe.owner_id = v_owner_id
      and universe.name = v_universe_name;

    insert into public.market_universes (
      owner_id,
      name,
      version,
      description,
      content_hash,
      locked_at
    ) values (
      v_owner_id,
      v_universe_name,
      v_universe_version,
      v_universe_description,
      v_universe_hash,
      v_effective_at
    )
    returning * into v_current_universe;

    insert into public.market_universe_members (
      universe_id,
      owner_id,
      instrument_id,
      valid_from
    )
    select
      v_current_universe.id,
      v_owner_id,
      instrument_row.id,
      v_effective_at
    from public.instruments as instrument_row
    join public.exchanges as exchange_row
      on exchange_row.id = instrument_row.primary_exchange_id
    where (exchange_row.mic, instrument_row.symbol) in (
      ('ARCX', 'QQQ'),
      ('ARCX', 'SPY'),
      ('XNAS', 'AAPL'),
      ('XNAS', 'MSFT'),
      ('XNAS', 'NVDA')
    )
    order by exchange_row.mic, instrument_row.symbol;

    if (select count(*) from public.market_universe_members as member where member.universe_id = v_current_universe.id) <> 5 then
      raise exception using
        errcode = '55000',
        message = 'hosted market universe could not resolve exactly five instruments';
    end if;
  end if;

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
    'market.hosted_manifest_configured',
    'market_universe',
    v_current_universe.id,
    p_operation_id,
    jsonb_build_object(
      'contract_version', 1,
      'manifest_id', v_manifest_id,
      'member_count', 5,
      'paper_only', true,
      'provider_request_made', false,
      'source_code', v_source_code,
      'lifecycle_preserved', v_prior_reviewed_manifest,
      'source_enabled', v_source.is_enabled,
      'source_id', v_source.id,
      'universe_reused', v_reused_universe,
      'universe_version', v_current_universe.version
    )
  );

  if (
    select private.reviewed_hosted_market_manifest_id(
      v_owner_id,
      v_current_universe.id,
      v_effective_at
    )
  ) is distinct from v_manifest_id then
    raise exception using
      errcode = '55000',
      message = 'hosted market configuration failed its reviewed manifest postcondition';
  end if;

  update private.idempotency_records
  set status = 'completed',
      result_ref_type = 'market_universe',
      result_ref_id = v_current_universe.id,
      completed_at = statement_timestamp()
  where id = v_idempotency.id
    and owner_id = v_owner_id;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'hosted market operation could not finalize its idempotency record';
  end if;

  return query
  select
    p_operation_id,
    'configured'::text,
    v_current_universe.id,
    v_source.id,
    false;
end;
$$;

create function public.configure_hosted_market_manifest(
  p_operation_id uuid
)
returns table (
  operation_id uuid,
  status text,
  universe_id uuid,
  source_id uuid,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.configure_hosted_market_manifest(p_operation_id);
$$;

revoke all on function private.configure_hosted_market_manifest(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.configure_hosted_market_manifest(uuid)
from public, anon, authenticated, service_role;

grant execute on function private.configure_hosted_market_manifest(uuid)
to authenticated;
grant execute on function public.configure_hosted_market_manifest(uuid)
to authenticated;

comment on function public.configure_hosted_market_manifest(uuid) is
'Owner-only, idempotent configuration of the fixed paper-only hosted market manifest. Performs no provider request and enables no source, ingestion, or scheduler.';

create function private.reviewed_hosted_market_manifest_id(
  p_owner_id uuid,
  p_universe_id uuid,
  p_decision_at timestamptz
)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  with expected_instruments (
    exchange_mic,
    symbol,
    instrument_name,
    asset_class,
    exchange_name
  ) as (
    values
      ('ARCX'::text, 'QQQ'::text, 'Invesco QQQ Trust'::text, 'etf'::text, 'NYSE Arca'::text),
      ('ARCX'::text, 'SPY'::text, 'SPDR S&P 500 ETF Trust'::text, 'etf'::text, 'NYSE Arca'::text),
      ('XNAS'::text, 'AAPL'::text, 'Apple Inc.'::text, 'equity'::text, 'Nasdaq Stock Market'::text),
      ('XNAS'::text, 'MSFT'::text, 'Microsoft Corporation'::text, 'equity'::text, 'Nasdaq Stock Market'::text),
      ('XNAS'::text, 'NVDA'::text, 'NVIDIA Corporation'::text, 'equity'::text, 'Nasdaq Stock Market'::text)
  ),
  reviewed_source as (
    select source.id
    from public.sources as source
    where source.code = 'alpaca_iex'
      and source.name = 'Alpaca IEX Market Data'
      and source.source_type = 'market_data'
      and source.provider = 'alpaca'
      and source.base_url = 'https://data.alpaca.markets'
      and not source.is_mock
      and source.created_at <= p_decision_at
      and source.updated_at <= p_decision_at
  ),
  reviewed_policy_v1 as (
    select policy.*
    from public.source_policies as policy
    join reviewed_source as source on source.id = policy.source_id
    where policy.version = 1
      and policy.created_at <= p_decision_at
      and policy.effective_from <= p_decision_at
  )
  select case
    when p_owner_id = (select auth.uid())
      and (select private.current_user_is_owner())
      and p_universe_id is not null
      and p_decision_at is not null
      and p_decision_at <= statement_timestamp()
      and exists (
        select 1
        from public.market_universes as universe
        where universe.id = p_universe_id
          and universe.owner_id = p_owner_id
          and universe.name = 'Capital Lab US Core'
          and universe.description = 'Owner-reviewed paper-only US core market universe.'
          and universe.content_hash = encode(
            extensions.digest(
              jsonb_build_object(
                'contract_version', 1,
                'name', 'Capital Lab US Core',
                'members', jsonb_build_array(
                  jsonb_build_object('exchange', 'ARCX', 'symbol', 'QQQ'),
                  jsonb_build_object('exchange', 'ARCX', 'symbol', 'SPY'),
                  jsonb_build_object('exchange', 'XNAS', 'symbol', 'AAPL'),
                  jsonb_build_object('exchange', 'XNAS', 'symbol', 'MSFT'),
                  jsonb_build_object('exchange', 'XNAS', 'symbol', 'NVDA')
                )
              )::text,
              'sha256'
            ),
            'hex'
          )
          and universe.locked_at is not null
          and universe.locked_at <= p_decision_at
          and universe.created_at <= p_decision_at
      )
      and (
        select count(*)
        from public.market_universe_members as member
        where member.owner_id = p_owner_id
          and member.universe_id = p_universe_id
          and member.created_at <= p_decision_at
          and member.valid_from <= p_decision_at
          and member.valid_to is null
      ) = 5
      and not exists (
        select 1
        from expected_instruments as expected
        where not exists (
          select 1
          from public.market_universe_members as member
          join public.instruments as instrument
            on instrument.id = member.instrument_id
          join public.exchanges as exchange
            on exchange.id = instrument.primary_exchange_id
          where member.owner_id = p_owner_id
            and member.universe_id = p_universe_id
            and member.created_at <= p_decision_at
            and member.valid_from <= p_decision_at
            and member.valid_to is null
            and instrument.created_at <= p_decision_at
            and instrument.updated_at <= p_decision_at
            and exchange.created_at <= p_decision_at
            and exchange.updated_at <= p_decision_at
            and exchange.mic = expected.exchange_mic
            and exchange.name = expected.exchange_name
            and exchange.timezone = 'America/New_York'
            and exchange.country_code = 'US'
            and instrument.symbol = expected.symbol
            and instrument.name = expected.instrument_name
            and instrument.asset_class = expected.asset_class
            and instrument.currency = 'USD'
            and instrument.price_increment = 0.01::numeric
            and instrument.quantity_increment = 1::numeric
            and instrument.is_tradable
            and not instrument.is_shortable
            and instrument.active_from is null
            and instrument.active_to is null
        )
      )
      and (
        select count(*)
        from public.instrument_aliases as alias
        join public.instruments as instrument on instrument.id = alias.instrument_id
        join public.exchanges as exchange on exchange.id = instrument.primary_exchange_id
        where alias.provider = 'alpaca'
          and alias.created_at <= p_decision_at
          and (alias.valid_from is null or alias.valid_from <= p_decision_at)
          and alias.valid_to is null
          and (
            exists (
              select 1
              from expected_instruments as expected
              where expected.exchange_mic = exchange.mic
                and expected.symbol = instrument.symbol
            )
            or exists (
              select 1
              from expected_instruments as expected
              where expected.symbol = alias.alias
            )
          )
      ) = 5
      and not exists (
        select 1
        from expected_instruments as expected
        where not exists (
          select 1
          from public.instrument_aliases as alias
          join public.instruments as instrument on instrument.id = alias.instrument_id
          join public.exchanges as exchange on exchange.id = instrument.primary_exchange_id
          where alias.provider = 'alpaca'
            and alias.alias = expected.symbol
            and alias.created_at <= p_decision_at
            and (alias.valid_from is null or alias.valid_from <= p_decision_at)
            and alias.valid_to is null
            and exchange.mic = expected.exchange_mic
            and instrument.symbol = expected.symbol
        )
      )
      and (select count(*) from reviewed_source) = 1
      and (select count(*) from reviewed_policy_v1) = 1
      and exists (
        select 1
        from reviewed_policy_v1 as policy
        where policy.allowed_use = 'IEX market data for paper-trading research only; no brokerage, account, or order access.'
          and policy.licensing_metadata = '{"data_only":true,"feed":"iex","paper_trading_only":true}'::jsonb
          and policy.retention_days is null
          and policy.requires_authentication
      )
      and exists (
        select 1
        from private.audit_log as audit
        join reviewed_source as source
          on audit.metadata ->> 'source_id' = source.id::text
        where audit.owner_id = p_owner_id
          and audit.actor_type = 'owner'
          and audit.actor_id = p_owner_id
          and audit.action = 'market.hosted_manifest_configured'
          and audit.target_type = 'market_universe'
          and audit.target_id = p_universe_id
          and audit.metadata ->> 'manifest_id' = 'capital_lab_us_core_alpaca_iex_v1'
          and audit.occurred_at <= p_decision_at
      )
    then 'capital_lab_us_core_alpaca_iex_v1'::text
    else null::text
  end;
$$;

revoke all on function private.reviewed_hosted_market_manifest_id(uuid, uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function private.reviewed_hosted_market_manifest_id(uuid, uuid, timestamptz)
to authenticated, service_role;

create or replace function public.market_snapshot_scope()
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

  select universe.*
  into v_universe
  from public.market_universes as universe
  where universe.owner_id = v_owner_id
    and universe.created_at <= v_decision_at
  order by universe.created_at desc, universe.version desc, universe.id
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
  from public.sources as source
  where source.source_type = 'market_data'
    and source.created_at <= v_decision_at;
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
        'reviewed_manifest_id', private.reviewed_hosted_market_manifest_id(
          v_owner_id,
          v_universe.id,
          v_decision_at
        ),
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
        select array_agg(source.id order by source.code, source.id)
        from public.sources as source
        where source.source_type = 'market_data'
          and source.created_at <= v_decision_at
      ),
      array[]::uuid[]
    );
end;
$$;

comment on function private.reviewed_hosted_market_manifest_id(uuid, uuid, timestamptz) is
'Returns the fixed reviewed manifest identifier only when the current owner universe, members, references, aliases, source contract, reviewed v1 policy evidence, and configuration audit evidence match at the requested decision timestamp. Runtime source enablement and policy lifecycle fields are deliberately excluded and authorize nothing.';
comment on function public.market_snapshot_scope() is
'Owner-only, read-only atomic selection of the current market configuration, its database decision timestamp, and a database-attested reviewed manifest identifier.';

commit;
