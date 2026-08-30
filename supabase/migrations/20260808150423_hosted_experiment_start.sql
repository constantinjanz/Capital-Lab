begin;

create table public.experiment_start_manifests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(user_id) on delete restrict,
  manifest_id text not null check (manifest_id ~ '^[a-z0-9_]+$'),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  reviewed_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (owner_id, manifest_id),
  unique (id, owner_id)
);

create trigger experiment_start_manifests_reject_mutation
before update or delete on public.experiment_start_manifests
for each row execute function private.reject_mutation();

alter table public.experiment_start_manifests enable row level security;
alter table public.experiment_start_manifests force row level security;

create policy owner_read
on public.experiment_start_manifests
for select
to authenticated
using (
  owner_id = (select auth.uid())
  and private.current_user_is_owner()
);

revoke all privileges on table public.experiment_start_manifests
from public, anon, authenticated, service_role;
grant select on table public.experiment_start_manifests to authenticated;
grant all privileges on table public.experiment_start_manifests to service_role;

alter table public.experiment_versions
add column start_manifest_id uuid,
add column market_calendar_manifest_id uuid;

alter table public.experiment_versions
add constraint experiment_versions_start_manifest_fk
foreign key (start_manifest_id, owner_id)
references public.experiment_start_manifests(id, owner_id)
on delete restrict,
add constraint experiment_versions_market_calendar_manifest_fk
foreign key (market_calendar_manifest_id, owner_id)
references public.market_calendar_manifests(id, owner_id)
on delete restrict;

create index experiment_versions_start_manifest_idx
on public.experiment_versions(start_manifest_id, owner_id)
where start_manifest_id is not null;

create index experiment_versions_market_calendar_manifest_idx
on public.experiment_versions(market_calendar_manifest_id, owner_id)
where market_calendar_manifest_id is not null;

create or replace view public.experiment_detail_read_view
with (security_invoker = true)
as
select
  experiment.id,
  experiment.owner_id,
  experiment.name,
  experiment.lifecycle_status,
  experiment.execution_mode,
  experiment.base_currency,
  experiment.initial_capital::text as initial_capital,
  experiment.objective,
  experiment.starts_at,
  experiment.ends_at,
  experiment.pause_reason as lifecycle_pause_reason,
  experiment.locked_at,
  experiment.locked_version_id,
  experiment.created_at,
  experiment.updated_at,
  controls.scheduler_enabled,
  controls.agent_enabled,
  controls.emergency_paused,
  controls.pause_reason as control_pause_reason,
  controls.state_version::text as control_state_version,
  controls.created_at as control_created_at,
  controls.updated_at as control_updated_at,
  locked_version.version as locked_version,
  locked_version.initial_capital::text as locked_initial_capital,
  locked_version.base_currency as locked_base_currency,
  locked_version.objective as locked_objective,
  locked_version.content_hash as locked_version_content_hash,
  locked_version.market_universe_id,
  locked_version.simulator_config_version_id,
  locked_version.risk_config_version_id,
  locked_version.model_routing_version_id,
  locked_version.data_source_config_version_id,
  locked_version.agent_prompt_version_id,
  locked_version.knowledge_corpus_version_id,
  locked_version.budget_policy_id,
  locked_version.created_at as locked_version_created_at,
  experiment.draft_revision::text as draft_revision,
  experiment.source_experiment_id,
  locked_version.start_manifest_id,
  locked_version.market_calendar_manifest_id
from public.experiments as experiment
left join public.experiment_controls as controls
  on controls.experiment_id = experiment.id
  and controls.owner_id = experiment.owner_id
left join public.experiment_versions as locked_version
  on locked_version.id = experiment.locked_version_id
  and locked_version.experiment_id = experiment.id
  and locked_version.owner_id = experiment.owner_id;

revoke all on public.experiment_detail_read_view
from public, anon, authenticated, service_role;
grant select on public.experiment_detail_read_view
to authenticated, service_role;

create function private.hosted_experiment_start_scope(
  p_owner_id uuid,
  p_decision_at timestamptz
)
returns table (
  universe_id uuid,
  market_manifest_id text,
  calendar_manifest_record_id uuid,
  calendar_manifest_id text,
  ready boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_universe_id uuid;
  v_calendar_manifest_record_id uuid;
begin
  if p_owner_id is null
    or p_decision_at is null
    or p_owner_id <> (select auth.uid())
    or not (select private.current_user_is_owner())
    or p_decision_at > statement_timestamp()
  then
    raise exception using
      errcode = '42501',
      message = 'hosted experiment start scope is unavailable';
  end if;

  select universe.id
  into v_universe_id
  from public.market_universes as universe
  where universe.owner_id = p_owner_id
    and universe.created_at <= p_decision_at
    and private.reviewed_hosted_market_manifest_id(
      p_owner_id,
      universe.id,
      p_decision_at
    ) = 'capital_lab_us_core_alpaca_iex_v1'
  order by universe.version desc, universe.created_at desc, universe.id
  limit 1;

  if not exists (
    select 1
    from public.sources as source
    join public.source_policies as policy on policy.source_id = source.id
    where source.code = 'alpaca_iex'
      and source.source_type = 'market_data'
      and source.provider = 'alpaca'
      and source.base_url = 'https://data.alpaca.markets'
      and not source.is_mock
      and not source.is_enabled
      and source.created_at <= p_decision_at
      and source.updated_at <= p_decision_at
      and policy.enabled = false
      and policy.effective_from <= p_decision_at
      and policy.effective_to is null
      and policy.created_at <= p_decision_at
      and not exists (
        select 1
        from public.source_policies as later_policy
        where later_policy.source_id = source.id
          and later_policy.effective_from <= p_decision_at
          and later_policy.version > policy.version
      )
  ) then
    v_universe_id := null;
  end if;

  select manifest.id
  into v_calendar_manifest_record_id
  from public.market_calendar_manifests as manifest
  where manifest.owner_id = p_owner_id
    and manifest.manifest_id = 'capital_lab_us_equities_calendar_2026_v1'
    and manifest.reviewed_at <= p_decision_at
    and manifest.created_at <= p_decision_at
    and private.reviewed_hosted_official_calendar_manifest_id(
      p_owner_id,
      manifest.id,
      p_decision_at
    ) = 'capital_lab_us_equities_calendar_2026_v1';

  return query
  select
    v_universe_id,
    case
      when v_universe_id is not null
      then 'capital_lab_us_core_alpaca_iex_v1'::text
      else null::text
    end,
    v_calendar_manifest_record_id,
    case
      when v_calendar_manifest_record_id is not null
      then 'capital_lab_us_equities_calendar_2026_v1'::text
      else null::text
    end,
    v_universe_id is not null and v_calendar_manifest_record_id is not null;
end;
$$;

create function public.hosted_experiment_start_readiness(
  p_experiment_id uuid
)
returns table (
  experiment_id uuid,
  decision_at timestamptz,
  draft_revision text,
  control_state_version text,
  draft_ready boolean,
  start_manifest_id text,
  market_manifest_id text,
  universe_id uuid,
  calendar_manifest_id text,
  calendar_manifest_record_id uuid,
  ready boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_decision_at timestamptz := statement_timestamp();
  v_experiment public.experiments%rowtype;
  v_controls public.experiment_controls%rowtype;
  v_scope record;
  v_draft_ready boolean;
begin
  if v_owner_id is null or not (select private.current_user_is_owner()) then
    raise exception using
      errcode = '42501',
      message = 'hosted experiment start readiness is unavailable';
  end if;

  select experiment.*
  into v_experiment
  from public.experiments as experiment
  where experiment.id = p_experiment_id
    and experiment.owner_id = v_owner_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'hosted experiment start readiness is unavailable';
  end if;

  select controls.*
  into v_controls
  from public.experiment_controls as controls
  where controls.experiment_id = p_experiment_id
    and controls.owner_id = v_owner_id;

  v_draft_ready := found
    and v_experiment.lifecycle_status = 'draft'
    and v_experiment.execution_mode is null
    and v_experiment.starts_at is null
    and v_experiment.ends_at is null
    and v_experiment.pause_reason is null
    and v_experiment.locked_at is null
    and v_experiment.locked_version_id is null
    and not v_controls.scheduler_enabled
    and not v_controls.agent_enabled
    and not v_controls.emergency_paused
    and v_controls.pause_reason is null;

  select *
  into strict v_scope
  from private.hosted_experiment_start_scope(v_owner_id, v_decision_at);

  return query
  select
    p_experiment_id,
    v_decision_at,
    v_experiment.draft_revision::text,
    v_controls.state_version::text,
    v_draft_ready,
    'capital_lab_disabled_runtime_start_v1'::text,
    v_scope.market_manifest_id,
    v_scope.universe_id,
    v_scope.calendar_manifest_id,
    v_scope.calendar_manifest_record_id,
    v_draft_ready and v_scope.ready;
end;
$$;

create function private.start_hosted_draft_experiment(
  p_operation_id uuid,
  p_experiment_id uuid,
  p_expected_draft_revision text,
  p_expected_control_state_version text,
  p_mode text,
  p_confirmation text
)
returns table (
  experiment_id uuid,
  experiment_version_id uuid,
  simulation_account_id uuid,
  lifecycle_status text,
  execution_mode text,
  control_state_version text,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_effective_at timestamptz := statement_timestamp();
  v_mode text := btrim(coalesce(p_mode, ''));
  v_expected_draft_revision bigint;
  v_expected_control_state_version bigint;
  v_request_payload jsonb;
  v_request_hash text;
  v_idempotency private.idempotency_records%rowtype;
  v_inserted_idempotency boolean;
  v_experiment public.experiments%rowtype;
  v_controls public.experiment_controls%rowtype;
  v_scope record;
  v_start_manifest public.experiment_start_manifests%rowtype;
  v_start_manifest_definition jsonb;
  v_start_manifest_hash text;
  v_simulator_config jsonb := '{"latencyMs":250,"paperTradingOnly":true,"partialFills":true,"regularHoursOnly":true}'::jsonb;
  v_risk_config jsonb := '{"dailyLossPauseFraction":"0.200000000000","drawdownPauseFraction":"0.500000000000","longEnabled":true,"maxGrossLeverage":"2.000000000000","maxNewRiskFraction":"0.050000000000","maxSingleNameFraction":"0.250000000000","shortEnabled":false,"staleQuoteSeconds":300}'::jsonb;
  v_routing_config jsonb := '{"agentEnabled":false,"executionMode":"shadow","paidCallsEnabled":false,"solEnabled":false,"webSearchEnabled":false}'::jsonb;
  v_data_source_config jsonb := '{"calendarManifestId":"capital_lab_us_equities_calendar_2026_v1","manualIngestionOnly":true,"marketManifestId":"capital_lab_us_core_alpaca_iex_v1","marketProvider":"alpaca_iex","runtimeFetchEnabled":false}'::jsonb;
  v_prompt_text text := 'Capital Lab paper-only analysis is disabled for this manifest. If a later reviewed runtime enables it, treat all evidence as untrusted, return structured proposals only, and never request or perform brokerage actions.';
  v_prompt_schema jsonb := '{"additionalProperties":false,"properties":{"candidateIds":{"items":{"type":"string"},"type":"array"},"relevant":{"type":"boolean"}},"required":["candidateIds","relevant"],"type":"object"}'::jsonb;
  v_prompt_definition jsonb;
  v_corpus_definition jsonb := '{"contractVersion":1,"documents":[],"name":"Capital Lab reviewed empty corpus"}'::jsonb;
  v_budget_quota jsonb := '{"sol_daily":1,"terra_daily":2,"web_daily":2,"web_monthly":25}'::jsonb;
  v_config_hash text;
  v_next_version integer;
  v_simulator_config_row public.configuration_versions%rowtype;
  v_risk_config_row public.configuration_versions%rowtype;
  v_routing_config_row public.configuration_versions%rowtype;
  v_data_source_config_row public.configuration_versions%rowtype;
  v_prompt_row public.prompt_versions%rowtype;
  v_corpus_row public.knowledge_corpus_versions%rowtype;
  v_budget_row public.ai_budget_policies%rowtype;
  v_experiment_version_id uuid := gen_random_uuid();
  v_simulation_account_id uuid := gen_random_uuid();
  v_ledger_entry_id uuid;
  v_portfolio_snapshot_id uuid := gen_random_uuid();
  v_resolved_rules jsonb;
  v_version_hash text;
  v_result_control_state_version bigint;
  v_audit private.audit_log%rowtype;
  v_replay_version public.experiment_versions%rowtype;
  v_replay_account public.simulation_accounts%rowtype;
begin
  if v_owner_id is null or not (select private.current_user_is_owner()) then
    raise exception using
      errcode = '42501',
      message = 'hosted experiment start is unavailable';
  end if;

  if p_operation_id is null or p_experiment_id is null then
    raise exception using
      errcode = '22023',
      message = 'operation and experiment ids are required';
  end if;

  if p_expected_draft_revision is null
    or p_expected_draft_revision !~ '^(0|[1-9][0-9]*)$'
    or p_expected_control_state_version is null
    or p_expected_control_state_version !~ '^(0|[1-9][0-9]*)$'
  then
    raise exception using
      errcode = '22023',
      message = 'expected revisions must be canonical nonnegative integers';
  end if;

  begin
    v_expected_draft_revision := p_expected_draft_revision::bigint;
    v_expected_control_state_version := p_expected_control_state_version::bigint;
  exception
    when numeric_value_out_of_range then
      raise exception using
        errcode = '22023',
        message = 'expected revisions are outside the supported range';
  end;

  if v_mode not in ('replay', 'shadow') then
    raise exception using
      errcode = '22023',
      message = 'a draft may start only in replay or shadow mode';
  end if;

  if p_confirmation is distinct from (
    case v_mode
      when 'replay' then 'START REPLAY'
      else 'START SHADOW'
    end
  ) then
    raise exception using
      errcode = '22023',
      message = 'exact owner start confirmation is required';
  end if;

  v_request_payload := jsonb_build_object(
    'contract_version', 1,
    'experiment_id', p_experiment_id::text,
    'expected_draft_revision', p_expected_draft_revision,
    'expected_control_state_version', p_expected_control_state_version,
    'execution_mode', v_mode,
    'confirmation', p_confirmation,
    'start_manifest_id', 'capital_lab_disabled_runtime_start_v1'
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
    'experiment.start_hosted_draft.v1',
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
      and record.scope = 'experiment.start_hosted_draft.v1'
      and record.idempotency_key = p_operation_id::text
    for update;

    if v_idempotency.request_hash <> v_request_hash then
      raise exception using
        errcode = '23505',
        message = 'experiment start operation id was reused with different input';
    end if;

    if v_idempotency.status <> 'completed'
      or v_idempotency.result_ref_type <> 'experiment_start'
      or v_idempotency.result_ref_id <> p_experiment_id
    then
      raise exception using
        errcode = '55000',
        message = 'experiment start operation has an inconsistent idempotency record';
    end if;

    select experiment.*
    into strict v_experiment
    from public.experiments as experiment
    where experiment.id = p_experiment_id
      and experiment.owner_id = v_owner_id;

    select version.*
    into strict v_replay_version
    from public.experiment_versions as version
    where version.id = v_experiment.locked_version_id
      and version.experiment_id = p_experiment_id
      and version.owner_id = v_owner_id;

    select account.*
    into strict v_replay_account
    from public.simulation_accounts as account
    where account.experiment_id = p_experiment_id
      and account.owner_id = v_owner_id;

    select audit.*
    into v_audit
    from private.audit_log as audit
    where audit.owner_id = v_owner_id
      and audit.experiment_id = p_experiment_id
      and audit.actor_type = 'owner'
      and audit.actor_id = v_owner_id
      and audit.action = 'experiment.started'
      and audit.target_type = 'experiment'
      and audit.target_id = p_experiment_id
      and audit.correlation_id = p_operation_id;

    if not found
      or v_audit.metadata ->> 'contract_version' <> '1'
      or v_audit.metadata ->> 'paper_only' <> 'true'
      or v_audit.metadata ->> 'scheduler_enabled' <> 'false'
      or v_audit.metadata ->> 'agent_enabled' <> 'false'
      or v_audit.metadata ->> 'provider_request_made' <> 'false'
      or v_audit.metadata ->> 'broker_integration_present' <> 'false'
      or v_audit.metadata ->> 'execution_mode' <> v_mode
      or v_audit.metadata ->> 'experiment_version_id' <> v_replay_version.id::text
      or v_audit.metadata ->> 'simulation_account_id' <> v_replay_account.id::text
      or not exists (
        select 1
        from private.cash_ledger_entries as ledger
        where ledger.owner_id = v_owner_id
          and ledger.experiment_id = p_experiment_id
          and ledger.simulation_account_id = v_replay_account.id
          and ledger.entry_type = 'opening_cash'
          and ledger.source_type = 'experiment'
          and ledger.source_id = p_experiment_id
          and ledger.source_component = 'initial_capital'
          and ledger.amount = v_replay_version.initial_capital
          and ledger.currency = v_replay_version.base_currency
      )
      or not exists (
        select 1
        from public.portfolio_snapshots as snapshot
        where snapshot.owner_id = v_owner_id
          and snapshot.experiment_id = p_experiment_id
          and snapshot.simulation_account_id = v_replay_account.id
          and snapshot.cash_value = v_replay_version.initial_capital
          and snapshot.net_liquidation_value = v_replay_version.initial_capital
          and snapshot.realized_pnl = 0::numeric
          and snapshot.unrealized_pnl = 0::numeric
          and snapshot.gross_exposure = 0::numeric
          and snapshot.net_exposure = 0::numeric
      )
    then
      raise exception using
        errcode = '55000',
        message = 'experiment start result is missing immutable evidence';
    end if;

    return query
    select
      p_experiment_id,
      v_replay_version.id,
      v_replay_account.id,
      'active'::text,
      v_mode,
      v_audit.metadata ->> 'result_control_state_version',
      true;
    return;
  end if;

  -- Shared mutation order: controls, then experiment, then owner manifest lock.
  select controls.*
  into v_controls
  from public.experiment_controls as controls
  where controls.experiment_id = p_experiment_id
    and controls.owner_id = v_owner_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'hosted experiment start is unavailable';
  end if;

  select experiment.*
  into v_experiment
  from public.experiments as experiment
  where experiment.id = p_experiment_id
    and experiment.owner_id = v_owner_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'hosted experiment start is unavailable';
  end if;

  if v_experiment.draft_revision <> v_expected_draft_revision
    or v_controls.state_version <> v_expected_control_state_version
  then
    raise exception using
      errcode = '40001',
      message = 'experiment changed; reload before starting';
  end if;

  if v_experiment.lifecycle_status <> 'draft'
    or v_experiment.execution_mode is not null
    or v_experiment.starts_at is not null
    or v_experiment.ends_at is not null
    or v_experiment.pause_reason is not null
    or v_experiment.locked_at is not null
    or v_experiment.locked_version_id is not null
    or v_controls.scheduler_enabled
    or v_controls.agent_enabled
    or v_controls.emergency_paused
    or v_controls.pause_reason is not null
    or exists (
      select 1
      from public.experiment_versions as existing_version
      where existing_version.experiment_id = p_experiment_id
        and existing_version.owner_id = v_owner_id
    )
    or exists (
      select 1
      from public.simulation_accounts as existing_account
      where existing_account.experiment_id = p_experiment_id
        and existing_account.owner_id = v_owner_id
    )
  then
    raise exception using
      errcode = '55000',
      message = 'only a clean disabled draft may start';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'capital-lab:hosted-experiment-start:' || v_owner_id::text,
      0
    )
  );

  select *
  into strict v_scope
  from private.hosted_experiment_start_scope(v_owner_id, v_effective_at);

  if not v_scope.ready then
    raise exception using
      errcode = '55000',
      message = 'reviewed market and official calendar manifests are required';
  end if;

  if v_mode = 'shadow'
    and extract(year from v_effective_at at time zone 'America/New_York') <> 2026
  then
    raise exception using
      errcode = '55000',
      message = 'shadow start requires a reviewed current-year official calendar';
  end if;

  v_prompt_definition := jsonb_build_object(
    'agent_role', 'luna',
    'system_prompt', v_prompt_text,
    'output_schema', v_prompt_schema
  );
  v_start_manifest_definition := jsonb_build_object(
    'contract_version', 1,
    'manifest_id', 'capital_lab_disabled_runtime_start_v1',
    'paper_trading_only', true,
    'market_manifest_id', 'capital_lab_us_core_alpaca_iex_v1',
    'calendar_manifest_id', 'capital_lab_us_equities_calendar_2026_v1',
    'simulator', v_simulator_config,
    'risk', v_risk_config,
    'model_routing', v_routing_config,
    'data_sources', v_data_source_config,
    'prompt', v_prompt_definition,
    'corpus', v_corpus_definition,
    'budget', jsonb_build_object(
      'currency', 'USD',
      'timezone', 'America/New_York',
      'trading_day_hard_limit', '0.30000000',
      'monthly_soft_limit', '6.30000000',
      'monthly_hard_limit', '10.00000000',
      'lifetime_hard_limit', '50.00000000',
      'quota_config', v_budget_quota
    ),
    'runtime', jsonb_build_object(
      'agent_enabled', false,
      'scheduler_enabled', false,
      'provider_request_made', false,
      'runtime_fetch_enabled', false,
      'broker_integration_present', false
    )
  );
  v_start_manifest_hash := encode(
    extensions.digest(v_start_manifest_definition::text, 'sha256'),
    'hex'
  );

  select manifest.*
  into v_start_manifest
  from public.experiment_start_manifests as manifest
  where manifest.owner_id = v_owner_id
    and manifest.manifest_id = 'capital_lab_disabled_runtime_start_v1';

  if found then
    if v_start_manifest.definition <> v_start_manifest_definition
      or v_start_manifest.content_hash <> v_start_manifest_hash
      or v_start_manifest.reviewed_at > v_effective_at
    then
      raise exception using
        errcode = '23514',
        message = 'experiment start manifest conflicts with the reviewed contract';
    end if;
  else
    insert into public.experiment_start_manifests (
      owner_id,
      manifest_id,
      definition,
      content_hash,
      reviewed_at
    ) values (
      v_owner_id,
      'capital_lab_disabled_runtime_start_v1',
      v_start_manifest_definition,
      v_start_manifest_hash,
      v_effective_at
    )
    returning * into v_start_manifest;
  end if;

  v_config_hash := encode(
    extensions.digest(v_simulator_config::text, 'sha256'),
    'hex'
  );
  select config.*
  into v_simulator_config_row
  from public.configuration_versions as config
  where config.owner_id = v_owner_id
    and config.config_kind = 'simulator'
    and config.content_hash = v_config_hash;
  if found then
    if v_simulator_config_row.schema_version <> 1
      or v_simulator_config_row.name <> 'Capital Lab conservative paper simulator'
      or v_simulator_config_row.config <> v_simulator_config
    then
      raise exception using
        errcode = '23514',
        message = 'reviewed simulator configuration conflicts with existing evidence';
    end if;
  else
    select coalesce(max(config.version), 0) + 1
    into v_next_version
    from public.configuration_versions as config
    where config.owner_id = v_owner_id
      and config.config_kind = 'simulator';
    insert into public.configuration_versions (
      owner_id, config_kind, version, schema_version, name, config, content_hash
    ) values (
      v_owner_id,
      'simulator',
      v_next_version,
      1,
      'Capital Lab conservative paper simulator',
      v_simulator_config,
      v_config_hash
    )
    returning * into v_simulator_config_row;
  end if;

  v_config_hash := encode(
    extensions.digest(v_risk_config::text, 'sha256'),
    'hex'
  );
  select config.*
  into v_risk_config_row
  from public.configuration_versions as config
  where config.owner_id = v_owner_id
    and config.config_kind = 'risk'
    and config.content_hash = v_config_hash;
  if found then
    if v_risk_config_row.schema_version <> 1
      or v_risk_config_row.name <> 'Capital Lab conservative long-only risk'
      or v_risk_config_row.config <> v_risk_config
    then
      raise exception using
        errcode = '23514',
        message = 'reviewed risk configuration conflicts with existing evidence';
    end if;
  else
    select coalesce(max(config.version), 0) + 1
    into v_next_version
    from public.configuration_versions as config
    where config.owner_id = v_owner_id
      and config.config_kind = 'risk';
    insert into public.configuration_versions (
      owner_id, config_kind, version, schema_version, name, config, content_hash
    ) values (
      v_owner_id,
      'risk',
      v_next_version,
      1,
      'Capital Lab conservative long-only risk',
      v_risk_config,
      v_config_hash
    )
    returning * into v_risk_config_row;
  end if;

  v_config_hash := encode(
    extensions.digest(v_routing_config::text, 'sha256'),
    'hex'
  );
  select config.*
  into v_routing_config_row
  from public.configuration_versions as config
  where config.owner_id = v_owner_id
    and config.config_kind = 'model_routing'
    and config.content_hash = v_config_hash;
  if found then
    if v_routing_config_row.schema_version <> 1
      or v_routing_config_row.name <> 'Capital Lab disabled model routing'
      or v_routing_config_row.config <> v_routing_config
    then
      raise exception using
        errcode = '23514',
        message = 'reviewed model routing conflicts with existing evidence';
    end if;
  else
    select coalesce(max(config.version), 0) + 1
    into v_next_version
    from public.configuration_versions as config
    where config.owner_id = v_owner_id
      and config.config_kind = 'model_routing';
    insert into public.configuration_versions (
      owner_id, config_kind, version, schema_version, name, config, content_hash
    ) values (
      v_owner_id,
      'model_routing',
      v_next_version,
      1,
      'Capital Lab disabled model routing',
      v_routing_config,
      v_config_hash
    )
    returning * into v_routing_config_row;
  end if;

  v_config_hash := encode(
    extensions.digest(v_data_source_config::text, 'sha256'),
    'hex'
  );
  select config.*
  into v_data_source_config_row
  from public.configuration_versions as config
  where config.owner_id = v_owner_id
    and config.config_kind = 'data_sources'
    and config.content_hash = v_config_hash;
  if found then
    if v_data_source_config_row.schema_version <> 1
      or v_data_source_config_row.name <> 'Capital Lab reviewed hosted sources, runtime off'
      or v_data_source_config_row.config <> v_data_source_config
    then
      raise exception using
        errcode = '23514',
        message = 'reviewed data-source configuration conflicts with existing evidence';
    end if;
  else
    select coalesce(max(config.version), 0) + 1
    into v_next_version
    from public.configuration_versions as config
    where config.owner_id = v_owner_id
      and config.config_kind = 'data_sources';
    insert into public.configuration_versions (
      owner_id, config_kind, version, schema_version, name, config, content_hash
    ) values (
      v_owner_id,
      'data_sources',
      v_next_version,
      1,
      'Capital Lab reviewed hosted sources, runtime off',
      v_data_source_config,
      v_config_hash
    )
    returning * into v_data_source_config_row;
  end if;

  v_config_hash := encode(
    extensions.digest(v_prompt_definition::text, 'sha256'),
    'hex'
  );
  select prompt.*
  into v_prompt_row
  from public.prompt_versions as prompt
  where prompt.owner_id = v_owner_id
    and prompt.agent_role = 'luna'
    and prompt.content_hash = v_config_hash;
  if found then
    if v_prompt_row.system_prompt <> v_prompt_text
      or v_prompt_row.output_schema <> v_prompt_schema
    then
      raise exception using
        errcode = '23514',
        message = 'reviewed Luna prompt conflicts with existing evidence';
    end if;
  else
    select coalesce(max(prompt.version), 0) + 1
    into v_next_version
    from public.prompt_versions as prompt
    where prompt.owner_id = v_owner_id
      and prompt.agent_role = 'luna';
    insert into public.prompt_versions (
      owner_id,
      agent_role,
      version,
      system_prompt,
      output_schema,
      content_hash
    ) values (
      v_owner_id,
      'luna',
      v_next_version,
      v_prompt_text,
      v_prompt_schema,
      v_config_hash
    )
    returning * into v_prompt_row;
  end if;

  v_config_hash := encode(
    extensions.digest(v_corpus_definition::text, 'sha256'),
    'hex'
  );
  select corpus.*
  into v_corpus_row
  from public.knowledge_corpus_versions as corpus
  where corpus.owner_id = v_owner_id
    and corpus.content_hash = v_config_hash;
  if found then
    if v_corpus_row.name <> 'Capital Lab reviewed empty corpus'
      or v_corpus_row.available_at > v_effective_at
      or exists (
        select 1
        from public.knowledge_corpus_members as member
        where member.corpus_version_id = v_corpus_row.id
          and member.owner_id = v_owner_id
      )
    then
      raise exception using
        errcode = '23514',
        message = 'reviewed empty corpus conflicts with existing evidence';
    end if;
  else
    select coalesce(max(corpus.version), 0) + 1
    into v_next_version
    from public.knowledge_corpus_versions as corpus
    where corpus.owner_id = v_owner_id;
    insert into public.knowledge_corpus_versions (
      owner_id,
      version,
      name,
      content_hash,
      available_at
    ) values (
      v_owner_id,
      v_next_version,
      'Capital Lab reviewed empty corpus',
      v_config_hash,
      v_effective_at
    )
    returning * into v_corpus_row;
  end if;

  select policy.*
  into v_budget_row
  from public.ai_budget_policies as policy
  where policy.owner_id = v_owner_id
    and policy.currency = 'USD'
    and policy.timezone = 'America/New_York'
    and policy.trading_day_hard_limit = 0.30::numeric
    and policy.monthly_soft_limit = 6.30::numeric
    and policy.monthly_hard_limit = 10.00::numeric
    and policy.lifetime_hard_limit = 50.00::numeric
    and policy.quota_config = v_budget_quota
    and policy.effective_from <= v_effective_at
    and policy.effective_to is null
  order by policy.version desc
  limit 1;
  if not found then
    select coalesce(max(policy.version), 0) + 1
    into v_next_version
    from public.ai_budget_policies as policy
    where policy.owner_id = v_owner_id;
    insert into public.ai_budget_policies (
      owner_id,
      version,
      currency,
      timezone,
      trading_day_hard_limit,
      monthly_soft_limit,
      monthly_hard_limit,
      lifetime_hard_limit,
      quota_config,
      effective_from,
      effective_to
    ) values (
      v_owner_id,
      v_next_version,
      'USD',
      'America/New_York',
      0.30::numeric,
      6.30::numeric,
      10.00::numeric,
      50.00::numeric,
      v_budget_quota,
      v_effective_at,
      null
    )
    returning * into v_budget_row;
  end if;

  v_resolved_rules := jsonb_build_object(
    'contract_version', 1,
    'paper_trading_only', true,
    'execution_mode', v_mode,
    'start_manifest', jsonb_build_object(
      'id', v_start_manifest.id,
      'manifest_id', v_start_manifest.manifest_id,
      'content_hash', v_start_manifest.content_hash
    ),
    'market', jsonb_build_object(
      'universe_id', v_scope.universe_id,
      'manifest_id', v_scope.market_manifest_id
    ),
    'calendar', jsonb_build_object(
      'record_id', v_scope.calendar_manifest_record_id,
      'manifest_id', v_scope.calendar_manifest_id
    ),
    'simulator', jsonb_build_object(
      'id', v_simulator_config_row.id,
      'content_hash', v_simulator_config_row.content_hash,
      'config', v_simulator_config_row.config
    ),
    'risk', jsonb_build_object(
      'id', v_risk_config_row.id,
      'content_hash', v_risk_config_row.content_hash,
      'config', v_risk_config_row.config
    ),
    'model_routing', jsonb_build_object(
      'id', v_routing_config_row.id,
      'content_hash', v_routing_config_row.content_hash,
      'config', v_routing_config_row.config
    ),
    'data_sources', jsonb_build_object(
      'id', v_data_source_config_row.id,
      'content_hash', v_data_source_config_row.content_hash,
      'config', v_data_source_config_row.config
    ),
    'prompt', jsonb_build_object(
      'id', v_prompt_row.id,
      'role', v_prompt_row.agent_role,
      'version', v_prompt_row.version,
      'content_hash', v_prompt_row.content_hash
    ),
    'corpus', jsonb_build_object(
      'id', v_corpus_row.id,
      'version', v_corpus_row.version,
      'content_hash', v_corpus_row.content_hash,
      'member_count', 0
    ),
    'budget', jsonb_build_object(
      'id', v_budget_row.id,
      'version', v_budget_row.version,
      'currency', v_budget_row.currency,
      'timezone', v_budget_row.timezone,
      'trading_day_hard_limit', v_budget_row.trading_day_hard_limit::text,
      'monthly_soft_limit', v_budget_row.monthly_soft_limit::text,
      'monthly_hard_limit', v_budget_row.monthly_hard_limit::text,
      'lifetime_hard_limit', v_budget_row.lifetime_hard_limit::text,
      'quota_config', v_budget_row.quota_config
    ),
    'runtime', jsonb_build_object(
      'scheduler_enabled', false,
      'agent_enabled', false,
      'provider_request_made', false,
      'runtime_fetch_enabled', false,
      'broker_integration_present', false
    )
  );
  v_version_hash := encode(
    extensions.digest(
      jsonb_build_object(
        'contract_version', 1,
        'experiment_id', p_experiment_id,
        'version', 1,
        'initial_capital', v_experiment.initial_capital::text,
        'base_currency', v_experiment.base_currency,
        'objective', v_experiment.objective,
        'resolved_rules', v_resolved_rules
      )::text,
      'sha256'
    ),
    'hex'
  );

  insert into public.experiment_versions (
    id,
    experiment_id,
    owner_id,
    version,
    market_universe_id,
    simulator_config_version_id,
    risk_config_version_id,
    model_routing_version_id,
    data_source_config_version_id,
    agent_prompt_version_id,
    knowledge_corpus_version_id,
    budget_policy_id,
    initial_capital,
    base_currency,
    objective,
    resolved_rules,
    content_hash,
    start_manifest_id,
    market_calendar_manifest_id
  ) values (
    v_experiment_version_id,
    p_experiment_id,
    v_owner_id,
    1,
    v_scope.universe_id,
    v_simulator_config_row.id,
    v_risk_config_row.id,
    v_routing_config_row.id,
    v_data_source_config_row.id,
    v_prompt_row.id,
    v_corpus_row.id,
    v_budget_row.id,
    v_experiment.initial_capital,
    v_experiment.base_currency,
    v_experiment.objective,
    v_resolved_rules,
    v_version_hash,
    v_start_manifest.id,
    v_scope.calendar_manifest_record_id
  );

  insert into public.simulation_accounts (
    id,
    experiment_id,
    owner_id,
    base_currency,
    status,
    opened_at
  ) values (
    v_simulation_account_id,
    p_experiment_id,
    v_owner_id,
    v_experiment.base_currency,
    'active',
    v_effective_at
  );

  -- The existing private simulation ledger service remains the sole ledger writer.
  v_ledger_entry_id := private.post_cash_ledger_entry(
    v_owner_id,
    v_simulation_account_id,
    p_experiment_id,
    'experiment:start:v1',
    'opening_cash',
    v_experiment.base_currency,
    v_experiment.initial_capital,
    v_effective_at,
    'experiment',
    p_experiment_id,
    'initial_capital',
    p_operation_id,
    jsonb_build_object(
      'contract_version', 1,
      'experiment_version_id', v_experiment_version_id,
      'start_manifest_id', v_start_manifest.id,
      'paper_only', true
    )
  );

  insert into public.portfolio_snapshots (
    id,
    simulation_account_id,
    experiment_id,
    owner_id,
    as_of,
    base_currency,
    cash_value,
    long_market_value,
    short_market_value,
    net_liquidation_value,
    gross_exposure,
    net_exposure,
    realized_pnl,
    unrealized_pnl,
    buying_power,
    high_water_mark,
    drawdown_fraction,
    valuation_inputs
  ) values (
    v_portfolio_snapshot_id,
    v_simulation_account_id,
    p_experiment_id,
    v_owner_id,
    v_effective_at,
    v_experiment.base_currency,
    v_experiment.initial_capital,
    0::numeric,
    0::numeric,
    v_experiment.initial_capital,
    0::numeric,
    0::numeric,
    0::numeric,
    0::numeric,
    v_experiment.initial_capital * 2::numeric,
    v_experiment.initial_capital,
    0::numeric,
    jsonb_build_object(
      'contract_version', 1,
      'kind', 'opening_cash',
      'ledger_entry_id', v_ledger_entry_id,
      'experiment_version_id', v_experiment_version_id,
      'paper_only', true
    )
  );

  update public.experiments as experiment
  set lifecycle_status = 'active',
      execution_mode = v_mode,
      starts_at = v_effective_at,
      locked_at = v_effective_at,
      locked_version_id = v_experiment_version_id
  where experiment.id = p_experiment_id
    and experiment.owner_id = v_owner_id;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'experiment could not be locked';
  end if;

  update public.experiment_controls as controls
  set scheduler_enabled = false,
      agent_enabled = false,
      emergency_paused = false,
      pause_reason = null,
      state_version = controls.state_version + 1
  where controls.experiment_id = p_experiment_id
    and controls.owner_id = v_owner_id
  returning controls.state_version into v_result_control_state_version;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'experiment controls could not be locked';
  end if;

  insert into public.experiment_status_events (
    experiment_id,
    owner_id,
    from_status,
    to_status,
    from_execution_mode,
    to_execution_mode,
    reason_code,
    reason,
    actor_type,
    correlation_id,
    occurred_at
  ) values (
    p_experiment_id,
    v_owner_id,
    'draft',
    'active',
    null,
    v_mode,
    case v_mode
      when 'replay' then 'owner_started_replay'
      else 'owner_started_shadow'
    end,
    'Owner confirmed the immutable paper-only start manifest',
    'owner',
    p_operation_id,
    v_effective_at
  );

  insert into private.audit_log (
    owner_id,
    experiment_id,
    actor_type,
    actor_id,
    action,
    target_type,
    target_id,
    correlation_id,
    metadata
  ) values (
    v_owner_id,
    p_experiment_id,
    'owner',
    v_owner_id,
    'experiment.started',
    'experiment',
    p_experiment_id,
    p_operation_id,
    jsonb_build_object(
      'contract_version', 1,
      'execution_mode', v_mode,
      'experiment_version_id', v_experiment_version_id,
      'simulation_account_id', v_simulation_account_id,
      'portfolio_snapshot_id', v_portfolio_snapshot_id,
      'ledger_entry_id', v_ledger_entry_id,
      'start_manifest_id', v_start_manifest.id,
      'start_manifest_code', v_start_manifest.manifest_id,
      'market_manifest_id', v_scope.market_manifest_id,
      'calendar_manifest_id', v_scope.calendar_manifest_id,
      'result_control_state_version', v_result_control_state_version::text,
      'paper_only', true,
      'scheduler_enabled', false,
      'agent_enabled', false,
      'provider_request_made', false,
      'broker_integration_present', false,
      'orders_created', 0,
      'fills_created', 0
    )
  );

  update private.idempotency_records
  set status = 'completed',
      result_ref_type = 'experiment_start',
      result_ref_id = p_experiment_id,
      completed_at = statement_timestamp()
  where id = v_idempotency.id
    and owner_id = v_owner_id;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'experiment start could not finalize its idempotency record';
  end if;

  return query
  select
    p_experiment_id,
    v_experiment_version_id,
    v_simulation_account_id,
    'active'::text,
    v_mode,
    v_result_control_state_version::text,
    false;
end;
$$;

create function public.start_hosted_draft_experiment(
  p_operation_id uuid,
  p_experiment_id uuid,
  p_expected_draft_revision text,
  p_expected_control_state_version text,
  p_mode text,
  p_confirmation text
)
returns table (
  experiment_id uuid,
  experiment_version_id uuid,
  simulation_account_id uuid,
  lifecycle_status text,
  execution_mode text,
  control_state_version text,
  replayed boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.start_hosted_draft_experiment(
    p_operation_id,
    p_experiment_id,
    p_expected_draft_revision,
    p_expected_control_state_version,
    p_mode,
    p_confirmation
  );
$$;

revoke all on function private.hosted_experiment_start_scope(uuid, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.hosted_experiment_start_readiness(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.start_hosted_draft_experiment(uuid, uuid, text, text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.start_hosted_draft_experiment(uuid, uuid, text, text, text, text)
from public, anon, authenticated, service_role;

grant execute on function private.hosted_experiment_start_scope(uuid, timestamptz)
to authenticated, service_role;
grant execute on function public.hosted_experiment_start_readiness(uuid)
to authenticated, service_role;
grant execute on function private.start_hosted_draft_experiment(uuid, uuid, text, text, text, text)
to authenticated;
grant execute on function public.start_hosted_draft_experiment(uuid, uuid, text, text, text, text)
to authenticated;

comment on table public.experiment_start_manifests is
'Immutable owner-reviewed definitions for atomic paper-only experiment starts. A manifest enables no provider, scheduler, agent, broker, order, or fill capability.';
comment on function public.hosted_experiment_start_readiness(uuid) is
'Owner-only readiness projection for the fixed hosted replay/shadow start boundary. Returns no credential or environment state.';
comment on function public.start_hosted_draft_experiment(uuid, uuid, text, text, text, text) is
'Owner-only, revision-checked, idempotent start of a disabled-runtime paper replay or shadow experiment with immutable rules and opening simulation evidence.';

commit;
