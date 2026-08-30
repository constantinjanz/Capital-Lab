-- Fourth independent-review closure. This migration is forward-only and does
-- not alter the bytes of any earlier migration.

begin;

create or replace function private.activation_zero_counters_valid(p_counters jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_typeof(p_counters) = 'object'
    and (select array_agg(key order by key) from jsonb_object_keys(p_counters) as key)
      = array[
        'agent_decisions', 'agent_proposals', 'agent_runs', 'broker_requests',
        'budget_reservations', 'canary_runs', 'fills', 'ledger_entries',
        'market_data_requests', 'model_calls', 'news_requests', 'orders',
        'portfolio_mutations', 'position_mutations', 'provider_requests',
        'sol_executions', 'web_search_requests'
      ]::text[]
    and not exists (
      select 1 from jsonb_each(p_counters) as counter
      where counter.value <> '0'::jsonb
    );
$$;

alter table private.activation_http_responses
  add column response_content_type text check (
    response_content_type is null or response_content_type = 'application/json'
  ),
  add column cache_control_no_store boolean not null default false;

create function private.guard_activation_http_response_transport_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  transport record;
  cache_control text;
begin
  if new.pg_net_request_id is null or to_regclass('net._http_response') is null then
    raise exception using errcode = '55000',
      message = 'durable HTTP evidence requires its exact transport row';
  end if;
  execute $query$
    select true as present, content_type, headers
    from net._http_response where id = $1
  $query$ into transport using new.pg_net_request_id;
  cache_control := lower(coalesce(
    transport.headers ->> 'cache-control',
    transport.headers ->> 'Cache-Control',
    ''
  ));
  if transport.present is distinct from true
    or lower(coalesce(transport.content_type, '')) <> 'application/json'
    or cache_control <> 'no-store'
  then
    raise exception using errcode = '55000',
      message = 'HTTP response metadata is not exact JSON no-store evidence';
  end if;
  new.response_content_type := 'application/json';
  new.cache_control_no_store := true;
  return new;
end;
$$;

create trigger activation_http_responses_validate_transport_metadata
before insert on private.activation_http_responses
for each row execute function private.guard_activation_http_response_transport_metadata();

create function private.assert_activation_submission_binding(
  p_campaign_id uuid,
  p_deployment_role text
)
returns private.activation_deployment_bindings
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  binding private.activation_deployment_bindings%rowtype;
begin
  if p_deployment_role not in ('auth_disabled', 'no_ai_runtime_enabled') then
    raise exception using errcode = '22023', message = 'deployment role is invalid';
  end if;
  select * into strict campaign from private.no_ai_shadow_dry_runs
  where id = p_campaign_id;
  select * into strict binding from private.activation_deployment_bindings
  where campaign_id = campaign.id and deployment_role = p_deployment_role;
  if binding.owner_id <> campaign.owner_id
    or binding.vercel_team_id <> 'team_yqndKHk6nfWGlte1UVLTJOHG'
    or binding.vercel_project_id <> 'prj_pbCNwlmXZLeZprZpsRAfAAhPPXVR'
    or binding.supabase_project_ref <> 'qrnuyibntcxwffrxmrvn'
    or binding.commit_sha <> campaign.prepared_commit_sha
    or binding.environment <> 'production'
    or binding.target <> 'production'
    or binding.ready_state <> 'READY'
    or binding.production_origin <> campaign.production_origin
    or binding.production_host <> campaign.production_host
    or binding.scheduler_path <> campaign.scheduler_path
    or binding.scheduler_url <> campaign.scheduler_url
    or binding.immutable_deployment_origin !~ '^https://[a-z0-9][a-z0-9.-]+\.vercel\.app$'
    or binding.runtime_config_path <> campaign.scheduler_path
    or binding.runtime_config_url
      <> binding.immutable_deployment_origin || campaign.scheduler_path
    or binding.proof_sha256 !~ '^[0-9a-f]{64}$'
    or binding.evidence_hash !~ '^[0-9a-f]{64}$'
    or (p_deployment_role = 'auth_disabled' and (
      binding.scheduler_enabled
      or binding.deployment_id <> campaign.production_deployment_id
    ))
    or (p_deployment_role = 'no_ai_runtime_enabled' and (
      not binding.scheduler_enabled
      or binding.deployment_id = campaign.production_deployment_id
    ))
  then
    raise exception using errcode = '55000',
      message = 'immutable deployment submission binding drifted';
  end if;
  return binding;
end;
$$;

create or replace function private.submit_activation_auth_failure_probes(
  p_campaign_id uuid,
  p_operation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  binding private.activation_deployment_bindings%rowtype;
  requested_probe_kind text;
  probe private.activation_auth_failure_requests%rowtype;
  configured_url text;
  transport_id bigint;
  submitted integer := 0;
begin
  select * into strict campaign from private.no_ai_shadow_dry_runs
  where id = p_campaign_id for update;
  binding := private.assert_activation_submission_binding(
    campaign.id, 'auth_disabled'
  );
  if campaign.state <> 'auth_failure_probes_claimed'
    or (select count(*) from private.activation_auth_failure_requests
      where campaign_id = campaign.id) <> 2
  then
    raise exception using errcode = '55000',
      message = 'auth failure probes require the durable reviewed claim';
  end if;
  perform private.assert_activation_controls(campaign.id, false);
  perform private.assert_activation_job_specs(campaign.id, false);
  perform private.capture_activation_relation_snapshot(
    campaign.id, 'pre_auth_noop', 0
  );
  perform private.verify_activation_vault_scope(campaign.id);
  execute $query$
    select decrypted_secret from vault.decrypted_secrets
    where name = 'capital_lab_scheduler_url'
  $query$ into configured_url;
  if configured_url <> campaign.scheduler_url then
    raise exception using errcode = '55000',
      message = 'scheduler URL drifted before auth failure probes';
  end if;
  foreach requested_probe_kind in array array['missing', 'invalid']
  loop
    select request.* into strict probe
    from private.activation_auth_failure_requests as request
    where request.campaign_id = campaign.id
      and request.probe_kind = requested_probe_kind
    for update;
    if probe.operation_id <> p_operation_id then
      raise exception using errcode = '55000',
        message = 'auth failure probe operation identity drifted';
    end if;
    if probe.pg_net_request_id is not null then
      continue;
    end if;
    execute $query$
      select net.http_post(
        url := $1,
        headers := case when $2 = 'missing'
          then jsonb_build_object('Content-Type', 'application/json')
          else jsonb_build_object('Content-Type', 'application/json',
            'Authorization', 'Bearer deliberately-invalid-activation-probe') end,
        body := '{}'::jsonb,
        timeout_milliseconds := $3
      )
    $query$ into transport_id using binding.runtime_config_url,
      requested_probe_kind, campaign.max_request_seconds * 1000;
    update private.activation_auth_failure_requests
    set pg_net_request_id = transport_id, status = 'submitted',
      submitted_at = statement_timestamp()
    where request_id = probe.request_id;
    submitted := submitted + 1;
  end loop;
  return submitted;
end;
$$;

create or replace function private.submit_activation_auth_noop(
  p_campaign_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  request_row private.activation_auth_noop_requests%rowtype;
  binding private.activation_deployment_bindings%rowtype;
  configured_url text;
  shared_secret text;
  transport_id bigint;
begin
  select * into strict campaign from private.no_ai_shadow_dry_runs
  where id = p_campaign_id for update;
  select * into strict request_row from private.activation_auth_noop_requests
  where campaign_id = campaign.id for update;
  binding := private.assert_activation_submission_binding(
    campaign.id, 'auth_disabled'
  );
  if request_row.pg_net_request_id is not null then
    return request_row.pg_net_request_id;
  end if;
  if request_row.status <> 'prepared' or campaign.state <> 'auth_noop_claimed' then
    raise exception using errcode = '55000',
      message = 'auth no-op must reconcile the existing unknown request';
  end if;
  perform private.assert_activation_controls(campaign.id, false);
  perform private.assert_activation_job_specs(campaign.id, false);
  perform private.verify_activation_vault_scope(campaign.id);
  execute $query$
    select max(case when name = 'capital_lab_scheduler_url' then decrypted_secret end),
      max(case when name = 'capital_lab_scheduler_shared_secret' then decrypted_secret end)
    from vault.decrypted_secrets
    where name in ('capital_lab_scheduler_url', 'capital_lab_scheduler_shared_secret')
  $query$ into configured_url, shared_secret;
  if configured_url <> campaign.scheduler_url or length(shared_secret) < 32 then
    raise exception using errcode = '55000',
      message = 'scheduler request identity changed before submission';
  end if;
  execute $query$
    select net.http_post(
      url := $1,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || $2
      ),
      body := $3,
      timeout_milliseconds := $4
    )
  $query$ into transport_id using binding.runtime_config_url, shared_secret,
    jsonb_build_object(
      'schema_version', 3,
      'mode', 'auth_noop',
      'deployment_role', binding.deployment_role,
      'campaign_id', campaign.id,
      'correlation_id', request_row.correlation_id,
      'request_id', request_row.request_id,
      'nonce', request_row.nonce,
      'expected_deployment_id', binding.deployment_id,
      'expected_project_id', binding.vercel_project_id,
      'expected_commit_sha', campaign.prepared_commit_sha
    ), campaign.max_request_seconds * 1000;
  update private.activation_auth_noop_requests
  set pg_net_request_id = transport_id, status = 'submitted',
    submitted_at = statement_timestamp()
  where request_id = request_row.request_id;
  return transport_id;
end;
$$;

-- Forbidden application relations are prevented before the statement runs.
-- An AFTER trigger that merely records the mutation cannot provide a no-side-
-- effect guarantee because the triggering DML would otherwise commit.
create or replace function private.record_activation_forbidden_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from private.no_ai_shadow_dry_runs
    where state in (
      'auth_endpoint_verified', 'auth_failure_probes_claimed',
      'auth_failures_verified', 'auth_noop_claimed', 'auth_noop_verified',
      'runtime_identity_verified', 'runtime_config_attestation_requested',
      'runtime_config_verified', 'runtime_deployment_verified',
      'baseline_frozen', 'armed', 'running'
    )
  ) then
    raise exception using errcode = '55000',
      message = 'Activation forbids mutation of ' || tg_table_schema || '.' || tg_table_name;
  end if;
  return null;
end;
$$;

do $$
declare
  spec private.activation_forbidden_relation_specs%rowtype;
begin
  for spec in select * from private.activation_forbidden_relation_specs
  loop
    execute format(
      'drop trigger if exists %I on %s',
      replace(spec.relation_name, '.', '_') || '_activation_mutation_guard',
      spec.relation_name
    );
    execute format(
      'create trigger %I before insert or update or delete or truncate on %s '
        || 'for each statement execute function private.record_activation_forbidden_mutation()',
      replace(spec.relation_name, '.', '_') || '_activation_mutation_guard',
      spec.relation_name
    );
  end loop;
end;
$$;

create or replace function private.guard_activation_bounded_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  rule private.activation_expected_mutation_rules%rowtype;
  context_campaign uuid := private.activation_safe_uuid(
    current_setting('capital_lab.activation_campaign_id', true)
  );
  context_operation text := current_setting(
    'capital_lab.activation_operation', true
  );
  context_operation_id uuid := private.activation_safe_uuid(
    current_setting('capital_lab.activation_operation_id', true)
  );
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  changed text[] := array[]::text[];
  row_owner uuid;
  row_key text;
  maximum_rows integer;
  observed_rows integer;
begin
  if context_campaign is null or context_operation_id is null then
    if exists (
      select 1 from private.no_ai_shadow_dry_runs
      where state not in ('passed', 'failed', 'inconclusive', 'aborted')
    ) then
      raise exception using errcode = '55000',
        message = 'activation mutation lacks an exact campaign and operation context';
    end if;
    if tg_op = 'TRUNCATE' then return null;
    elsif tg_op = 'DELETE' then return old;
    else return new;
    end if;
  end if;
  select * into strict campaign from private.no_ai_shadow_dry_runs
  where id = context_campaign
    and (
      context_operation = 'emergency_kill'
      or state not in ('passed', 'failed', 'inconclusive', 'aborted')
    )
  for update;
  if tg_table_schema = 'private' and tg_table_name = 'audit_log' then
    raise exception using errcode = '55000',
      message = 'activation does not permit audit-log side effects';
  end if;
  select * into strict rule from private.activation_expected_mutation_rules
  where relation_name = tg_table_schema || '.' || tg_table_name;
  if tg_op <> all(rule.allowed_operations)
    or (
      context_operation <> 'emergency_kill'
      and campaign.state <> all(rule.allowed_states)
    )
    or tg_op in ('DELETE', 'TRUNCATE')
  then
    raise exception using errcode = '55000',
      message = 'activation bounded mutation violates its operation or state rule';
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(key order by key), array[]::text[])
    into changed from jsonb_object_keys(new_row) as key
    where new_row -> key is distinct from old_row -> key;
    if not changed <@ (case
      when tg_table_schema = 'private'
        and tg_table_name = 'application_settings'
        and context_operation = 'emergency_kill'
      then rule.update_columns || array['is_secret']::text[]
      else rule.update_columns
    end) then
      raise exception using errcode = '55000',
        message = 'activation update changed a forbidden column';
    end if;
  end if;
  row_owner := private.activation_safe_uuid(new_row ->> 'owner_id');
  if row_owner is distinct from campaign.owner_id then
    raise exception using errcode = '55000',
      message = 'activation mutation owner differs from the campaign';
  end if;

  if tg_table_schema = 'private' and tg_table_name = 'application_settings' then
    row_key := new_row ->> 'setting_key';
    maximum_rows := case context_operation
      when 'arm' then 1 when 'emergency_kill' then 9
      when 'control_snapshot' then 2 else 0 end;
    if context_operation = 'arm'
      and campaign.state = 'baseline_frozen'
      and tg_op = 'UPDATE'
      and row_key = 'scheduler_enabled'
      and old_row -> 'value' = 'false'::jsonb
      and new_row -> 'value' = 'true'::jsonb
      and (new_row ->> 'version')::bigint = (old_row ->> 'version')::bigint + 1
    then null;
    elsif context_operation = 'emergency_kill'
      and row_key = any(array[
        'scheduler_enabled', 'agent_enabled',
        'autonomous_paper_execution_enabled', 'paid_model_calls_enabled',
        'openai_canary_enabled', 'openai_web_search_enabled',
        'sol_challenger_enabled', 'sol_live_execution_enabled',
        'real_broker_enabled'
      ]::text[])
      and new_row -> 'value' = 'false'::jsonb
      and new_row -> 'is_secret' = 'false'::jsonb
    then null;
    elsif context_operation = 'control_snapshot'
      and row_key in ('nonessential_raw_ingest_enabled', 'scheduler_enabled')
      and new_row -> 'value' = 'false'::jsonb
      and new_row -> 'is_secret' = 'false'::jsonb
    then null;
    else
      raise exception using errcode = '55000',
        message = 'activation setting mutation is outside the reviewed transition';
    end if;
  elsif tg_table_schema = 'public' and tg_table_name = 'experiment_controls' then
    select count(*) into maximum_rows from public.experiment_controls
    where owner_id = campaign.owner_id;
    if tg_op <> 'UPDATE'
      or new_row -> 'scheduler_enabled' <> 'false'::jsonb
      or new_row -> 'agent_enabled' <> 'false'::jsonb
      or new_row -> 'emergency_paused' <> 'true'::jsonb
      or context_operation not in ('emergency_kill', 'control_snapshot')
      or (context_operation = 'control_snapshot'
        and new_row ->> 'pause_reason' <> 'database_storage_90_percent')
    then
      raise exception using errcode = '55000',
        message = 'activation experiment-control mutation is outside the reviewed transition';
    end if;
  elsif tg_table_schema = 'public' and tg_table_name = 'storage_monitor_snapshots' then
    maximum_rows := 1;
    if tg_op <> 'INSERT' or context_operation <> 'control_snapshot'
      or new_row ->> 'captured_on'
        <> (statement_timestamp() at time zone 'UTC')::date::text
    then
      raise exception using errcode = '55000',
        message = 'activation storage mutation is outside the reviewed transition';
    end if;
  else
    raise exception using errcode = '55000',
      message = 'activation mutation guard was attached to an unknown relation';
  end if;
  select count(*) into observed_rows
  from private.activation_mutation_evidence
  where campaign_id = campaign.id
    and operation_id = context_operation_id
    and relation_name = tg_table_schema || '.' || tg_table_name;
  if maximum_rows <= 0 or observed_rows >= maximum_rows then
    raise exception using errcode = '55000',
      message = 'activation mutation exceeded its operation cardinality';
  end if;
  insert into private.activation_mutation_evidence (
    campaign_id, owner_id, relation_name, mutation_kind,
    operation_id, expected_mutation, row_identity, changed_columns
  ) values (
    campaign.id, campaign.owner_id, tg_table_schema || '.' || tg_table_name,
    tg_op, context_operation_id, true,
    jsonb_build_object(
      'owner_id', campaign.owner_id,
      'setting_key', case when tg_table_name = 'application_settings' then row_key else null end,
      'row_id', case when new_row ? 'id' then new_row ->> 'id' else null end
    ), changed
  );
  return new;
end;
$$;

create or replace function private.emergency_kill_activation_controls(
  p_campaign_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  safe_setting_count integer;
begin
  select * into strict campaign from private.no_ai_shadow_dry_runs
  where id = p_campaign_id for update;
  select count(*) into safe_setting_count
  from private.application_settings
  where owner_id = campaign.owner_id
    and setting_key = any(array[
      'scheduler_enabled', 'agent_enabled',
      'autonomous_paper_execution_enabled', 'paid_model_calls_enabled',
      'openai_canary_enabled', 'openai_web_search_enabled',
      'sol_challenger_enabled', 'sol_live_execution_enabled',
      'real_broker_enabled'
    ]::text[])
    and value = 'false'::jsonb and not is_secret;
  if safe_setting_count = 9
    and not exists (
      select 1 from public.experiment_controls
      where owner_id = campaign.owner_id
        and (scheduler_enabled or agent_enabled or not emergency_paused)
    )
    and not campaign.scheduler_control_enabled
    and campaign.state in ('auto_stopped', 'passed', 'failed', 'inconclusive', 'aborted')
  then
    return;
  end if;
  perform set_config('capital_lab.activation_campaign_id', campaign.id::text, true);
  perform set_config('capital_lab.activation_operation', 'emergency_kill', true);
  perform set_config('capital_lab.activation_operation_id', campaign.id::text, true);
  insert into private.application_settings (
    owner_id, setting_key, value, is_secret
  )
  select campaign.owner_id, key_name, 'false'::jsonb, false
  from unnest(array[
    'scheduler_enabled', 'agent_enabled',
    'autonomous_paper_execution_enabled', 'paid_model_calls_enabled',
    'openai_canary_enabled', 'openai_web_search_enabled',
    'sol_challenger_enabled', 'sol_live_execution_enabled',
    'real_broker_enabled'
  ]) as key_name
  on conflict (owner_id, setting_key) do update
  set value = 'false'::jsonb,
      is_secret = false,
      version = case when private.application_settings.value = 'false'::jsonb
        and not private.application_settings.is_secret
        then private.application_settings.version
        else private.application_settings.version + 1 end;
  update public.experiment_controls
  set scheduler_enabled = false, agent_enabled = false,
      emergency_paused = true,
      pause_reason = coalesce(pause_reason, 'activation_emergency_kill'),
      state_version = case when scheduler_enabled or agent_enabled or not emergency_paused
        then state_version + 1 else state_version end
  where owner_id = campaign.owner_id
    and (scheduler_enabled or agent_enabled or not emergency_paused);
  select count(*) into safe_setting_count
  from private.application_settings
  where owner_id = campaign.owner_id
    and setting_key = any(array[
      'scheduler_enabled', 'agent_enabled',
      'autonomous_paper_execution_enabled', 'paid_model_calls_enabled',
      'openai_canary_enabled', 'openai_web_search_enabled',
      'sol_challenger_enabled', 'sol_live_execution_enabled',
      'real_broker_enabled'
    ]::text[])
    and value = 'false'::jsonb and not is_secret;
  if safe_setting_count <> 9 or exists (
    select 1 from public.experiment_controls
    where owner_id = campaign.owner_id
      and (scheduler_enabled or agent_enabled or not emergency_paused)
  ) then
    raise exception using errcode = '55000',
      message = 'emergency phase one did not disable every database control';
  end if;
  perform set_config('capital_lab.activation_campaign_id', '', true);
  perform set_config('capital_lab.activation_operation', '', true);
  perform set_config('capital_lab.activation_operation_id', '', true);
  update private.no_ai_shadow_dry_runs
  set scheduler_control_enabled = false,
      emergency_killed_from_state = case
        when state in ('passed', 'failed', 'inconclusive', 'aborted')
          then emergency_killed_from_state
        else coalesce(emergency_killed_from_state, state)
      end,
      state = case when state in ('passed', 'failed', 'inconclusive', 'aborted')
        then state else 'auto_stopped' end,
      stopped_at = coalesce(stopped_at, statement_timestamp()),
      finalize_not_before_at = coalesce(
        finalize_not_before_at, statement_timestamp() + interval '300 seconds'
      )
  where id = campaign.id;
end;
$$;

revoke all on function private.guard_activation_http_response_transport_metadata()
from public, anon, authenticated, service_role;
revoke all on function private.assert_activation_submission_binding(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function private.guard_activation_bounded_mutation()
from public, anon, authenticated, service_role;
revoke all on function private.record_activation_forbidden_mutation()
from public, anon, authenticated, service_role;
revoke all on function private.emergency_kill_activation_controls(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.submit_activation_auth_failure_probes(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.submit_activation_auth_noop(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.activation_zero_counters_valid(jsonb)
from public, anon, authenticated, service_role;

commit;
