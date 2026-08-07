begin;

-- Manual hosted ingestion is deliberately a database reconciliation boundary.
-- Provider HTTP calls happen in the application adapter. These functions only
-- validate and persist the fixed, owner-reviewed, paper-only Alpaca IEX feed.

create function private.manual_hosted_market_context(
  p_require_enabled boolean
)
returns table (
  owner_id uuid,
  universe_id uuid,
  source_id uuid,
  policy_id uuid,
  policy_version integer,
  enabled boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_at timestamptz := statement_timestamp();
  v_universe_id uuid;
  v_source public.sources%rowtype;
  v_policy public.source_policies%rowtype;
  v_active_policy_count integer;
begin
  if v_owner_id is null or not private.current_user_is_owner() then
    raise exception using
      errcode = '42501',
      message = 'active owner authentication required';
  end if;

  select universe.id
  into v_universe_id
  from public.market_universes as universe
  where universe.owner_id = v_owner_id
    and universe.name = 'Capital Lab US Core'
    and private.reviewed_hosted_market_manifest_id(
      v_owner_id,
      universe.id,
      v_at
    ) = 'capital_lab_us_core_alpaca_iex_v1'
  order by universe.version desc, universe.id
  limit 1;

  if v_universe_id is null then
    raise exception using
      errcode = '55000',
      message = 'exact reviewed hosted market manifest is required';
  end if;

  select source.*
  into v_source
  from public.sources as source
  where source.code = 'alpaca_iex'
    and source.name = 'Alpaca IEX Market Data'
    and source.source_type = 'market_data'
    and source.provider = 'alpaca'
    and source.base_url = 'https://data.alpaca.markets'
    and not source.is_mock;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'exact reviewed hosted market source is required';
  end if;

  select count(*)
  into v_active_policy_count
  from public.source_policies as policy
  where policy.source_id = v_source.id
    and policy.effective_from <= v_at
    and (policy.effective_to is null or policy.effective_to > v_at);

  if v_active_policy_count <> 1 then
    raise exception using
      errcode = '55000',
      message = 'hosted market source must have exactly one current policy';
  end if;

  select policy.*
  into strict v_policy
  from public.source_policies as policy
  where policy.source_id = v_source.id
    and policy.effective_from <= v_at
    and (policy.effective_to is null or policy.effective_to > v_at);

  if v_policy.allowed_use <> 'IEX market data for paper-trading research only; no brokerage, account, or order access.'
    or v_policy.licensing_metadata <> '{"data_only":true,"feed":"iex","paper_trading_only":true}'::jsonb
    or v_policy.retention_days is not null
    or not v_policy.requires_authentication
    or v_source.is_enabled is distinct from v_policy.enabled
  then
    raise exception using
      errcode = '55000',
      message = 'current hosted market policy does not match the reviewed contract';
  end if;

  if p_require_enabled and not v_policy.enabled then
    raise exception using
      errcode = '55000',
      message = 'hosted market source is disabled';
  end if;

  return query
  select
    v_owner_id,
    v_universe_id,
    v_source.id,
    v_policy.id,
    v_policy.version,
    v_policy.enabled;
end;
$$;

revoke all on function private.manual_hosted_market_context(boolean)
from public, anon, authenticated, service_role;

create function private.set_hosted_market_source_enabled(
  p_operation_id uuid,
  p_enabled boolean
)
returns table (
  operation_id uuid,
  status text,
  source_id uuid,
  policy_id uuid,
  policy_version integer,
  enabled boolean,
  replayed boolean,
  effective_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_at timestamptz := statement_timestamp();
  v_scope constant text := 'market.hosted_source_lifecycle.v1';
  v_request_hash text;
  v_context record;
  v_current_policy public.source_policies%rowtype;
  v_result_policy public.source_policies%rowtype;
  v_idempotency private.idempotency_records%rowtype;
  v_inserted_idempotency boolean;
begin
  if v_owner_id is null or not private.current_user_is_owner() then
    raise exception using
      errcode = '42501',
      message = 'active owner authentication required';
  end if;

  if p_operation_id is null or p_enabled is null then
    raise exception using
      errcode = '22023',
      message = 'operation id and enabled state are required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'capital-lab:hosted-market-configuration:' || v_owner_id::text,
      0
    )
  );

  select *
  into strict v_context
  from private.manual_hosted_market_context(false);

  v_request_hash := encode(
    extensions.digest(
      jsonb_build_object(
        'contract_version', 1,
        'enabled', p_enabled,
        'manifest_id', 'capital_lab_us_core_alpaca_iex_v1'
      )::text,
      'sha256'
    ),
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
        message = 'hosted market lifecycle operation id was reused with different input';
    end if;

    if v_idempotency.status <> 'completed'
      or v_idempotency.result_ref_type <> 'source_policy'
      or v_idempotency.result_ref_id is null
    then
      raise exception using
        errcode = '55000',
        message = 'hosted market lifecycle operation has inconsistent idempotency evidence';
    end if;

    select policy.*
    into v_result_policy
    from public.source_policies as policy
    where policy.id = v_idempotency.result_ref_id
      and policy.source_id = v_context.source_id;

    if not found then
      raise exception using
        errcode = '55000',
        message = 'hosted market lifecycle result is missing';
    end if;

    return query
    select
      p_operation_id,
      case when p_enabled then 'enabled' else 'disabled' end::text,
      v_context.source_id,
      v_result_policy.id,
      v_result_policy.version,
      p_enabled,
      true,
      v_result_policy.effective_from;
    return;
  end if;

  if not p_enabled and exists (
    select 1
    from private.ingestion_runs as run
    where run.owner_id = v_owner_id
      and run.source_id = v_context.source_id
      and run.status = 'running'
  ) then
    raise exception using
      errcode = '55000',
      message = 'hosted market source cannot be disabled while ingestion is running';
  end if;

  select policy.*
  into strict v_current_policy
  from public.source_policies as policy
  where policy.id = v_context.policy_id
  for update;

  if v_current_policy.enabled = p_enabled then
    v_result_policy := v_current_policy;
  else
    update public.source_policies as policy
    set effective_to = v_at
    where policy.id = v_current_policy.id;

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
      v_context.source_id,
      (
        select max(policy.version) + 1
        from public.source_policies as policy
        where policy.source_id = v_context.source_id
      ),
      'IEX market data for paper-trading research only; no brokerage, account, or order access.',
      '{"data_only":true,"feed":"iex","paper_trading_only":true}'::jsonb,
      null,
      true,
      p_enabled,
      v_at,
      null
    )
    returning * into v_result_policy;

    update public.sources as source
    set is_enabled = p_enabled
    where source.id = v_context.source_id;
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
    'market.hosted_source_lifecycle_set',
    'source_policy',
    v_result_policy.id,
    p_operation_id,
    jsonb_build_object(
      'contract_version', 1,
      'enabled', p_enabled,
      'manifest_id', 'capital_lab_us_core_alpaca_iex_v1',
      'policy_version', v_result_policy.version,
      'source_code', 'alpaca_iex'
    )
  );

  update private.idempotency_records as record
  set status = 'completed',
      result_ref_type = 'source_policy',
      result_ref_id = v_result_policy.id,
      completed_at = v_at
  where record.id = v_idempotency.id;

  return query
  select
    p_operation_id,
    case when p_enabled then 'enabled' else 'disabled' end::text,
    v_context.source_id,
    v_result_policy.id,
    v_result_policy.version,
    p_enabled,
    false,
    v_result_policy.effective_from;
end;
$$;

create function public.set_hosted_market_source_enabled(
  p_operation_id uuid,
  p_enabled boolean
)
returns table (
  operation_id uuid,
  status text,
  source_id uuid,
  policy_id uuid,
  policy_version integer,
  enabled boolean,
  replayed boolean,
  effective_at timestamptz
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.set_hosted_market_source_enabled(p_operation_id, p_enabled);
$$;

create function private.begin_manual_hosted_market_ingestion(
  p_operation_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz
)
returns table (
  operation_id uuid,
  ingestion_run_id uuid,
  source_id uuid,
  status text,
  window_start timestamptz,
  window_end timestamptz,
  symbols text[],
  replayed boolean,
  started_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_at timestamptz := statement_timestamp();
  v_scope constant text := 'market.manual_hosted_ingestion.begin.v1';
  v_request_hash text;
  v_context record;
  v_idempotency private.idempotency_records%rowtype;
  v_inserted_idempotency boolean;
  v_run private.ingestion_runs%rowtype;
  v_symbols text[];
  v_audit_metadata jsonb;
  v_replay_window_start timestamptz;
  v_replay_window_end timestamptz;
begin
  if v_owner_id is null or not private.current_user_is_owner() then
    raise exception using
      errcode = '42501',
      message = 'active owner authentication required';
  end if;

  if p_operation_id is null
    or p_window_start is null
    or p_window_end is null
    or p_window_end <= p_window_start
    or p_window_end - p_window_start > interval '24 hours'
    or p_window_end > v_at
  then
    raise exception using
      errcode = '22023',
      message = 'ingestion window must be positive, no longer than 24 hours, and completed';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'capital-lab:hosted-market-configuration:' || v_owner_id::text,
      0
    )
  );

  select *
  into strict v_context
  from private.manual_hosted_market_context(false);

  select array_agg(alias.alias order by alias.alias)
  into v_symbols
  from public.market_universe_members as member
  join public.instrument_aliases as alias
    on alias.instrument_id = member.instrument_id
  where member.owner_id = v_owner_id
    and member.universe_id = v_context.universe_id
    and member.valid_from <= v_at
    and (member.valid_to is null or member.valid_to > v_at)
    and alias.provider = 'alpaca'
    and (alias.valid_from is null or alias.valid_from <= v_at)
    and (alias.valid_to is null or alias.valid_to > v_at);

  if v_symbols is distinct from array['AAPL', 'MSFT', 'NVDA', 'QQQ', 'SPY']::text[] then
    raise exception using
      errcode = '55000',
      message = 'reviewed hosted market symbol aliases are inconsistent';
  end if;

  v_request_hash := encode(
    extensions.digest(
      jsonb_build_object(
        'contract_version', 1,
        'manifest_id', 'capital_lab_us_core_alpaca_iex_v1',
        'window_end', p_window_end,
        'window_start', p_window_start
      )::text,
      'sha256'
    ),
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
        message = 'manual ingestion operation id was reused with a different window';
    end if;

    if v_idempotency.result_ref_type <> 'ingestion_run'
      or v_idempotency.result_ref_id is null
    then
      raise exception using
        errcode = '55000',
        message = 'manual ingestion operation has inconsistent idempotency evidence';
    end if;

    select run.*
    into v_run
    from private.ingestion_runs as run
    where run.id = v_idempotency.result_ref_id
      and run.owner_id = v_owner_id
      and run.source_id = v_context.source_id;

    if not found then
      raise exception using
        errcode = '55000',
        message = 'manual ingestion run is missing';
    end if;

    select audit.metadata
    into v_audit_metadata
    from private.audit_log as audit
    where audit.owner_id = v_owner_id
      and audit.action = 'market.manual_hosted_ingestion_started'
      and audit.target_type = 'ingestion_run'
      and audit.target_id = v_run.id
      and audit.correlation_id = p_operation_id;

    begin
      v_replay_window_start := (v_audit_metadata ->> 'window_start')::timestamptz;
      v_replay_window_end := (v_audit_metadata ->> 'window_end')::timestamptz;
    exception
      when invalid_text_representation or datetime_field_overflow then
        raise exception using
          errcode = '55000',
          message = 'manual ingestion run has invalid audit evidence';
    end;

    if v_audit_metadata is null
      or v_replay_window_start is distinct from p_window_start
      or v_replay_window_end is distinct from p_window_end
    then
      raise exception using
        errcode = '55000',
        message = 'manual ingestion run is missing its exact audit evidence';
    end if;

    return query
    select
      p_operation_id,
      v_run.id,
      v_run.source_id,
      v_run.status,
      v_replay_window_start,
      v_replay_window_end,
      v_symbols,
      true,
      v_run.started_at;
    return;
  end if;

  if not v_context.enabled then
    raise exception using
      errcode = '55000',
      message = 'hosted market source is disabled';
  end if;

  insert into private.ingestion_runs (
    owner_id,
    source_id,
    idempotency_key,
    status,
    started_at,
    correlation_id
  ) values (
    v_owner_id,
    v_context.source_id,
    p_operation_id::text,
    'running',
    v_at,
    p_operation_id
  )
  returning * into v_run;

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
    'market.manual_hosted_ingestion_started',
    'ingestion_run',
    v_run.id,
    p_operation_id,
    jsonb_build_object(
      'contract_version', 1,
      'feed', 'iex',
      'manifest_id', 'capital_lab_us_core_alpaca_iex_v1',
      'source_code', 'alpaca_iex',
      'symbols', to_jsonb(v_symbols),
      'window_end', p_window_end,
      'window_start', p_window_start
    )
  );

  update private.idempotency_records as record
  set result_ref_type = 'ingestion_run',
      result_ref_id = v_run.id
  where record.id = v_idempotency.id;

  return query
  select
    p_operation_id,
    v_run.id,
    v_run.source_id,
    v_run.status,
    p_window_start,
    p_window_end,
    v_symbols,
    false,
    v_run.started_at;
end;
$$;

create function public.begin_manual_hosted_market_ingestion(
  p_operation_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz
)
returns table (
  operation_id uuid,
  ingestion_run_id uuid,
  source_id uuid,
  status text,
  window_start timestamptz,
  window_end timestamptz,
  symbols text[],
  replayed boolean,
  started_at timestamptz
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.begin_manual_hosted_market_ingestion(
    p_operation_id,
    p_window_start,
    p_window_end
  );
$$;

create function private.commit_manual_hosted_market_ingestion(
  p_operation_id uuid,
  p_request_metadata jsonb,
  p_quotes jsonb,
  p_bars jsonb,
  p_latency_ms integer
)
returns table (
  operation_id uuid,
  ingestion_run_id uuid,
  source_id uuid,
  status text,
  records_seen integer,
  records_inserted integer,
  records_reused integer,
  records_rejected integer,
  replayed boolean,
  finished_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_at timestamptz := statement_timestamp();
  v_scope constant text := 'market.manual_hosted_ingestion.commit.v1';
  v_decimal_pattern constant text := '^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,12})?$';
  v_context record;
  v_run private.ingestion_runs%rowtype;
  v_idempotency private.idempotency_records%rowtype;
  v_inserted_idempotency boolean;
  v_request_hash text;
  v_start_metadata jsonb;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_quotes_canonical jsonb;
  v_bars_canonical jsonb;
  v_normalized_payload jsonb;
  v_raw_content_hash text;
  v_item jsonb;
  v_keys text[];
  v_symbol text;
  v_instrument_id uuid;
  v_provider_event_at timestamptz;
  v_bar_start timestamptz;
  v_bar_end timestamptz;
  v_bid_price numeric(28,12);
  v_ask_price numeric(28,12);
  v_bid_size numeric(28,12);
  v_ask_size numeric(28,12);
  v_open_price numeric(28,12);
  v_high_price numeric(28,12);
  v_low_price numeric(28,12);
  v_close_price numeric(28,12);
  v_volume numeric(28,12);
  v_provider_record_key text;
  v_content_hash text;
  v_previous_id uuid;
  v_previous_revision integer;
  v_records_seen integer;
  v_records_inserted integer := 0;
  v_records_reused integer := 0;
  v_provider_latest_at timestamptz;
  v_audit_metadata jsonb;
  v_replay_reused integer;
  v_health_checked_at timestamptz;
begin
  if v_owner_id is null or not private.current_user_is_owner() then
    raise exception using
      errcode = '42501',
      message = 'active owner authentication required';
  end if;

  if p_operation_id is null
    or p_request_metadata is null
    or p_quotes is null
    or p_bars is null
    or p_latency_ms is null
    or p_latency_ms < 0
    or p_latency_ms > 120000
  then
    raise exception using
      errcode = '22023',
      message = 'operation, payload, and bounded latency are required';
  end if;

  if jsonb_typeof(p_request_metadata) <> 'object'
    or jsonb_typeof(p_quotes) <> 'array'
    or jsonb_typeof(p_bars) <> 'array'
    or octet_length(p_request_metadata::text) > 4096
    or octet_length(p_quotes::text) > 65536
    or octet_length(p_bars::text) > 8388608
  then
    raise exception using
      errcode = '22023',
      message = 'manual ingestion payload shape or size is invalid';
  end if;

  select array_agg(key order by key)
  into v_keys
  from jsonb_object_keys(p_request_metadata) as keys(key);

  if v_keys is distinct from array['bar_request_ids', 'feed', 'quote_request_id']::text[]
    or p_request_metadata ->> 'feed' <> 'iex'
    or jsonb_typeof(p_request_metadata -> 'quote_request_id') <> 'string'
    or length(p_request_metadata ->> 'quote_request_id') not between 1 and 256
    or (p_request_metadata ->> 'quote_request_id') !~ '^[A-Za-z0-9._:/-]+$'
    or jsonb_typeof(p_request_metadata -> 'bar_request_ids') <> 'array'
    or jsonb_array_length(p_request_metadata -> 'bar_request_ids') > 64
    or exists (
      select 1
      from jsonb_array_elements(p_request_metadata -> 'bar_request_ids') as request_ids(request_id)
      where jsonb_typeof(request_id) <> 'string'
        or length(request_id #>> '{}') not between 1 and 256
        or (request_id #>> '{}') !~ '^[A-Za-z0-9._:/-]+$'
    )
    or (
      select count(*)
      from jsonb_array_elements(p_request_metadata -> 'bar_request_ids') as request_ids(request_id)
    ) <> (
      select count(distinct request_id #>> '{}')
      from jsonb_array_elements(p_request_metadata -> 'bar_request_ids') as request_ids(request_id)
    )
  then
    raise exception using
      errcode = '22023',
      message = 'request metadata does not match the bounded Alpaca IEX contract';
  end if;

  if jsonb_array_length(p_quotes) <> 5
    or jsonb_array_length(p_bars) > 5000
    or (
      jsonb_array_length(p_bars) > 0
      and jsonb_array_length(p_request_metadata -> 'bar_request_ids') = 0
    )
  then
    raise exception using
      errcode = '22023',
      message = 'manual ingestion requires five latest quotes and at most 5000 completed bars';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'capital-lab:hosted-market-configuration:' || v_owner_id::text,
      0
    )
  );

  select *
  into strict v_context
  from private.manual_hosted_market_context(false);

  select run.*
  into v_run
  from private.ingestion_runs as run
  where run.owner_id = v_owner_id
    and run.source_id = v_context.source_id
    and run.idempotency_key = p_operation_id::text
    and run.correlation_id = p_operation_id
  for update;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'manual ingestion run does not exist';
  end if;

  select audit.metadata
  into v_start_metadata
  from private.audit_log as audit
  where audit.owner_id = v_owner_id
    and audit.action = 'market.manual_hosted_ingestion_started'
    and audit.target_type = 'ingestion_run'
    and audit.target_id = v_run.id
    and audit.correlation_id = p_operation_id;

  begin
    v_window_start := (v_start_metadata ->> 'window_start')::timestamptz;
    v_window_end := (v_start_metadata ->> 'window_end')::timestamptz;
  exception
    when invalid_text_representation or datetime_field_overflow then
      raise exception using
        errcode = '55000',
        message = 'manual ingestion run has invalid window evidence';
  end;

  if v_start_metadata is null
    or v_window_start is null
    or v_window_end is null
    or v_start_metadata ->> 'manifest_id' <> 'capital_lab_us_core_alpaca_iex_v1'
  then
    raise exception using
      errcode = '55000',
      message = 'manual ingestion run is missing reviewed start evidence';
  end if;

  select jsonb_agg(value order by value ->> 'symbol')
  into v_quotes_canonical
  from jsonb_array_elements(p_quotes) as quote_values(value);

  select coalesce(
    jsonb_agg(value order by value ->> 'symbol', value ->> 'bar_start'),
    '[]'::jsonb
  )
  into v_bars_canonical
  from jsonb_array_elements(p_bars) as bar_values(value);

  v_normalized_payload := jsonb_build_object(
    'bars', v_bars_canonical,
    'contract_version', 1,
    'feed', 'iex',
    'manifest_id', 'capital_lab_us_core_alpaca_iex_v1',
    'request_metadata', p_request_metadata,
    'quotes', v_quotes_canonical
  );

  v_request_hash := encode(
    extensions.digest(
      jsonb_build_object(
        'latency_ms', p_latency_ms,
        'payload', v_normalized_payload
      )::text,
      'sha256'
    ),
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
        message = 'manual ingestion commit operation id was reused with different input';
    end if;

    if v_idempotency.status <> 'completed'
      or v_idempotency.result_ref_type <> 'ingestion_run'
      or v_idempotency.result_ref_id <> v_run.id
      or v_run.status <> 'completed'
    then
      raise exception using
        errcode = '55000',
        message = 'manual ingestion commit has inconsistent idempotency evidence';
    end if;

    select audit.metadata
    into v_audit_metadata
    from private.audit_log as audit
    where audit.owner_id = v_owner_id
      and audit.action = 'market.manual_hosted_ingestion_committed'
      and audit.target_type = 'ingestion_run'
      and audit.target_id = v_run.id
      and audit.correlation_id = p_operation_id;

    begin
      v_replay_reused := (v_audit_metadata ->> 'records_reused')::integer;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception using
          errcode = '55000',
          message = 'manual ingestion commit has invalid audit evidence';
    end;

    if v_audit_metadata is null or v_replay_reused is null then
      raise exception using
        errcode = '55000',
        message = 'manual ingestion commit is missing audit evidence';
    end if;

    return query
    select
      p_operation_id,
      v_run.id,
      v_run.source_id,
      v_run.status,
      v_run.records_seen,
      v_run.records_inserted,
      v_replay_reused,
      v_run.records_rejected,
      true,
      v_run.finished_at;
    return;
  end if;

  if not v_context.enabled then
    raise exception using
      errcode = '55000',
      message = 'hosted market source is disabled';
  end if;

  if v_run.status <> 'running' then
    raise exception using
      errcode = '55000',
      message = 'manual ingestion run is not running';
  end if;

  -- Validate quote records before any observation insert.
  for v_item in
    select value
    from jsonb_array_elements(v_quotes_canonical) as quote_values(value)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'quote records must be objects';
    end if;

    select array_agg(key order by key)
    into v_keys
    from jsonb_object_keys(v_item) as keys(key);

    if v_keys is distinct from array[
      'ask_price', 'ask_size', 'bid_price', 'bid_size', 'provider_event_at', 'symbol'
    ]::text[]
      or jsonb_typeof(v_item -> 'symbol') <> 'string'
      or jsonb_typeof(v_item -> 'provider_event_at') <> 'string'
      or jsonb_typeof(v_item -> 'bid_price') <> 'string'
      or jsonb_typeof(v_item -> 'ask_price') <> 'string'
      or jsonb_typeof(v_item -> 'bid_size') <> 'string'
      or jsonb_typeof(v_item -> 'ask_size') <> 'string'
      or (v_item ->> 'bid_price') !~ v_decimal_pattern
      or (v_item ->> 'ask_price') !~ v_decimal_pattern
      or (v_item ->> 'bid_size') !~ v_decimal_pattern
      or (v_item ->> 'ask_size') !~ v_decimal_pattern
      or length(v_item ->> 'provider_event_at') not between 1 and 64
    then
      raise exception using
        errcode = '22023',
        message = 'quote record does not match the exact decimal-string contract';
    end if;

    v_symbol := v_item ->> 'symbol';

    if v_symbol not in ('AAPL', 'MSFT', 'NVDA', 'QQQ', 'SPY') then
      raise exception using errcode = '22023', message = 'quote symbol is outside the reviewed manifest';
    end if;

    begin
      v_provider_event_at := (v_item ->> 'provider_event_at')::timestamptz;
      v_bid_price := (v_item ->> 'bid_price')::numeric(28,12);
      v_ask_price := (v_item ->> 'ask_price')::numeric(28,12);
      v_bid_size := (v_item ->> 'bid_size')::numeric(28,12);
      v_ask_size := (v_item ->> 'ask_size')::numeric(28,12);
    exception
      when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
        raise exception using errcode = '22023', message = 'quote value is invalid';
    end;

    if v_provider_event_at > v_at
      or v_bid_price <= 0
      or v_ask_price <= 0
      or v_ask_price < v_bid_price
      or v_bid_size < 0
      or v_ask_size < 0
    then
      raise exception using errcode = '22023', message = 'quote values violate market invariants';
    end if;

    select member.instrument_id
    into v_instrument_id
    from public.market_universe_members as member
    join public.instrument_aliases as alias
      on alias.instrument_id = member.instrument_id
    where member.owner_id = v_owner_id
      and member.universe_id = v_context.universe_id
      and member.valid_from <= v_at
      and (member.valid_to is null or member.valid_to > v_at)
      and alias.provider = 'alpaca'
      and alias.alias = v_symbol
      and (alias.valid_from is null or alias.valid_from <= v_at)
      and (alias.valid_to is null or alias.valid_to > v_at);

    if v_instrument_id is null then
      raise exception using errcode = '55000', message = 'quote alias is not uniquely mapped by the reviewed manifest';
    end if;
  end loop;

  if (
    select array_agg(distinct value ->> 'symbol' order by value ->> 'symbol')
    from jsonb_array_elements(v_quotes_canonical) as quote_values(value)
  ) is distinct from array['AAPL', 'MSFT', 'NVDA', 'QQQ', 'SPY']::text[] then
    raise exception using
      errcode = '22023',
      message = 'latest quote payload must contain each reviewed symbol exactly once';
  end if;

  -- Validate completed one-minute bars before any observation insert.
  for v_item in
    select value
    from jsonb_array_elements(v_bars_canonical) as bar_values(value)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'bar records must be objects';
    end if;

    select array_agg(key order by key)
    into v_keys
    from jsonb_object_keys(v_item) as keys(key);

    if v_keys is distinct from array[
      'bar_end', 'bar_start', 'close_price', 'high_price', 'low_price',
      'open_price', 'symbol', 'volume'
    ]::text[]
      or jsonb_typeof(v_item -> 'symbol') <> 'string'
      or jsonb_typeof(v_item -> 'bar_start') <> 'string'
      or jsonb_typeof(v_item -> 'bar_end') <> 'string'
      or jsonb_typeof(v_item -> 'open_price') <> 'string'
      or jsonb_typeof(v_item -> 'high_price') <> 'string'
      or jsonb_typeof(v_item -> 'low_price') <> 'string'
      or jsonb_typeof(v_item -> 'close_price') <> 'string'
      or jsonb_typeof(v_item -> 'volume') <> 'string'
      or (v_item ->> 'open_price') !~ v_decimal_pattern
      or (v_item ->> 'high_price') !~ v_decimal_pattern
      or (v_item ->> 'low_price') !~ v_decimal_pattern
      or (v_item ->> 'close_price') !~ v_decimal_pattern
      or (v_item ->> 'volume') !~ v_decimal_pattern
      or length(v_item ->> 'bar_start') not between 1 and 64
      or length(v_item ->> 'bar_end') not between 1 and 64
    then
      raise exception using
        errcode = '22023',
        message = 'bar record does not match the exact decimal-string contract';
    end if;

    v_symbol := v_item ->> 'symbol';

    if v_symbol not in ('AAPL', 'MSFT', 'NVDA', 'QQQ', 'SPY') then
      raise exception using errcode = '22023', message = 'bar symbol is outside the reviewed manifest';
    end if;

    begin
      v_bar_start := (v_item ->> 'bar_start')::timestamptz;
      v_bar_end := (v_item ->> 'bar_end')::timestamptz;
      v_open_price := (v_item ->> 'open_price')::numeric(28,12);
      v_high_price := (v_item ->> 'high_price')::numeric(28,12);
      v_low_price := (v_item ->> 'low_price')::numeric(28,12);
      v_close_price := (v_item ->> 'close_price')::numeric(28,12);
      v_volume := (v_item ->> 'volume')::numeric(28,12);
    exception
      when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
        raise exception using errcode = '22023', message = 'bar value is invalid';
    end;

    if v_bar_end - v_bar_start <> interval '1 minute'
      or v_bar_start < v_window_start
      or v_bar_end > v_window_end
      or v_bar_end > v_at
      or v_open_price <= 0
      or v_high_price <= 0
      or v_low_price <= 0
      or v_close_price <= 0
      or v_volume < 0
      or v_high_price < greatest(v_open_price, v_low_price, v_close_price)
      or v_low_price > least(v_open_price, v_high_price, v_close_price)
    then
      raise exception using errcode = '22023', message = 'bar values violate completed one-minute market invariants';
    end if;

    select member.instrument_id
    into v_instrument_id
    from public.market_universe_members as member
    join public.instrument_aliases as alias
      on alias.instrument_id = member.instrument_id
    where member.owner_id = v_owner_id
      and member.universe_id = v_context.universe_id
      and member.valid_from <= v_at
      and (member.valid_to is null or member.valid_to > v_at)
      and alias.provider = 'alpaca'
      and alias.alias = v_symbol
      and (alias.valid_from is null or alias.valid_from <= v_at)
      and (alias.valid_to is null or alias.valid_to > v_at);

    if v_instrument_id is null then
      raise exception using errcode = '55000', message = 'bar alias is not uniquely mapped by the reviewed manifest';
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(v_bars_canonical) as left_bars(left_bar)
    join jsonb_array_elements(v_bars_canonical) as right_bars(right_bar)
      on left_bar ->> 'symbol' = right_bar ->> 'symbol'
     and left_bar ->> 'bar_start' = right_bar ->> 'bar_start'
     and left_bar <> right_bar
  ) or (
    select count(*)
    from jsonb_array_elements(v_bars_canonical) as bar_values(value)
  ) <> (
    select count(distinct (value ->> 'symbol', value ->> 'bar_start'))
    from jsonb_array_elements(v_bars_canonical) as bar_values(value)
  ) then
    raise exception using
      errcode = '22023',
      message = 'bar payload contains duplicate logical records';
  end if;

  v_records_seen := 5 + jsonb_array_length(v_bars_canonical);

  -- Insert quote revisions, or reuse any identical prior revision.
  for v_item in
    select value
    from jsonb_array_elements(v_quotes_canonical) as quote_values(value)
  loop
    v_symbol := v_item ->> 'symbol';
    v_provider_event_at := (v_item ->> 'provider_event_at')::timestamptz;
    v_bid_price := (v_item ->> 'bid_price')::numeric(28,12);
    v_ask_price := (v_item ->> 'ask_price')::numeric(28,12);
    v_bid_size := (v_item ->> 'bid_size')::numeric(28,12);
    v_ask_size := (v_item ->> 'ask_size')::numeric(28,12);

    select member.instrument_id
    into strict v_instrument_id
    from public.market_universe_members as member
    join public.instrument_aliases as alias
      on alias.instrument_id = member.instrument_id
    where member.owner_id = v_owner_id
      and member.universe_id = v_context.universe_id
      and member.valid_from <= v_at
      and (member.valid_to is null or member.valid_to > v_at)
      and alias.provider = 'alpaca'
      and alias.alias = v_symbol
      and (alias.valid_from is null or alias.valid_from <= v_at)
      and (alias.valid_to is null or alias.valid_to > v_at);

    v_provider_record_key := 'alpaca_iex:quote:' || v_symbol || ':' ||
      (extract(epoch from v_provider_event_at)::numeric)::text;
    v_content_hash := encode(
      extensions.digest(
        jsonb_build_object(
          'ask_price', v_ask_price::text,
          'ask_size', v_ask_size::text,
          'bid_price', v_bid_price::text,
          'bid_size', v_bid_size::text,
          'provider_event_epoch', (extract(epoch from v_provider_event_at)::numeric)::text,
          'symbol', v_symbol
        )::text,
        'sha256'
      ),
      'hex'
    );
    v_provider_latest_at := greatest(v_provider_latest_at, v_provider_event_at);

    if exists (
      select 1
      from public.market_quotes as quote
      where quote.owner_id = v_owner_id
        and quote.source_id = v_context.source_id
        and quote.instrument_id = v_instrument_id
        and quote.provider_record_key = v_provider_record_key
        and quote.content_hash = v_content_hash
    ) then
      v_records_reused := v_records_reused + 1;
      continue;
    end if;

    v_previous_id := null;
    v_previous_revision := null;
    select quote.id, quote.revision_no
    into v_previous_id, v_previous_revision
    from public.market_quotes as quote
    where quote.owner_id = v_owner_id
      and quote.source_id = v_context.source_id
      and quote.instrument_id = v_instrument_id
      and quote.provider_record_key = v_provider_record_key
    order by quote.revision_no desc
    limit 1;

    insert into public.market_quotes (
      owner_id,
      instrument_id,
      source_id,
      provider_record_key,
      revision_no,
      correction_state,
      bid_price,
      ask_price,
      bid_size,
      ask_size,
      provider_event_at,
      provider_received_at,
      first_seen_at,
      available_at,
      ingested_at,
      content_hash,
      supersedes_id
    ) values (
      v_owner_id,
      v_instrument_id,
      v_context.source_id,
      v_provider_record_key,
      coalesce(v_previous_revision + 1, 1),
      case when v_previous_id is null then 'original' else 'corrected' end,
      v_bid_price,
      v_ask_price,
      v_bid_size,
      v_ask_size,
      v_provider_event_at,
      null,
      v_at,
      v_at,
      v_at,
      v_content_hash,
      v_previous_id
    );

    v_records_inserted := v_records_inserted + 1;
  end loop;

  -- Insert one-minute bar revisions, or reuse any identical prior revision.
  for v_item in
    select value
    from jsonb_array_elements(v_bars_canonical) as bar_values(value)
  loop
    v_symbol := v_item ->> 'symbol';
    v_bar_start := (v_item ->> 'bar_start')::timestamptz;
    v_bar_end := (v_item ->> 'bar_end')::timestamptz;
    v_open_price := (v_item ->> 'open_price')::numeric(28,12);
    v_high_price := (v_item ->> 'high_price')::numeric(28,12);
    v_low_price := (v_item ->> 'low_price')::numeric(28,12);
    v_close_price := (v_item ->> 'close_price')::numeric(28,12);
    v_volume := (v_item ->> 'volume')::numeric(28,12);

    select member.instrument_id
    into strict v_instrument_id
    from public.market_universe_members as member
    join public.instrument_aliases as alias
      on alias.instrument_id = member.instrument_id
    where member.owner_id = v_owner_id
      and member.universe_id = v_context.universe_id
      and member.valid_from <= v_at
      and (member.valid_to is null or member.valid_to > v_at)
      and alias.provider = 'alpaca'
      and alias.alias = v_symbol
      and (alias.valid_from is null or alias.valid_from <= v_at)
      and (alias.valid_to is null or alias.valid_to > v_at);

    v_provider_record_key := 'alpaca_iex:bar:1m:' || v_symbol || ':' ||
      (extract(epoch from v_bar_start)::numeric)::text;
    v_content_hash := encode(
      extensions.digest(
        jsonb_build_object(
          'bar_end_epoch', (extract(epoch from v_bar_end)::numeric)::text,
          'bar_start_epoch', (extract(epoch from v_bar_start)::numeric)::text,
          'close_price', v_close_price::text,
          'high_price', v_high_price::text,
          'low_price', v_low_price::text,
          'open_price', v_open_price::text,
          'symbol', v_symbol,
          'timeframe', '1m',
          'volume', v_volume::text
        )::text,
        'sha256'
      ),
      'hex'
    );

    if exists (
      select 1
      from public.market_bars as bar
      where bar.owner_id = v_owner_id
        and bar.source_id = v_context.source_id
        and bar.instrument_id = v_instrument_id
        and bar.timeframe = '1m'
        and bar.bar_start = v_bar_start
        and bar.content_hash = v_content_hash
    ) then
      v_records_reused := v_records_reused + 1;
      v_provider_latest_at := greatest(v_provider_latest_at, v_bar_end);
      continue;
    end if;

    v_previous_id := null;
    v_previous_revision := null;
    select bar.id, bar.revision_no
    into v_previous_id, v_previous_revision
    from public.market_bars as bar
    where bar.owner_id = v_owner_id
      and bar.source_id = v_context.source_id
      and bar.instrument_id = v_instrument_id
      and bar.timeframe = '1m'
      and bar.bar_start = v_bar_start
    order by bar.revision_no desc
    limit 1;

    insert into public.market_bars (
      owner_id,
      instrument_id,
      source_id,
      provider_record_key,
      timeframe,
      bar_start,
      bar_end,
      open_price,
      high_price,
      low_price,
      close_price,
      volume,
      revision_no,
      correction_state,
      provider_event_at,
      provider_received_at,
      first_seen_at,
      available_at,
      ingested_at,
      content_hash,
      supersedes_id
    ) values (
      v_owner_id,
      v_instrument_id,
      v_context.source_id,
      v_provider_record_key,
      '1m',
      v_bar_start,
      v_bar_end,
      v_open_price,
      v_high_price,
      v_low_price,
      v_close_price,
      v_volume,
      coalesce(v_previous_revision + 1, 1),
      case when v_previous_id is null then 'original' else 'corrected' end,
      v_bar_end,
      null,
      v_at,
      v_at,
      v_at,
      v_content_hash,
      v_previous_id
    );

    v_records_inserted := v_records_inserted + 1;
    v_provider_latest_at := greatest(v_provider_latest_at, v_bar_end);
  end loop;

  if v_records_inserted + v_records_reused <> v_records_seen then
    raise exception using
      errcode = '55000',
      message = 'manual ingestion reconciliation counters are inconsistent';
  end if;

  v_raw_content_hash := encode(
    extensions.digest(v_normalized_payload::text, 'sha256'),
    'hex'
  );

  insert into private.raw_source_events (
    owner_id,
    source_id,
    external_id,
    content_hash,
    normalized_payload,
    provider_event_at,
    provider_received_at,
    first_seen_at,
    available_at,
    ingested_at,
    correlation_id
  ) values (
    v_owner_id,
    v_context.source_id,
    'manual-alpaca-ingestion:' || p_operation_id::text,
    v_raw_content_hash,
    v_normalized_payload,
    v_provider_latest_at,
    null,
    v_at,
    v_at,
    v_at,
    p_operation_id
  );

  select greatest(
    pg_catalog.clock_timestamp(),
    coalesce(max(health.checked_at) + interval '1 microsecond', pg_catalog.clock_timestamp())
  )
  into v_health_checked_at
  from public.source_health as health
  where health.owner_id = v_owner_id
    and health.source_id = v_context.source_id;

  insert into public.source_health (
    owner_id,
    source_id,
    status,
    checked_at,
    last_success_at,
    latency_ms,
    error_class,
    metadata
  ) values (
    v_owner_id,
    v_context.source_id,
    'healthy',
    v_health_checked_at,
    v_health_checked_at,
    p_latency_ms,
    null,
    jsonb_build_object(
      'contract_version', 1,
      'feed', 'iex',
      'manifest_id', 'capital_lab_us_core_alpaca_iex_v1',
      'records_inserted', v_records_inserted,
      'records_reused', v_records_reused,
      'records_seen', v_records_seen
    )
  );

  update private.ingestion_runs as run
  set status = 'completed',
      finished_at = v_at,
      records_seen = v_records_seen,
      records_inserted = v_records_inserted,
      records_rejected = 0,
      error_class = null
  where run.id = v_run.id
  returning * into v_run;

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
    'market.manual_hosted_ingestion_committed',
    'ingestion_run',
    v_run.id,
    p_operation_id,
    jsonb_build_object(
      'contract_version', 1,
      'feed', 'iex',
      'latency_ms', p_latency_ms,
      'manifest_id', 'capital_lab_us_core_alpaca_iex_v1',
      'records_inserted', v_records_inserted,
      'records_reused', v_records_reused,
      'records_seen', v_records_seen,
      'source_code', 'alpaca_iex'
    )
  );

  update private.idempotency_records as record
  set status = 'completed',
      result_ref_type = 'ingestion_run',
      result_ref_id = v_run.id,
      completed_at = v_at
  where record.owner_id = v_owner_id
    and record.scope = 'market.manual_hosted_ingestion.begin.v1'
    and record.idempotency_key = p_operation_id::text;

  update private.idempotency_records as record
  set status = 'completed',
      result_ref_type = 'ingestion_run',
      result_ref_id = v_run.id,
      completed_at = v_at
  where record.id = v_idempotency.id;

  return query
  select
    p_operation_id,
    v_run.id,
    v_run.source_id,
    v_run.status,
    v_run.records_seen,
    v_run.records_inserted,
    v_records_reused,
    v_run.records_rejected,
    false,
    v_run.finished_at;
end;
$$;

create function public.commit_manual_hosted_market_ingestion(
  p_operation_id uuid,
  p_request_metadata jsonb,
  p_quotes jsonb,
  p_bars jsonb,
  p_latency_ms integer
)
returns table (
  operation_id uuid,
  ingestion_run_id uuid,
  source_id uuid,
  status text,
  records_seen integer,
  records_inserted integer,
  records_reused integer,
  records_rejected integer,
  replayed boolean,
  finished_at timestamptz
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.commit_manual_hosted_market_ingestion(
    p_operation_id,
    p_request_metadata,
    p_quotes,
    p_bars,
    p_latency_ms
  );
$$;

create function private.fail_manual_hosted_market_ingestion(
  p_operation_id uuid,
  p_error_class text,
  p_latency_ms integer
)
returns table (
  operation_id uuid,
  ingestion_run_id uuid,
  source_id uuid,
  status text,
  records_seen integer,
  records_inserted integer,
  records_reused integer,
  records_rejected integer,
  error_class text,
  replayed boolean,
  finished_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_at timestamptz := statement_timestamp();
  v_scope constant text := 'market.manual_hosted_ingestion.fail.v1';
  v_context record;
  v_run private.ingestion_runs%rowtype;
  v_idempotency private.idempotency_records%rowtype;
  v_inserted_idempotency boolean;
  v_request_hash text;
  v_health_status text;
  v_last_success_at timestamptz;
  v_health_checked_at timestamptz;
begin
  if v_owner_id is null or not private.current_user_is_owner() then
    raise exception using
      errcode = '42501',
      message = 'active owner authentication required';
  end if;

  if p_operation_id is null
    or p_error_class is null
    or p_error_class not in (
      'timeout',
      'network_error',
      'http_unauthorized',
      'http_rate_limited',
      'http_server_error',
      'invalid_response',
      'persistence_rejected'
    )
    or p_latency_ms is null
    or p_latency_ms < 0
    or p_latency_ms > 120000
  then
    raise exception using
      errcode = '22023',
      message = 'sanitized allowlisted error class and bounded latency are required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'capital-lab:hosted-market-configuration:' || v_owner_id::text,
      0
    )
  );

  select *
  into strict v_context
  from private.manual_hosted_market_context(false);

  select run.*
  into v_run
  from private.ingestion_runs as run
  where run.owner_id = v_owner_id
    and run.source_id = v_context.source_id
    and run.idempotency_key = p_operation_id::text
    and run.correlation_id = p_operation_id
  for update;

  if not found then
    raise exception using errcode = '55000', message = 'manual ingestion run does not exist';
  end if;

  v_request_hash := encode(
    extensions.digest(
      jsonb_build_object(
        'contract_version', 1,
        'error_class', p_error_class,
        'latency_ms', p_latency_ms,
        'manifest_id', 'capital_lab_us_core_alpaca_iex_v1'
      )::text,
      'sha256'
    ),
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
        message = 'manual ingestion failure operation id was reused with different input';
    end if;

    if v_idempotency.status <> 'completed'
      or v_idempotency.result_ref_type <> 'ingestion_run'
      or v_idempotency.result_ref_id <> v_run.id
      or v_run.status <> 'failed'
      or v_run.error_class <> p_error_class
    then
      raise exception using
        errcode = '55000',
        message = 'manual ingestion failure has inconsistent idempotency evidence';
    end if;

    return query
    select
      p_operation_id,
      v_run.id,
      v_run.source_id,
      v_run.status,
      v_run.records_seen,
      v_run.records_inserted,
      0,
      v_run.records_rejected,
      v_run.error_class,
      true,
      v_run.finished_at;
    return;
  end if;

  if not v_context.enabled then
    raise exception using
      errcode = '55000',
      message = 'hosted market source is disabled';
  end if;

  if v_run.status <> 'running' then
    raise exception using
      errcode = '55000',
      message = 'manual ingestion run is not running';
  end if;

  select max(health.last_success_at)
  into v_last_success_at
  from public.source_health as health
  where health.owner_id = v_owner_id
    and health.source_id = v_context.source_id
    and health.last_success_at is not null;

  select greatest(
    pg_catalog.clock_timestamp(),
    coalesce(max(health.checked_at) + interval '1 microsecond', pg_catalog.clock_timestamp())
  )
  into v_health_checked_at
  from public.source_health as health
  where health.owner_id = v_owner_id
    and health.source_id = v_context.source_id;

  v_health_status := case
    when p_error_class in ('http_unauthorized', 'invalid_response', 'persistence_rejected') then 'unavailable'
    else 'degraded'
  end;

  insert into public.source_health (
    owner_id,
    source_id,
    status,
    checked_at,
    last_success_at,
    latency_ms,
    error_class,
    metadata
  ) values (
    v_owner_id,
    v_context.source_id,
    v_health_status,
    v_health_checked_at,
    v_last_success_at,
    p_latency_ms,
    p_error_class,
    jsonb_build_object(
      'contract_version', 1,
      'feed', 'iex',
      'manifest_id', 'capital_lab_us_core_alpaca_iex_v1'
    )
  );

  update private.ingestion_runs as run
  set status = 'failed',
      finished_at = v_at,
      records_seen = 0,
      records_inserted = 0,
      records_rejected = 0,
      error_class = p_error_class
  where run.id = v_run.id
  returning * into v_run;

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
    'market.manual_hosted_ingestion_failed',
    'ingestion_run',
    v_run.id,
    p_operation_id,
    jsonb_build_object(
      'contract_version', 1,
      'error_class', p_error_class,
      'feed', 'iex',
      'latency_ms', p_latency_ms,
      'manifest_id', 'capital_lab_us_core_alpaca_iex_v1',
      'source_code', 'alpaca_iex'
    )
  );

  update private.idempotency_records as record
  set status = 'failed',
      result_ref_type = 'ingestion_run',
      result_ref_id = v_run.id,
      completed_at = v_at
  where record.owner_id = v_owner_id
    and record.scope = 'market.manual_hosted_ingestion.begin.v1'
    and record.idempotency_key = p_operation_id::text;

  update private.idempotency_records as record
  set status = 'completed',
      result_ref_type = 'ingestion_run',
      result_ref_id = v_run.id,
      completed_at = v_at
  where record.id = v_idempotency.id;

  return query
  select
    p_operation_id,
    v_run.id,
    v_run.source_id,
    v_run.status,
    v_run.records_seen,
    v_run.records_inserted,
    0,
    v_run.records_rejected,
    v_run.error_class,
    false,
    v_run.finished_at;
end;
$$;

create function public.fail_manual_hosted_market_ingestion(
  p_operation_id uuid,
  p_error_class text,
  p_latency_ms integer
)
returns table (
  operation_id uuid,
  ingestion_run_id uuid,
  source_id uuid,
  status text,
  records_seen integer,
  records_inserted integer,
  records_reused integer,
  records_rejected integer,
  error_class text,
  replayed boolean,
  finished_at timestamptz
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.fail_manual_hosted_market_ingestion(
    p_operation_id,
    p_error_class,
    p_latency_ms
  );
$$;

create function private.manual_hosted_market_ingestion_result(
  p_operation_id uuid
)
returns table (
  operation_id uuid,
  ingestion_run_id uuid,
  source_id uuid,
  status text,
  records_seen integer,
  records_inserted integer,
  records_reused integer,
  records_rejected integer,
  error_class text,
  started_at timestamptz,
  finished_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null or not private.current_user_is_owner() then
    raise exception using
      errcode = '42501',
      message = 'active owner authentication required';
  end if;

  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'operation id is required';
  end if;

  return query
  select
    p_operation_id,
    run.id,
    run.source_id,
    run.status,
    run.records_seen,
    run.records_inserted,
    greatest(run.records_seen - run.records_inserted - run.records_rejected, 0),
    run.records_rejected,
    run.error_class,
    run.started_at,
    run.finished_at
  from private.ingestion_runs as run
  join public.sources as source
    on source.id = run.source_id
   and source.code = 'alpaca_iex'
   and source.name = 'Alpaca IEX Market Data'
   and source.source_type = 'market_data'
   and source.provider = 'alpaca'
   and source.base_url = 'https://data.alpaca.markets'
   and not source.is_mock
  where run.owner_id = v_owner_id
    and run.idempotency_key = p_operation_id::text
    and run.correlation_id = p_operation_id;
end;
$$;

create function public.manual_hosted_market_ingestion_result(
  p_operation_id uuid
)
returns table (
  operation_id uuid,
  ingestion_run_id uuid,
  source_id uuid,
  status text,
  records_seen integer,
  records_inserted integer,
  records_reused integer,
  records_rejected integer,
  error_class text,
  started_at timestamptz,
  finished_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.manual_hosted_market_ingestion_result(p_operation_id);
$$;

revoke all on function private.set_hosted_market_source_enabled(uuid, boolean)
from public, anon, authenticated, service_role;
revoke all on function public.set_hosted_market_source_enabled(uuid, boolean)
from public, anon, authenticated, service_role;
revoke all on function private.begin_manual_hosted_market_ingestion(uuid, timestamptz, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.begin_manual_hosted_market_ingestion(uuid, timestamptz, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function private.commit_manual_hosted_market_ingestion(uuid, jsonb, jsonb, jsonb, integer)
from public, anon, authenticated, service_role;
revoke all on function public.commit_manual_hosted_market_ingestion(uuid, jsonb, jsonb, jsonb, integer)
from public, anon, authenticated, service_role;
revoke all on function private.fail_manual_hosted_market_ingestion(uuid, text, integer)
from public, anon, authenticated, service_role;
revoke all on function public.fail_manual_hosted_market_ingestion(uuid, text, integer)
from public, anon, authenticated, service_role;
revoke all on function private.manual_hosted_market_ingestion_result(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.manual_hosted_market_ingestion_result(uuid)
from public, anon, authenticated, service_role;

grant execute on function private.set_hosted_market_source_enabled(uuid, boolean)
to authenticated;
grant execute on function public.set_hosted_market_source_enabled(uuid, boolean)
to authenticated;
grant execute on function private.begin_manual_hosted_market_ingestion(uuid, timestamptz, timestamptz)
to authenticated;
grant execute on function public.begin_manual_hosted_market_ingestion(uuid, timestamptz, timestamptz)
to authenticated;
grant execute on function private.commit_manual_hosted_market_ingestion(uuid, jsonb, jsonb, jsonb, integer)
to authenticated;
grant execute on function public.commit_manual_hosted_market_ingestion(uuid, jsonb, jsonb, jsonb, integer)
to authenticated;
grant execute on function private.fail_manual_hosted_market_ingestion(uuid, text, integer)
to authenticated;
grant execute on function public.fail_manual_hosted_market_ingestion(uuid, text, integer)
to authenticated;
grant execute on function private.manual_hosted_market_ingestion_result(uuid)
to authenticated;
grant execute on function public.manual_hosted_market_ingestion_result(uuid)
to authenticated;

comment on function public.set_hosted_market_source_enabled(uuid, boolean) is
'Owner-only audited enable/disable lifecycle for the exact reviewed Alpaca IEX paper-research source. Performs no provider call.';
comment on function public.begin_manual_hosted_market_ingestion(uuid, timestamptz, timestamptz) is
'Owner-only durable start for a bounded manual hosted Alpaca IEX ingestion. Returns the exact reviewed five-symbol scope.';
comment on function public.commit_manual_hosted_market_ingestion(uuid, jsonb, jsonb, jsonb, integer) is
'Owner-only atomic reconciliation of validated Alpaca IEX response data into append-only raw, quote, bar, health, run, audit, and idempotency evidence.';
comment on function public.fail_manual_hosted_market_ingestion(uuid, text, integer) is
'Owner-only atomic failure finalization using a sanitized allowlisted error class; raw provider error text is never accepted.';
comment on function public.manual_hosted_market_ingestion_result(uuid) is
'Owner-only reconciliation read for a manual hosted market ingestion operation.';

commit;
