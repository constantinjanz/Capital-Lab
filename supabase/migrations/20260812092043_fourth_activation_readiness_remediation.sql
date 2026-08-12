begin;

alter table private.no_ai_shadow_dry_runs
  drop constraint no_ai_shadow_dry_runs_state_check,
  add constraint no_ai_shadow_dry_runs_state_check check (state in (
    'prepared', 'infra_installed', 'vault_verified',
    'jobs_installed_disabled', 'auth_endpoint_verified',
    'auth_failure_probes_claimed', 'auth_failures_verified',
    'auth_noop_claimed', 'auth_noop_verified', 'runtime_identity_verified',
    'runtime_config_attestation_requested', 'runtime_config_verified',
    'runtime_deployment_verified', 'baseline_frozen', 'armed', 'running',
    'auto_stopped', 'reconciled', 'passed', 'failed', 'inconclusive',
    'aborted'
  ));

alter table private.no_ai_shadow_dry_runs
  add column runtime_config_verified_at timestamptz;

alter table private.activation_deployment_bindings
  add column immutable_deployment_origin text,
  add column immutable_deployment_host text,
  add column runtime_config_path text,
  add column runtime_config_url text;

alter table private.activation_relation_snapshots
  drop constraint activation_relation_snapshots_snapshot_kind_check,
  add constraint activation_relation_snapshots_snapshot_kind_check check (
    snapshot_kind in (
      'pre_auth_noop', 'post_auth_failure', 'post_auth_noop',
      'pre_runtime_config', 'post_runtime_config',
      'pre_dry_run', 'tick', 'terminal'
    )
  );

create table private.activation_runtime_config_requests (
  request_id uuid primary key,
  campaign_id uuid not null unique,
  owner_id uuid not null,
  correlation_id uuid not null unique,
  nonce uuid not null unique,
  expected_deployment_id text not null check (
    expected_deployment_id ~ '^dpl_[A-Za-z0-9]{20,64}$'
  ),
  expected_project_id text not null check (
    expected_project_id ~ '^prj_[A-Za-z0-9]{20,64}$'
  ),
  expected_deployment_role text not null check (
    expected_deployment_role = 'no_ai_runtime_enabled'
  ),
  expected_commit_sha text not null check (
    expected_commit_sha ~ '^[0-9a-f]{40}$'
  ),
  expected_deployment_url text not null,
  pg_net_request_id bigint unique,
  status text not null check (status in (
    'prepared', 'submitted', 'transport_terminal', 'verified',
    'invalid', 'transport_missing', 'unknown'
  )),
  claimed_at timestamptz not null default statement_timestamp(),
  submitted_at timestamptz,
  terminal_at timestamptz,
  operation_id uuid not null,
  foreign key (campaign_id, owner_id)
    references private.no_ai_shadow_dry_runs(id, owner_id) on delete restrict
);

create table private.activation_runtime_config_evidence (
  request_id uuid primary key references private.activation_runtime_config_requests(request_id) on delete restrict,
  campaign_id uuid not null,
  owner_id uuid not null,
  pg_net_request_id bigint not null unique,
  http_status integer check (http_status between 100 and 599),
  timed_out boolean not null,
  error_class text,
  schema_valid boolean not null,
  response_campaign_id uuid,
  response_correlation_id uuid,
  response_request_id uuid,
  response_nonce uuid,
  response_deployment_role text,
  response_environment text,
  response_target_environment text,
  response_deployment_id text,
  response_project_id text,
  response_commit_sha text,
  response_deployment_url text,
  response_status text,
  response_terminal_reason text,
  response_observed_at timestamptz,
  scheduler_disabled boolean,
  agent_disabled boolean,
  runtime_config jsonb check (
    runtime_config is null or jsonb_typeof(runtime_config) = 'object'
  ),
  counters jsonb check (counters is null or jsonb_typeof(counters) = 'object'),
  captured_at timestamptz not null default statement_timestamp(),
  foreign key (campaign_id, owner_id)
    references private.no_ai_shadow_dry_runs(id, owner_id) on delete restrict
);

create table private.activation_expected_mutation_rules (
  relation_name text primary key,
  classification text not null check (
    classification in ('activation_evidence', 'scheduler_envelope')
  ),
  allowed_operations text[] not null check (
    cardinality(allowed_operations) > 0
    and allowed_operations <@ array['INSERT', 'UPDATE']::text[]
  ),
  update_columns text[] not null,
  row_scope_kind text not null check (row_scope_kind in (
    'campaign_id', 'dry_run_id', 'campaign_primary_key', 'owner_id',
    'scheduler_slot', 'internal_contract'
  )),
  allowed_states text[] not null check (cardinality(allowed_states) > 0),
  rationale text not null check (length(btrim(rationale)) > 0),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (relation_name)
    references private.activation_relation_classifications(relation_name)
    on delete restrict
);

alter table private.activation_mutation_evidence
  add column operation_id uuid,
  add column row_identity jsonb check (
    row_identity is null or jsonb_typeof(row_identity) = 'object'
  ),
  add column changed_columns text[];

insert into private.activation_relation_classifications (
  contract_version, relation_name, classification, rationale
) values
  ('activation-table-classification-v1',
    'private.activation_runtime_config_requests', 'activation_evidence',
    'One-shot Runtime configuration request identity and transport state.'),
  ('activation-table-classification-v1',
    'private.activation_runtime_config_evidence', 'activation_evidence',
    'Append-only sanitized Runtime configuration evidence.'),
  ('activation-table-classification-v1',
    'private.activation_expected_mutation_rules', 'activation_evidence',
    'Reviewed row-, operation-, state-, and update-column bounds.');

drop trigger activation_relation_classifications_reject_statement_mutation
on private.activation_relation_classifications;
update private.activation_relation_classifications
set classification = 'forbidden',
    rationale = 'Activation has no reviewed audit-log mutation; any row change is forbidden.'
where relation_name = 'private.audit_log';
create trigger activation_relation_classifications_reject_statement_mutation
before update or delete or truncate on private.activation_relation_classifications
for each statement execute function private.reject_mutation();

insert into private.activation_forbidden_relation_specs (
  contract_version, relation_name, owner_column,
  immutable_id_column, time_watermark_column, evidence_rule
) values (
  'activation-side-effects-v3', 'private.audit_log', 'owner_id',
  'id', 'occurred_at', 'full_row_state'
);

insert into private.activation_expected_mutation_rules (
  relation_name, classification, allowed_operations, update_columns,
  row_scope_kind, allowed_states, rationale
)
select classification.relation_name, classification.classification,
  case
    when classification.relation_name in (
      'private.no_ai_shadow_dry_runs',
      'private.activation_auth_failure_requests',
      'private.activation_auth_noop_requests',
      'private.activation_runtime_config_requests',
      'private.no_ai_shadow_dry_run_events',
      'private.activation_terminal_operations',
      'private.activation_job_spec_versions',
      'private.application_settings',
      'public.experiment_controls',
      'private.scheduler_slots', 'private.scheduler_runs'
    ) then array['INSERT', 'UPDATE']::text[]
    else array['INSERT']::text[]
  end,
  case classification.relation_name
    when 'private.no_ai_shadow_dry_runs' then array[
      'state', 'scheduler_control_enabled', 'runtime_config_verified_at',
      'decision_at', 'planned_start_at', 'first_session_date',
      'second_session_date', 'planned_end_at', 'expected_slot_count',
      'expected_event_count', 'updated_at',
      'started_at', 'stopped_at', 'finalize_not_before_at', 'archived_at',
      'failure_code', 'emergency_killed_from_state'
    ]::text[]
    when 'private.activation_auth_failure_requests' then array[
      'pg_net_request_id', 'status', 'submitted_at', 'terminal_at'
    ]::text[]
    when 'private.activation_auth_noop_requests' then array[
      'pg_net_request_id', 'status', 'submitted_at', 'terminal_at'
    ]::text[]
    when 'private.activation_runtime_config_requests' then array[
      'pg_net_request_id', 'status', 'submitted_at', 'terminal_at'
    ]::text[]
    when 'private.no_ai_shadow_dry_run_events' then array[
      'cron_trigger_count', 'pg_net_request_id', 'http_status', 'timed_out',
      'response_error_class', 'authenticated_count', 'claimed_cycle_count',
      'terminal_reason', 'model_call_count', 'budget_reservation_count',
      'order_count', 'fill_count', 'ledger_entry_count', 'correlation_id',
      'completed_at'
    ]::text[]
    when 'private.activation_terminal_operations' then array[
      'status', 'completed_at', 'evidence'
    ]::text[]
    when 'private.activation_job_spec_versions' then array['expected_active']::text[]
    when 'private.application_settings' then array['value', 'version', 'updated_at']::text[]
    when 'public.experiment_controls' then array[
      'scheduler_enabled', 'agent_enabled', 'emergency_paused',
      'pause_reason', 'state_version', 'updated_at'
    ]::text[]
    when 'private.scheduler_slots' then array[
      'status', 'result', 'lease_until', 'attempt_count', 'heartbeat_at',
      'deadline_at', 'attempt_number', 'updated_at'
    ]::text[]
    when 'private.scheduler_runs' then array[
      'status', 'finished_at', 'skipped_reason', 'error_class',
      'retry_eligible', 'metadata'
    ]::text[]
    else array[]::text[]
  end,
  case
    when classification.relation_name = 'private.no_ai_shadow_dry_runs'
      then 'campaign_primary_key'
    when exists (
      select 1 from information_schema.columns as column_contract
      where column_contract.table_schema = split_part(classification.relation_name, '.', 1)
        and column_contract.table_name = split_part(classification.relation_name, '.', 2)
        and column_contract.column_name = 'campaign_id'
    ) then 'campaign_id'
    when exists (
      select 1 from information_schema.columns as column_contract
      where column_contract.table_schema = split_part(classification.relation_name, '.', 1)
        and column_contract.table_name = split_part(classification.relation_name, '.', 2)
        and column_contract.column_name = 'dry_run_id'
    ) then 'dry_run_id'
    when classification.classification = 'scheduler_envelope' then 'scheduler_slot'
    when exists (
      select 1 from information_schema.columns as column_contract
      where column_contract.table_schema = split_part(classification.relation_name, '.', 1)
        and column_contract.table_name = split_part(classification.relation_name, '.', 2)
        and column_contract.column_name = 'owner_id'
    ) then 'owner_id'
    else 'internal_contract'
  end,
  array[
    'prepared', 'infra_installed', 'vault_verified', 'jobs_installed_disabled',
    'auth_endpoint_verified', 'auth_failure_probes_claimed',
    'auth_failures_verified', 'auth_noop_claimed', 'auth_noop_verified',
    'runtime_identity_verified', 'runtime_config_attestation_requested',
    'runtime_config_verified', 'runtime_deployment_verified',
    'baseline_frozen', 'armed', 'running', 'auto_stopped', 'reconciled'
  ]::text[],
  'Only the listed operations, exact update columns, scoped row identity, and states are expected.'
from private.activation_relation_classifications as classification
where classification.classification in ('activation_evidence', 'scheduler_envelope')
order by classification.relation_name;

alter table private.activation_runtime_config_requests enable row level security;
alter table private.activation_runtime_config_requests force row level security;
alter table private.activation_runtime_config_evidence enable row level security;
alter table private.activation_runtime_config_evidence force row level security;
alter table private.activation_expected_mutation_rules enable row level security;
alter table private.activation_expected_mutation_rules force row level security;
revoke all on table private.activation_runtime_config_requests
from public, anon, authenticated, service_role;
revoke all on table private.activation_runtime_config_evidence
from public, anon, authenticated, service_role;
revoke all on table private.activation_expected_mutation_rules
from public, anon, authenticated, service_role;

create trigger activation_runtime_config_evidence_reject_statement_mutation
before update or delete or truncate on private.activation_runtime_config_evidence
for each statement execute function private.reject_mutation();

create trigger activation_expected_mutation_rules_reject_mutation
before update or delete or truncate on private.activation_expected_mutation_rules
for each statement execute function private.reject_mutation();

create function private.assert_activation_expected_mutation_rules()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select relation_name from private.activation_relation_classifications
    where classification in ('activation_evidence', 'scheduler_envelope')
    except
    select relation_name from private.activation_expected_mutation_rules
  ) or exists (
    select relation_name from private.activation_expected_mutation_rules
    except
    select relation_name from private.activation_relation_classifications
    where classification in ('activation_evidence', 'scheduler_envelope')
  ) or exists (
    select 1 from private.activation_expected_mutation_rules as rule
    where rule.classification <> (
      select classification from private.activation_relation_classifications
      where relation_name = rule.relation_name
    )
      or ('UPDATE' = any(rule.allowed_operations) and cardinality(rule.update_columns) = 0)
      or ('UPDATE' <> all(rule.allowed_operations) and cardinality(rule.update_columns) <> 0)
      or exists (
        select unnest(rule.update_columns)
        except
        select column_contract.column_name
        from information_schema.columns as column_contract
        where column_contract.table_schema = split_part(rule.relation_name, '.', 1)
          and column_contract.table_name = split_part(rule.relation_name, '.', 2)
      )
  ) then
    raise exception using errcode = '55000',
      message = 'Activation expected-mutation contract is incomplete or drifted';
  end if;
end;
$$;

create function private.protect_activation_runtime_config_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or row(
    new.request_id, new.campaign_id, new.owner_id, new.correlation_id,
    new.nonce, new.expected_deployment_id, new.expected_project_id,
    new.expected_deployment_role, new.expected_commit_sha,
    new.expected_deployment_url, new.operation_id, new.claimed_at
  ) is distinct from row(
    old.request_id, old.campaign_id, old.owner_id, old.correlation_id,
    old.nonce, old.expected_deployment_id, old.expected_project_id,
    old.expected_deployment_role, old.expected_commit_sha,
    old.expected_deployment_url, old.operation_id, old.claimed_at
  ) then
    raise exception using errcode = '55000',
      message = 'runtime configuration request identity is immutable';
  end if;
  return new;
end;
$$;

create trigger activation_runtime_config_requests_protect_identity
before update or delete on private.activation_runtime_config_requests
for each row execute function private.protect_activation_runtime_config_request();

create trigger activation_runtime_config_requests_reject_truncate
before truncate on private.activation_runtime_config_requests
for each statement execute function private.reject_mutation();

create or replace function private.capture_activation_relation_snapshot(
  p_campaign_id uuid,
  p_snapshot_kind text,
  p_snapshot_sequence bigint
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  spec private.activation_forbidden_relation_specs%rowtype;
  schema_name text;
  table_name text;
  owner_predicate text;
  row_expression text;
  computed_count bigint;
  computed_hash text;
  computed_max_id text;
  computed_max_time timestamptz;
  computed_totals jsonb := '{}'::jsonb;
  persisted private.activation_relation_snapshots%rowtype;
  captured integer := 0;
begin
  if p_snapshot_kind not in (
    'pre_auth_noop', 'post_auth_failure', 'post_auth_noop',
    'pre_runtime_config', 'post_runtime_config',
    'pre_dry_run', 'tick', 'terminal'
  ) or p_snapshot_sequence < 0 then
    raise exception using errcode = '22023', message = 'activation snapshot identity is invalid';
  end if;
  perform private.assert_activation_relation_classification_complete();
  perform private.assert_activation_expected_mutation_rules();
  select * into strict campaign from private.no_ai_shadow_dry_runs where id = p_campaign_id;
  for spec in select * from private.activation_forbidden_relation_specs order by relation_name
  loop
    schema_name := split_part(spec.relation_name, '.', 1);
    table_name := split_part(spec.relation_name, '.', 2);
    owner_predicate := case when spec.owner_column is null then 'true'
      else format('source_row.%I = $1', spec.owner_column) end;
    row_expression := case when spec.relation_name = 'private.application_settings'
      then 'case when source_row.is_secret then to_jsonb(source_row) - ''value'' else to_jsonb(source_row) end'
      else 'to_jsonb(source_row)' end;
    execute format($query$
      select count(*), encode(extensions.digest(convert_to(
        coalesce(string_agg(row_data::text, E'\n' order by row_data::text), ''),
        'UTF8'
      ), 'sha256'), 'hex')
      from (
        select %s as row_data from %I.%I as source_row where %s
      ) as canonical_rows
    $query$, row_expression, schema_name, table_name, owner_predicate)
    into computed_count, computed_hash using campaign.owner_id;
    computed_max_id := null;
    if spec.immutable_id_column is not null then
      execute format('select max(%I::text) from %I.%I as source_row where %s',
        spec.immutable_id_column, schema_name, table_name, owner_predicate)
      into computed_max_id using campaign.owner_id;
    end if;
    computed_max_time := null;
    if spec.time_watermark_column is not null then
      execute format('select max(%I) from %I.%I as source_row where %s',
        spec.time_watermark_column, schema_name, table_name, owner_predicate)
      into computed_max_time using campaign.owner_id;
    end if;
    computed_totals := '{}'::jsonb;
    if spec.relation_name = 'private.cash_ledger_entries' then
      select coalesce(jsonb_object_agg(totals.currency, totals.amount order by totals.currency), '{}'::jsonb)
      into computed_totals from (
        select currency, sum(amount)::text as amount from private.cash_ledger_entries
        where owner_id = campaign.owner_id group by currency
      ) as totals;
    elsif spec.relation_name = 'public.orders' then
      select jsonb_build_object('quantity', coalesce(sum(quantity), 0)::text,
        'filled_quantity', coalesce(sum(filled_quantity), 0)::text)
      into computed_totals from public.orders where owner_id = campaign.owner_id;
    elsif spec.relation_name = 'public.fills' then
      select jsonb_build_object('quantity', coalesce(sum(quantity), 0)::text,
        'notional', coalesce(sum(notional), 0)::text,
        'commission', coalesce(sum(commission), 0)::text,
        'regulatory_fee', coalesce(sum(regulatory_fee), 0)::text)
      into computed_totals from public.fills where owner_id = campaign.owner_id;
    elsif spec.relation_name = 'public.positions' then
      select jsonb_build_object('quantity', coalesce(sum(quantity), 0)::text,
        'realized_pnl_base', coalesce(sum(realized_pnl_base), 0)::text)
      into computed_totals from public.positions where owner_id = campaign.owner_id;
    end if;
    insert into private.activation_relation_snapshots (
      campaign_id, owner_id, snapshot_kind, snapshot_sequence, relation_name,
      row_count, content_hash, max_immutable_id, max_time_watermark, numeric_totals
    ) values (
      campaign.id, campaign.owner_id, p_snapshot_kind, p_snapshot_sequence,
      spec.relation_name, computed_count, computed_hash, computed_max_id,
      computed_max_time, computed_totals
    ) on conflict (campaign_id, snapshot_kind, snapshot_sequence, relation_name) do nothing;
    select * into strict persisted from private.activation_relation_snapshots
    where campaign_id = campaign.id and snapshot_kind = p_snapshot_kind
      and snapshot_sequence = p_snapshot_sequence and relation_name = spec.relation_name;
    if row(persisted.row_count, persisted.content_hash, persisted.max_immutable_id,
      persisted.max_time_watermark, persisted.numeric_totals)
      is distinct from row(computed_count, computed_hash, computed_max_id,
        computed_max_time, computed_totals)
    then
      raise exception using errcode = '55000', message = 'persisted activation baseline differs on retry';
    end if;
    captured := captured + 1;
  end loop;
  return captured;
end;
$$;

create or replace function private.record_activation_forbidden_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
begin
  select * into campaign
  from private.no_ai_shadow_dry_runs
  where state in (
    'auth_endpoint_verified', 'auth_failure_probes_claimed',
    'auth_failures_verified', 'auth_noop_claimed', 'auth_noop_verified',
    'runtime_identity_verified', 'runtime_config_attestation_requested',
    'runtime_config_verified', 'runtime_deployment_verified',
    'baseline_frozen', 'armed', 'running'
  )
  order by prepared_at desc limit 1 for update;
  if campaign.id is not null then
    insert into private.activation_mutation_evidence (
      campaign_id, owner_id, relation_name, mutation_kind
    ) values (
      campaign.id, campaign.owner_id,
      tg_table_schema || '.' || tg_table_name, tg_op
    );
    perform private.emergency_kill_activation_controls(campaign.id);
  end if;
  return null;
end;
$$;

create or replace function private.prepare_no_ai_shadow_dry_run_v2(
  p_campaign_id uuid,
  p_commit_sha text,
  p_config_version text,
  p_manifest_sha256 text,
  p_phase_contract_sha256 text,
  p_relation_contract_sha256 text,
  p_manifest jsonb,
  p_operation_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_owner uuid;
  existing private.no_ai_shadow_dry_runs%rowtype;
  existing_transition private.no_ai_shadow_dry_run_transitions%rowtype;
  database_fingerprint text := private.activation_database_fingerprint();
begin
  if p_campaign_id is null or p_operation_id is null or p_correlation_id is null
    or p_commit_sha !~ '^[0-9a-f]{40}$'
    or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
    or p_phase_contract_sha256 !~ '^[0-9a-f]{64}$'
    or p_relation_contract_sha256 !~ '^[0-9a-f]{64}$'
    or p_config_version !~ '^[a-z0-9][a-z0-9._-]{0,127}$'
    or jsonb_typeof(p_manifest) <> 'object'
    or p_manifest ->> 'schema_version' <> '4'
    or p_manifest ->> 'campaign_id' <> p_campaign_id::text
    or p_manifest ->> 'config_version' <> p_config_version
    or p_manifest ->> 'prepared_commit_sha' <> p_commit_sha
    or p_manifest ->> 'vercel_commit_sha' <> p_commit_sha
    or p_manifest ->> 'vercel_environment' <> 'production'
    or p_manifest ->> 'phase_contract_sha256' <> p_phase_contract_sha256
    or p_manifest ->> 'relation_contract_sha256' <> p_relation_contract_sha256
    or p_relation_contract_sha256 <> private.activation_relation_contract_hash()
    or p_manifest ->> 'project_identity_contract_sha256'
      <> '92262e62546224e4cd1b501f2f55f64692d1b757b703dd22ee1dafbd02ea493a'
    or p_manifest ->> 'vercel_team_id' <> 'team_yqndKHk6nfWGlte1UVLTJOHG'
    or p_manifest ->> 'vercel_project_id' <> 'prj_pbCNwlmXZLeZprZpsRAfAAhPPXVR'
    or p_manifest ->> 'supabase_project_ref' <> 'qrnuyibntcxwffrxmrvn'
    or p_manifest #>> '{database_target,database_fingerprint}' <> database_fingerprint
    or p_manifest ->> 'scheduler_path' <> '/api/internal/scheduler'
    or p_manifest ->> 'scheduler_url'
      <> (p_manifest ->> 'production_origin') || '/api/internal/scheduler'
    or p_manifest ->> 'production_origin'
      <> 'https://' || (p_manifest ->> 'production_host')
    or p_manifest ->> 'production_host' !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
    or p_manifest ->> 'production_host'
      <> 'capital-lab-constantinjanz-7876s-projects.vercel.app'
    or p_manifest ->> 'production_deployment_id' !~ '^dpl_[A-Za-z0-9]{20,64}$'
    or p_manifest #>> '{providers,market_data}' <> 'mock'
    or p_manifest #>> '{providers,news}' <> 'mock'
    or p_manifest #>> '{providers,execution}' <> 'paper'
    or p_manifest ->> 'expected_slot_count' <> '52'
    or p_manifest ->> 'expected_event_count' <> '104'
    or p_manifest ->> 'max_request_seconds' <> '120'
    or p_manifest ->> 'drain_safety_seconds' <> '180'
    or p_manifest ->> 'minimum_lead_seconds' <> '900'
  then
    raise exception using errcode = '22023', message = 'activation campaign manifest is invalid';
  end if;

  select app_user.user_id into strict target_owner
  from public.app_users as app_user
  where app_user.role = 'owner' and app_user.is_active;

  insert into private.no_ai_shadow_dry_runs (
    id, owner_id, run_type, state, config_version, prepared_commit_sha,
    manifest_sha256, phase_contract_sha256, relation_contract_sha256,
    manifest, production_origin, production_host, scheduler_path,
    scheduler_url, production_deployment_id, vercel_commit_sha,
    vercel_environment, database_fingerprint, max_request_seconds,
    drain_safety_seconds
  ) values (
    p_campaign_id, target_owner, 'no_ai_shadow_infrastructure_dry_run',
    'prepared', p_config_version, p_commit_sha, p_manifest_sha256,
    p_phase_contract_sha256, p_relation_contract_sha256, p_manifest,
    p_manifest ->> 'production_origin', p_manifest ->> 'production_host',
    p_manifest ->> 'scheduler_path', p_manifest ->> 'scheduler_url',
    p_manifest ->> 'production_deployment_id', p_commit_sha, 'production',
    database_fingerprint, (p_manifest ->> 'max_request_seconds')::integer,
    (p_manifest ->> 'drain_safety_seconds')::integer
  ) on conflict (id) do nothing;

  select * into strict existing
  from private.no_ai_shadow_dry_runs
  where id = p_campaign_id for update;
  if row(
    existing.owner_id, existing.config_version, existing.prepared_commit_sha,
    existing.manifest_sha256, existing.phase_contract_sha256,
    existing.relation_contract_sha256, existing.manifest,
    existing.database_fingerprint
  ) is distinct from row(
    target_owner, p_config_version, p_commit_sha, p_manifest_sha256,
    p_phase_contract_sha256, p_relation_contract_sha256, p_manifest,
    database_fingerprint
  ) then
    raise exception using errcode = '55000', message = 'activation campaign identity drifted';
  end if;

  insert into private.no_ai_shadow_dry_run_transitions (
    dry_run_id, owner_id, from_state, to_state, actor, commit_sha,
    config_version, correlation_id, evidence
  ) values (
    existing.id, existing.owner_id, null, 'prepared', 'admin_script',
    p_commit_sha, p_config_version, p_correlation_id,
    jsonb_build_object(
      'operation_id', p_operation_id,
      'manifest_sha256', p_manifest_sha256,
      'database_fingerprint', database_fingerprint
    )
  ) on conflict (dry_run_id, to_state) do nothing;

  select * into strict existing_transition
  from private.no_ai_shadow_dry_run_transitions
  where dry_run_id = existing.id and to_state = 'prepared';
  if existing_transition.correlation_id <> p_correlation_id
    or existing_transition.evidence ->> 'operation_id' <> p_operation_id::text
    or existing_transition.evidence ->> 'manifest_sha256' <> p_manifest_sha256
    or existing_transition.evidence ->> 'database_fingerprint' <> database_fingerprint
  then
    raise exception using errcode = '55000', message = 'prepare retry operation identity drifted';
  end if;

  return jsonb_build_object(
    'campaign_id', existing.id,
    'state', existing.state,
    'derived_commit_sha', existing.prepared_commit_sha,
    'database_fingerprint', existing.database_fingerprint
  );
end;
$$;

create or replace function private.transition_no_ai_shadow_dry_run(
  p_dry_run_id uuid,
  p_expected_state text,
  p_target_state text,
  p_actor text,
  p_commit_sha text,
  p_config_version text,
  p_correlation_id uuid,
  p_evidence jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row private.no_ai_shadow_dry_runs%rowtype;
  actor_allowed boolean;
begin
  if p_correlation_id is null or jsonb_typeof(p_evidence) <> 'object' then
    raise exception using errcode = '22023', message = 'activation transition evidence is invalid';
  end if;
  select * into strict current_row from private.no_ai_shadow_dry_runs
  where id = p_dry_run_id for update;
  if current_row.state <> p_expected_state
    or current_row.prepared_commit_sha <> p_commit_sha
    or current_row.vercel_commit_sha <> p_commit_sha
    or current_row.config_version <> p_config_version
  then
    raise exception using errcode = '55000', message = 'activation state, commit, or config drifted';
  end if;
  actor_allowed := case
    when p_target_state in ('failed', 'inconclusive', 'aborted')
      then p_actor in ('owner', 'system')
    when p_expected_state = 'prepared' and p_target_state = 'infra_installed'
      then p_actor = 'admin_script'
    when p_expected_state = 'infra_installed' and p_target_state = 'vault_verified'
      then p_actor = 'owner'
    when p_expected_state = 'vault_verified' and p_target_state = 'jobs_installed_disabled'
      then p_actor = 'admin_script'
    when p_expected_state = 'jobs_installed_disabled' and p_target_state = 'auth_endpoint_verified'
      then p_actor = 'owner'
    when p_expected_state = 'auth_endpoint_verified' and p_target_state = 'auth_failure_probes_claimed'
      then p_actor = 'owner'
    when p_expected_state = 'auth_failure_probes_claimed' and p_target_state = 'auth_failures_verified'
      then p_actor = 'system'
    when p_expected_state = 'auth_failures_verified' and p_target_state = 'auth_noop_claimed'
      then p_actor = 'owner'
    when p_expected_state = 'auth_noop_claimed' and p_target_state = 'auth_noop_verified'
      then p_actor = 'system'
    when p_expected_state = 'auth_noop_verified' and p_target_state = 'runtime_identity_verified'
      then p_actor = 'owner'
    when p_expected_state = 'runtime_identity_verified'
      and p_target_state = 'runtime_config_attestation_requested'
      then p_actor = 'owner'
    when p_expected_state = 'runtime_config_attestation_requested'
      and p_target_state = 'runtime_config_verified'
      then p_actor = 'system'
    when p_expected_state = 'runtime_config_verified'
      and p_target_state = 'runtime_deployment_verified'
      then p_actor = 'owner'
    when p_expected_state = 'runtime_deployment_verified' and p_target_state = 'baseline_frozen'
      then p_actor = 'owner'
    when p_expected_state = 'baseline_frozen' and p_target_state = 'armed'
      then p_actor = 'owner'
    when p_expected_state = 'armed' and p_target_state = 'running'
      then p_actor = 'scheduler'
    when p_expected_state = 'running' and p_target_state = 'auto_stopped'
      then p_actor = 'system'
    when p_expected_state = 'auto_stopped' and p_target_state = 'reconciled'
      then p_actor = 'system'
    when p_expected_state = 'reconciled' and p_target_state = 'passed'
      then p_actor = 'system'
    else false
  end;
  if not actor_allowed then
    raise exception using errcode = '55000', message = 'actor is forbidden for activation transition';
  end if;
  update private.no_ai_shadow_dry_runs
  set state = p_target_state,
      runtime_config_verified_at = case when p_target_state = 'runtime_config_verified'
        then statement_timestamp() else runtime_config_verified_at end,
      scheduler_control_enabled = case when p_target_state in (
        'auto_stopped', 'reconciled', 'passed', 'failed', 'inconclusive', 'aborted'
      ) then false else scheduler_control_enabled end,
      started_at = case when p_target_state = 'running' then statement_timestamp() else started_at end,
      stopped_at = case when p_target_state in ('auto_stopped', 'failed', 'inconclusive', 'aborted')
        then coalesce(stopped_at, statement_timestamp()) else stopped_at end,
      finalize_not_before_at = case when p_target_state = 'auto_stopped'
        then statement_timestamp() + interval '300 seconds' else finalize_not_before_at end,
      archived_at = case when p_target_state in ('passed', 'failed', 'inconclusive', 'aborted')
        then statement_timestamp() else archived_at end,
      failure_code = case when p_target_state in ('failed', 'inconclusive', 'aborted')
        then p_evidence ->> 'reason_code' else failure_code end
  where id = current_row.id;
  insert into private.no_ai_shadow_dry_run_transitions (
    dry_run_id, owner_id, from_state, to_state, actor, commit_sha,
    config_version, correlation_id, evidence
  ) values (
    current_row.id, current_row.owner_id, current_row.state, p_target_state,
    p_actor, p_commit_sha, p_config_version, p_correlation_id, p_evidence
  );
end;
$$;

create or replace function private.activation_vercel_proof_file_hash(p_proof jsonb)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(
    '{'
      || '"commitSha":' || pg_catalog.to_json(p_proof ->> 'commitSha')::text || ','
      || '"deploymentId":' || pg_catalog.to_json(p_proof ->> 'deploymentId')::text || ','
      || '"environment":' || pg_catalog.to_json(p_proof ->> 'environment')::text || ','
      || '"evidenceHash":' || pg_catalog.to_json(p_proof ->> 'evidenceHash')::text || ','
      || '"immutableDeploymentHost":' || pg_catalog.to_json(p_proof ->> 'immutableDeploymentHost')::text || ','
      || '"immutableDeploymentOrigin":' || pg_catalog.to_json(p_proof ->> 'immutableDeploymentOrigin')::text || ','
      || '"productionHost":' || pg_catalog.to_json(p_proof ->> 'productionHost')::text || ','
      || '"productionOrigin":' || pg_catalog.to_json(p_proof ->> 'productionOrigin')::text || ','
      || '"readyState":' || pg_catalog.to_json(p_proof ->> 'readyState')::text || ','
      || '"role":' || pg_catalog.to_json(p_proof ->> 'role')::text || ','
      || '"runtimeConfigPath":' || pg_catalog.to_json(p_proof ->> 'runtimeConfigPath')::text || ','
      || '"runtimeConfigUrl":' || pg_catalog.to_json(p_proof ->> 'runtimeConfigUrl')::text || ','
      || '"schedulerPath":' || pg_catalog.to_json(p_proof ->> 'schedulerPath')::text || ','
      || '"schedulerUrl":' || pg_catalog.to_json(p_proof ->> 'schedulerUrl')::text || ','
      || '"schemaVersion":' || (p_proof -> 'schemaVersion')::text || ','
      || '"supabaseProjectRef":' || pg_catalog.to_json(p_proof ->> 'supabaseProjectRef')::text || ','
      || '"target":' || pg_catalog.to_json(p_proof ->> 'target')::text || ','
      || '"vercelProjectId":' || pg_catalog.to_json(p_proof ->> 'vercelProjectId')::text || ','
      || '"vercelTeamId":' || pg_catalog.to_json(p_proof ->> 'vercelTeamId')::text || ','
      || '"verifiedAt":' || pg_catalog.to_json(p_proof ->> 'verifiedAt')::text
      || E'}\n',
    'UTF8'
  ), 'sha256'), 'hex');
$$;

create or replace function private.record_activation_deployment_binding(
  p_campaign_id uuid,
  p_deployment_role text,
  p_proof jsonb,
  p_proof_sha256 text,
  p_operation_id uuid,
  p_correlation_id uuid,
  p_commit_sha text,
  p_config_version text,
  p_manifest_sha256 text,
  p_phase_contract_sha256 text,
  p_database_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  existing private.activation_deployment_bindings%rowtype;
  expected_state text;
  target_state text;
  expected_scheduler_enabled boolean;
  parsed_verified_at timestamptz;
begin
  campaign := private.assert_activation_context(
    p_campaign_id, p_commit_sha, p_config_version, p_manifest_sha256,
    p_phase_contract_sha256, p_database_fingerprint
  );
  if p_deployment_role = 'auth_disabled' then
    expected_state := 'jobs_installed_disabled';
    target_state := 'auth_endpoint_verified';
    expected_scheduler_enabled := false;
  elsif p_deployment_role = 'no_ai_runtime_enabled' then
    expected_state := 'auth_noop_verified';
    target_state := 'runtime_identity_verified';
    expected_scheduler_enabled := true;
  else
    raise exception using errcode = '22023', message = 'deployment role is unavailable in this phase';
  end if;
  if campaign.state not in (expected_state, target_state)
    or p_operation_id is null or p_correlation_id is null
    or p_proof_sha256 !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_proof) <> 'object'
    or (select array_agg(key order by key) from jsonb_object_keys(p_proof) as key) <> array[
      'commitSha', 'deploymentId', 'environment', 'evidenceHash',
      'immutableDeploymentHost', 'immutableDeploymentOrigin', 'productionHost',
      'productionOrigin', 'readyState', 'role', 'runtimeConfigPath',
      'runtimeConfigUrl', 'schedulerPath', 'schedulerUrl', 'schemaVersion',
      'supabaseProjectRef', 'target', 'vercelProjectId', 'vercelTeamId',
      'verifiedAt'
    ]::text[]
  then
    raise exception using errcode = '22023', message = 'deployment proof is invalid';
  end if;
  begin
    parsed_verified_at := (p_proof ->> 'verifiedAt')::timestamptz;
  exception when others then
    raise exception using errcode = '22023', message = 'deployment proof timestamp is invalid';
  end;
  if p_proof_sha256 <> private.activation_vercel_proof_file_hash(p_proof)
    or p_proof ->> 'schemaVersion' <> '2'
    or p_proof ->> 'role' <> p_deployment_role
    or p_proof ->> 'vercelTeamId' <> 'team_yqndKHk6nfWGlte1UVLTJOHG'
    or p_proof ->> 'vercelProjectId' <> 'prj_pbCNwlmXZLeZprZpsRAfAAhPPXVR'
    or p_proof ->> 'supabaseProjectRef' <> 'qrnuyibntcxwffrxmrvn'
    or p_proof ->> 'commitSha' <> campaign.prepared_commit_sha
    or p_proof ->> 'environment' <> 'production'
    or p_proof ->> 'target' <> 'production'
    or p_proof ->> 'readyState' <> 'READY'
    or p_proof ->> 'productionOrigin' <> campaign.production_origin
    or p_proof ->> 'productionHost' <> campaign.production_host
    or p_proof ->> 'schedulerPath' <> campaign.scheduler_path
    or p_proof ->> 'schedulerUrl' <> campaign.scheduler_url
    or p_proof ->> 'runtimeConfigPath' <> campaign.scheduler_path
    or p_proof ->> 'runtimeConfigUrl'
      <> ((p_proof ->> 'immutableDeploymentOrigin') || campaign.scheduler_path)
    or p_proof ->> 'immutableDeploymentOrigin'
      <> 'https://' || (p_proof ->> 'immutableDeploymentHost')
    or p_proof ->> 'immutableDeploymentHost' !~ '^[a-z0-9][a-z0-9.-]+\.vercel\.app$'
    or p_proof ->> 'deploymentId' !~ '^dpl_[A-Za-z0-9]{20,64}$'
    or p_proof ->> 'evidenceHash' !~ '^[0-9a-f]{64}$'
    or p_proof ->> 'evidenceHash' <> encode(extensions.digest(convert_to(concat_ws(E'\x1f',
      'capital-lab-vercel-deployment-proof-v1', p_proof ->> 'schemaVersion',
      p_proof ->> 'role', p_proof ->> 'vercelTeamId', p_proof ->> 'vercelProjectId',
      p_proof ->> 'supabaseProjectRef', p_proof ->> 'deploymentId',
      p_proof ->> 'commitSha', p_proof ->> 'environment', p_proof ->> 'target',
      p_proof ->> 'readyState', p_proof ->> 'productionOrigin',
      p_proof ->> 'productionHost', p_proof ->> 'immutableDeploymentOrigin',
      p_proof ->> 'immutableDeploymentHost', p_proof ->> 'schedulerPath',
      p_proof ->> 'schedulerUrl', p_proof ->> 'runtimeConfigPath',
      p_proof ->> 'runtimeConfigUrl'
    ), 'UTF8'), 'sha256'), 'hex')
    or parsed_verified_at not between statement_timestamp() - interval '15 minutes'
      and statement_timestamp() + interval '60 seconds'
    or (p_deployment_role = 'auth_disabled'
      and p_proof ->> 'deploymentId' <> campaign.production_deployment_id)
    or (p_deployment_role = 'no_ai_runtime_enabled' and exists (
      select 1 from private.activation_deployment_bindings
      where campaign_id = campaign.id and deployment_role = 'auth_disabled'
        and deployment_id = p_proof ->> 'deploymentId'
    ))
  then
    raise exception using errcode = '55000', message = 'Vercel deployment proof drifted from the reviewed identity';
  end if;
  if campaign.state = target_state then
    select * into strict existing from private.activation_deployment_bindings
    where campaign_id = campaign.id and deployment_role = p_deployment_role;
    if row(existing.deployment_id, existing.proof_sha256, existing.proof,
      existing.operation_id, existing.correlation_id)
      is distinct from row(p_proof ->> 'deploymentId', p_proof_sha256, p_proof,
        p_operation_id, p_correlation_id)
    then
      raise exception using errcode = '55000', message = 'deployment binding retry must use the exact durable proof and operation';
    end if;
    return jsonb_build_object('state', target_state,
      'deployment_role', p_deployment_role, 'deployment_id', existing.deployment_id,
      'reused', true);
  end if;
  insert into private.activation_deployment_bindings (
    campaign_id, owner_id, deployment_role, deployment_id, vercel_team_id,
    vercel_project_id, supabase_project_ref, commit_sha, environment, target,
    ready_state, production_origin, production_host, scheduler_path, scheduler_url,
    scheduler_enabled, evidence_hash, proof_sha256, proof, operation_id,
    correlation_id, verified_at, immutable_deployment_origin,
    immutable_deployment_host, runtime_config_path, runtime_config_url
  ) values (
    campaign.id, campaign.owner_id, p_deployment_role, p_proof ->> 'deploymentId',
    p_proof ->> 'vercelTeamId', p_proof ->> 'vercelProjectId',
    p_proof ->> 'supabaseProjectRef', p_proof ->> 'commitSha',
    p_proof ->> 'environment', p_proof ->> 'target', p_proof ->> 'readyState',
    p_proof ->> 'productionOrigin', p_proof ->> 'productionHost',
    p_proof ->> 'schedulerPath', p_proof ->> 'schedulerUrl',
    expected_scheduler_enabled, p_proof ->> 'evidenceHash', p_proof_sha256,
    p_proof, p_operation_id, p_correlation_id, parsed_verified_at,
    p_proof ->> 'immutableDeploymentOrigin', p_proof ->> 'immutableDeploymentHost',
    p_proof ->> 'runtimeConfigPath', p_proof ->> 'runtimeConfigUrl'
  ) on conflict (campaign_id, deployment_role) do nothing;
  select * into strict existing from private.activation_deployment_bindings
  where campaign_id = campaign.id and deployment_role = p_deployment_role;
  if row(existing.deployment_id, existing.proof_sha256, existing.proof,
    existing.operation_id, existing.correlation_id, existing.immutable_deployment_origin,
    existing.immutable_deployment_host, existing.runtime_config_path,
    existing.runtime_config_url)
    is distinct from row(p_proof ->> 'deploymentId', p_proof_sha256, p_proof,
      p_operation_id, p_correlation_id, p_proof ->> 'immutableDeploymentOrigin',
      p_proof ->> 'immutableDeploymentHost', p_proof ->> 'runtimeConfigPath',
      p_proof ->> 'runtimeConfigUrl')
  then
    raise exception using errcode = '55000', message = 'deployment binding is immutable; reconcile the original operation';
  end if;
  perform private.transition_no_ai_shadow_dry_run(
    campaign.id, expected_state, target_state, 'owner', campaign.prepared_commit_sha,
    campaign.config_version, p_correlation_id,
    jsonb_build_object('deployment_role', p_deployment_role,
      'deployment_id', existing.deployment_id, 'proof_sha256', p_proof_sha256,
      'configuration_attested', false)
  );
  return jsonb_build_object('state', target_state, 'deployment_role', p_deployment_role,
    'deployment_id', existing.deployment_id, 'reused', false);
end;
$$;

create function private.claim_activation_runtime_config_attestation(
  p_campaign_id uuid,
  p_request_id uuid,
  p_nonce uuid,
  p_operation_id uuid,
  p_correlation_id uuid,
  p_commit_sha text,
  p_config_version text,
  p_manifest_sha256 text,
  p_phase_contract_sha256 text,
  p_database_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  binding private.activation_deployment_bindings%rowtype;
  claimed private.activation_runtime_config_requests%rowtype;
begin
  campaign := private.assert_activation_context(
    p_campaign_id, p_commit_sha, p_config_version, p_manifest_sha256,
    p_phase_contract_sha256, p_database_fingerprint
  );
  if campaign.state not in (
    'runtime_identity_verified', 'runtime_config_attestation_requested'
  ) then
    raise exception using errcode = '55000', message = 'runtime configuration attestation is unavailable from the persisted state';
  end if;
  select * into strict binding from private.activation_deployment_bindings
  where campaign_id = campaign.id and deployment_role = 'no_ai_runtime_enabled';
  perform private.assert_activation_controls(campaign.id, false);
  perform private.assert_activation_job_specs(campaign.id, false);
  perform private.capture_activation_relation_snapshot(
    campaign.id, 'pre_runtime_config', 0
  );
  insert into private.activation_runtime_config_requests (
    request_id, campaign_id, owner_id, correlation_id, nonce,
    expected_deployment_id, expected_project_id, expected_deployment_role,
    expected_commit_sha, expected_deployment_url, status, operation_id
  ) values (
    p_request_id, campaign.id, campaign.owner_id, p_correlation_id, p_nonce,
    binding.deployment_id, binding.vercel_project_id, binding.deployment_role,
    binding.commit_sha, binding.immutable_deployment_origin, 'prepared', p_operation_id
  ) on conflict (campaign_id) do nothing;
  select * into strict claimed from private.activation_runtime_config_requests
  where campaign_id = campaign.id for update;
  if row(claimed.request_id, claimed.correlation_id, claimed.nonce,
    claimed.operation_id, claimed.expected_deployment_id, claimed.expected_project_id,
    claimed.expected_deployment_role, claimed.expected_commit_sha,
    claimed.expected_deployment_url)
    is distinct from row(p_request_id, p_correlation_id, p_nonce, p_operation_id,
      binding.deployment_id, binding.vercel_project_id, binding.deployment_role,
      binding.commit_sha, binding.immutable_deployment_origin)
  then
    raise exception using errcode = '55000', message = 'runtime configuration request identity is immutable; reconcile the original request';
  end if;
  if campaign.state = 'runtime_identity_verified' then
    perform private.transition_no_ai_shadow_dry_run(
      campaign.id, 'runtime_identity_verified',
      'runtime_config_attestation_requested', 'owner',
      campaign.prepared_commit_sha, campaign.config_version, p_correlation_id,
      jsonb_build_object('request_id', p_request_id, 'nonce_recorded', true,
        'immutable_deployment_url', true)
    );
  end if;
  return jsonb_build_object('request_id', claimed.request_id,
    'correlation_id', claimed.correlation_id, 'status', claimed.status,
    'deployment_id', claimed.expected_deployment_id);
end;
$$;

create function private.submit_activation_runtime_config_attestation(
  p_campaign_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  request_row private.activation_runtime_config_requests%rowtype;
  binding private.activation_deployment_bindings%rowtype;
  configured_url text;
  shared_secret text;
  transport_id bigint;
begin
  select * into strict campaign from private.no_ai_shadow_dry_runs
  where id = p_campaign_id for update;
  select * into strict request_row from private.activation_runtime_config_requests
  where campaign_id = campaign.id for update;
  select * into strict binding from private.activation_deployment_bindings
  where campaign_id = campaign.id and deployment_role = 'no_ai_runtime_enabled';
  if request_row.pg_net_request_id is not null then
    return request_row.pg_net_request_id;
  end if;
  if request_row.status <> 'prepared'
    or campaign.state <> 'runtime_config_attestation_requested'
  then
    raise exception using errcode = '55000', message = 'runtime configuration attestation must reconcile the existing request';
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
  if configured_url <> campaign.scheduler_url or length(shared_secret) < 32
    or binding.runtime_config_url is null
  then
    raise exception using errcode = '55000', message = 'runtime attestation identity changed before submission';
  end if;
  execute $query$
    select net.http_post(
      url := $1,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || $2),
      body := $3,
      timeout_milliseconds := $4
    )
  $query$ into transport_id using binding.runtime_config_url, shared_secret,
    jsonb_build_object(
      'schema_version', 4,
      'mode', 'runtime_config_noop',
      'deployment_role', binding.deployment_role,
      'campaign_id', campaign.id,
      'correlation_id', request_row.correlation_id,
      'request_id', request_row.request_id,
      'nonce', request_row.nonce,
      'expected_deployment_id', binding.deployment_id,
      'expected_project_id', binding.vercel_project_id,
      'expected_commit_sha', binding.commit_sha
    ), campaign.max_request_seconds * 1000;
  update private.activation_runtime_config_requests
  set pg_net_request_id = transport_id, status = 'submitted',
      submitted_at = statement_timestamp()
  where request_id = request_row.request_id;
  return transport_id;
end;
$$;

create function private.capture_activation_runtime_config_response(
  p_campaign_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  request_row private.activation_runtime_config_requests%rowtype;
  binding private.activation_deployment_bindings%rowtype;
  transport record;
  body jsonb;
  runtime jsonb;
  valid boolean;
  parsed_observed_at timestamptz;
begin
  select * into strict campaign from private.no_ai_shadow_dry_runs
  where id = p_campaign_id;
  select * into strict request_row from private.activation_runtime_config_requests
  where campaign_id = campaign.id for update;
  select * into strict binding from private.activation_deployment_bindings
  where campaign_id = campaign.id and deployment_role = 'no_ai_runtime_enabled';
  if exists (
    select 1 from private.activation_runtime_config_evidence
    where request_id = request_row.request_id
  ) then
    return true;
  end if;
  if request_row.pg_net_request_id is null then
    raise exception using errcode = '55000', message = 'runtime configuration request has no transport identity';
  end if;
  execute $query$
    select true as present, status_code, content_type, headers,
      timed_out, error_msg, content
    from net._http_response where id = $1
  $query$ into transport using request_row.pg_net_request_id;
  if transport.present is distinct from true then
    if request_row.submitted_at is not null and statement_timestamp() >=
      request_row.submitted_at
        + make_interval(secs => campaign.max_request_seconds + campaign.drain_safety_seconds)
    then
      update private.activation_runtime_config_requests
      set status = 'transport_missing', terminal_at = statement_timestamp()
      where request_id = request_row.request_id;
    end if;
    return false;
  end if;
  body := null;
  begin
    body := transport.content::jsonb;
    parsed_observed_at := (body ->> 'observed_at')::timestamptz;
  exception when others then
    body := null;
    parsed_observed_at := null;
  end;
  runtime := body -> 'runtime';
  valid := coalesce(transport.status_code = 200, false)
    and lower(coalesce(transport.content_type, '')) = 'application/json'
    and lower(coalesce(
      transport.headers ->> 'cache-control',
      transport.headers ->> 'Cache-Control',
      ''
    )) = 'no-store'
    and not coalesce(transport.timed_out, true)
    and transport.error_msg is null
    and jsonb_typeof(body) = 'object'
    and (select array_agg(key order by key) from jsonb_object_keys(body) as key) = array[
      'agent_disabled', 'campaign_id', 'commit_sha', 'correlation_id',
      'counters', 'deployment_id', 'deployment_role', 'deployment_url', 'mode',
      'nonce', 'observed_at', 'project_id', 'request_id', 'runtime',
      'scheduler_disabled', 'schema_version', 'status', 'terminal_reason',
      'vercel_environment', 'vercel_target_environment'
    ]::text[]
    and body -> 'schema_version' = '4'::jsonb
    and body ->> 'mode' = 'runtime_config_noop'
    and body ->> 'deployment_role' = 'no_ai_runtime_enabled'
    and private.activation_safe_uuid(body ->> 'campaign_id') = campaign.id
    and private.activation_safe_uuid(body ->> 'correlation_id') = request_row.correlation_id
    and private.activation_safe_uuid(body ->> 'request_id') = request_row.request_id
    and private.activation_safe_uuid(body ->> 'nonce') = request_row.nonce
    and body ->> 'vercel_environment' = 'production'
    and body ->> 'vercel_target_environment' = 'production'
    and body ->> 'deployment_id' = binding.deployment_id
    and body ->> 'project_id' = binding.vercel_project_id
    and body ->> 'commit_sha' = binding.commit_sha
    and body ->> 'deployment_url' = binding.immutable_deployment_origin
    and body ->> 'status' = 'runtime_config_observed'
    and body ->> 'terminal_reason' = 'runtime_config_attested'
    and body -> 'scheduler_disabled' = 'false'::jsonb
    and body -> 'agent_disabled' = 'true'::jsonb
    and parsed_observed_at between coalesce(request_row.submitted_at, request_row.claimed_at) - interval '5 seconds'
      and statement_timestamp() + interval '60 seconds'
    and jsonb_typeof(runtime) = 'object'
    and (select array_agg(key order by key) from jsonb_object_keys(runtime) as key) = array[
      'agent_enabled', 'agent_execution_mode',
      'autonomous_paper_execution_enabled', 'data_mode', 'execution_mode',
      'market_data_provider', 'news_provider', 'openai_api_key_present',
      'openai_canary_enabled', 'openai_web_search_enabled',
      'paid_model_calls_enabled', 'real_broker_enabled', 'scheduler_enabled',
      'scheduler_provider', 'sol_challenger_enabled', 'sol_enabled',
      'sol_live_execution_enabled'
    ]::text[]
    and runtime -> 'scheduler_enabled' = 'true'::jsonb
    and runtime ->> 'scheduler_provider' = 'supabase'
    and runtime -> 'agent_enabled' = 'false'::jsonb
    and runtime ->> 'agent_execution_mode' = 'mock'
    and runtime -> 'autonomous_paper_execution_enabled' = 'false'::jsonb
    and runtime -> 'paid_model_calls_enabled' = 'false'::jsonb
    and runtime -> 'openai_canary_enabled' = 'false'::jsonb
    and runtime -> 'openai_web_search_enabled' = 'false'::jsonb
    and runtime -> 'sol_enabled' = 'false'::jsonb
    and runtime -> 'sol_challenger_enabled' = 'false'::jsonb
    and runtime -> 'sol_live_execution_enabled' = 'false'::jsonb
    and runtime -> 'real_broker_enabled' = 'false'::jsonb
    and runtime ->> 'market_data_provider' = 'mock'
    and runtime ->> 'news_provider' = 'mock'
    and runtime -> 'openai_api_key_present' = 'false'::jsonb
    and runtime ->> 'data_mode' = 'mock'
    and runtime ->> 'execution_mode' = 'paper'
    and private.activation_zero_counters_valid(body -> 'counters');
  insert into private.activation_runtime_config_evidence (
    request_id, campaign_id, owner_id, pg_net_request_id, http_status,
    timed_out, error_class, schema_valid, response_campaign_id,
    response_correlation_id, response_request_id, response_nonce,
    response_deployment_role, response_environment,
    response_target_environment, response_deployment_id, response_project_id,
    response_commit_sha, response_deployment_url, response_status,
    response_terminal_reason, response_observed_at, scheduler_disabled,
    agent_disabled, runtime_config, counters
  ) values (
    request_row.request_id, campaign.id, campaign.owner_id,
    request_row.pg_net_request_id, transport.status_code,
    coalesce(transport.timed_out, true),
    case
      when transport.error_msg is not null then 'transport_error'
      when transport.status_code between 300 and 399 then 'redirect_rejected'
      when transport.status_code is distinct from 200 then 'unexpected_http_status'
      when not valid then 'invalid_response_schema'
      else null
    end,
    valid, private.activation_safe_uuid(body ->> 'campaign_id'),
    private.activation_safe_uuid(body ->> 'correlation_id'),
    private.activation_safe_uuid(body ->> 'request_id'),
    private.activation_safe_uuid(body ->> 'nonce'), body ->> 'deployment_role',
    body ->> 'vercel_environment', body ->> 'vercel_target_environment',
    body ->> 'deployment_id', body ->> 'project_id', body ->> 'commit_sha',
    body ->> 'deployment_url', body ->> 'status', body ->> 'terminal_reason',
    parsed_observed_at,
    case when jsonb_typeof(body -> 'scheduler_disabled') = 'boolean'
      then (body ->> 'scheduler_disabled')::boolean else null end,
    case when jsonb_typeof(body -> 'agent_disabled') = 'boolean'
      then (body ->> 'agent_disabled')::boolean else null end,
    case when jsonb_typeof(runtime) = 'object' then runtime else null end,
    case when jsonb_typeof(body -> 'counters') = 'object'
      then body -> 'counters' else null end
  );
  update private.activation_runtime_config_requests
  set status = case when valid then 'transport_terminal' else 'invalid' end,
      terminal_at = statement_timestamp()
  where request_id = request_row.request_id;
  return true;
end;
$$;

create function private.verify_activation_runtime_config_attestation(
  p_campaign_id uuid,
  p_commit_sha text,
  p_config_version text,
  p_manifest_sha256 text,
  p_phase_contract_sha256 text,
  p_database_fingerprint text,
  p_correlation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  request_row private.activation_runtime_config_requests%rowtype;
begin
  campaign := private.assert_activation_context(
    p_campaign_id, p_commit_sha, p_config_version, p_manifest_sha256,
    p_phase_contract_sha256, p_database_fingerprint
  );
  if campaign.state = 'runtime_config_verified' then
    return;
  end if;
  if campaign.state <> 'runtime_config_attestation_requested' then
    raise exception using errcode = '55000', message = 'runtime configuration verification is unavailable from the persisted state';
  end if;
  perform private.capture_activation_runtime_config_response(campaign.id);
  select * into strict request_row from private.activation_runtime_config_requests
  where campaign_id = campaign.id for update;
  if request_row.status <> 'transport_terminal'
    or not exists (
      select 1 from private.activation_runtime_config_evidence
      where request_id = request_row.request_id and http_status = 200
        and not timed_out and error_class is null and schema_valid
    )
  then
    raise exception using errcode = '55000', message = 'exact runtime configuration evidence is not durably verified';
  end if;
  perform private.capture_activation_relation_snapshot(
    campaign.id, 'post_runtime_config', 0
  );
  if not private.activation_snapshots_match(
    campaign.id, 'pre_runtime_config', 0, 'post_runtime_config', 0
  ) then
    raise exception using errcode = '55000', message = 'runtime configuration attestation caused a forbidden side effect';
  end if;
  perform private.assert_activation_controls(campaign.id, false);
  perform private.assert_activation_job_specs(campaign.id, false);
  update private.activation_runtime_config_requests set status = 'verified'
  where request_id = request_row.request_id;
  perform private.transition_no_ai_shadow_dry_run(
    campaign.id, 'runtime_config_attestation_requested',
    'runtime_config_verified', 'system', campaign.prepared_commit_sha,
    campaign.config_version, p_correlation_id,
    jsonb_build_object('request_id', request_row.request_id,
      'exact_runtime_schema', true, 'forbidden_effect_count', 0,
      'actual_configuration_observed', true)
  );
end;
$$;

create function private.finalize_activation_runtime_deployment(
  p_campaign_id uuid,
  p_operation_id uuid,
  p_correlation_id uuid,
  p_commit_sha text,
  p_config_version text,
  p_manifest_sha256 text,
  p_phase_contract_sha256 text,
  p_database_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  request_row private.activation_runtime_config_requests%rowtype;
  evidence private.activation_runtime_config_evidence%rowtype;
  binding private.activation_deployment_bindings%rowtype;
begin
  campaign := private.assert_activation_context(
    p_campaign_id, p_commit_sha, p_config_version, p_manifest_sha256,
    p_phase_contract_sha256, p_database_fingerprint
  );
  select * into strict request_row from private.activation_runtime_config_requests
  where campaign_id = campaign.id;
  select * into strict evidence from private.activation_runtime_config_evidence
  where request_id = request_row.request_id;
  select * into strict binding from private.activation_deployment_bindings
  where campaign_id = campaign.id and deployment_role = 'no_ai_runtime_enabled';
  if campaign.state = 'runtime_deployment_verified' then
    if not exists (
      select 1 from private.no_ai_shadow_dry_run_transitions
      where dry_run_id = campaign.id and from_state = 'runtime_config_verified'
        and to_state = 'runtime_deployment_verified'
        and correlation_id = p_correlation_id
        and evidence ->> 'operation_id' = p_operation_id::text
    ) then
      raise exception using errcode = '55000', message = 'runtime deployment finalization operation identity drifted';
    end if;
    return jsonb_build_object('state', campaign.state, 'reused', true);
  end if;
  if campaign.state <> 'runtime_config_verified'
    or request_row.status <> 'verified' or not evidence.schema_valid
    or evidence.response_deployment_id <> binding.deployment_id
    or evidence.response_deployment_url <> binding.immutable_deployment_origin
    or evidence.response_commit_sha <> campaign.prepared_commit_sha
    or evidence.response_project_id <> binding.vercel_project_id
  then
    raise exception using errcode = '55000', message = 'runtime deployment cannot be released without exact observed configuration';
  end if;
  perform private.assert_activation_controls(campaign.id, false);
  perform private.assert_activation_job_specs(campaign.id, false);
  perform private.transition_no_ai_shadow_dry_run(
    campaign.id, 'runtime_config_verified', 'runtime_deployment_verified',
    'owner', campaign.prepared_commit_sha, campaign.config_version,
    p_correlation_id, jsonb_build_object('operation_id', p_operation_id,
      'request_id', request_row.request_id, 'deployment_id', binding.deployment_id,
      'actual_configuration_observed', true)
  );
  return jsonb_build_object('state', 'runtime_deployment_verified',
    'deployment_id', binding.deployment_id, 'reused', false);
end;
$$;

-- A metadata classification alone cannot authorize a mutation. These four
-- previously table-wide exceptions are guarded at row level by an internal,
-- transaction-local operation context set only by the narrow activation
-- functions below. Direct DML, another owner/campaign, another state, another
-- column, DELETE/TRUNCATE, and a second storage row all fail closed.
create function private.guard_activation_bounded_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  context_campaign uuid := private.activation_safe_uuid(
    current_setting('capital_lab.activation_campaign_id', true)
  );
  context_operation text := current_setting(
    'capital_lab.activation_operation', true
  );
  context_operation_id uuid := private.activation_safe_uuid(
    current_setting('capital_lab.activation_operation_id', true)
  );
  active_count integer;
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  changed text[] := array[]::text[];
  row_owner uuid;
  row_key text;
begin
  select count(*) into active_count
  from private.no_ai_shadow_dry_runs
  where state not in ('passed', 'failed', 'inconclusive', 'aborted');
  if active_count = 0 then
    if tg_op = 'TRUNCATE' then
      return null;
    elsif tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if active_count <> 1 or context_campaign is null or context_operation_id is null then
    raise exception using errcode = '55000', message = 'activation mutation lacks an exact campaign and operation context';
  end if;
  select * into strict campaign from private.no_ai_shadow_dry_runs
  where id = context_campaign
    and state not in ('passed', 'failed', 'inconclusive', 'aborted')
  for update;
  if tg_op = 'TRUNCATE' or tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'activation bounded relations forbid DELETE and TRUNCATE';
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(key order by key), array[]::text[])
    into changed
    from jsonb_object_keys(new_row) as key
    where new_row -> key is distinct from old_row -> key;
  end if;
  row_owner := private.activation_safe_uuid(new_row ->> 'owner_id');
  if row_owner is distinct from campaign.owner_id then
    raise exception using errcode = '55000', message = 'activation mutation owner differs from the campaign';
  end if;

  if tg_table_schema = 'private' and tg_table_name = 'audit_log' then
    raise exception using errcode = '55000', message = 'activation does not permit audit-log side effects';
  elsif tg_table_schema = 'private' and tg_table_name = 'application_settings' then
    row_key := new_row ->> 'setting_key';
    if tg_op = 'UPDATE' and not changed <@ array['value', 'version', 'updated_at']::text[] then
      raise exception using errcode = '55000', message = 'activation setting update changed a forbidden column';
    end if;
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
      raise exception using errcode = '55000', message = 'activation setting mutation is outside the reviewed row transition';
    end if;
  elsif tg_table_schema = 'public' and tg_table_name = 'experiment_controls' then
    if tg_op <> 'UPDATE'
      or not changed <@ array[
        'scheduler_enabled', 'agent_enabled', 'emergency_paused',
        'pause_reason', 'state_version', 'updated_at'
      ]::text[]
      or new_row -> 'scheduler_enabled' <> 'false'::jsonb
      or new_row -> 'agent_enabled' <> 'false'::jsonb
      or new_row -> 'emergency_paused' <> 'true'::jsonb
      or context_operation not in ('emergency_kill', 'control_snapshot')
      or (context_operation = 'control_snapshot'
        and new_row ->> 'pause_reason' <> 'database_storage_90_percent')
    then
      raise exception using errcode = '55000', message = 'activation experiment-control mutation is outside the reviewed transition';
    end if;
  elsif tg_table_schema = 'public' and tg_table_name = 'storage_monitor_snapshots' then
    if tg_op <> 'INSERT' or context_operation <> 'control_snapshot'
      or current_setting('capital_lab.activation_storage_inserted', true) = 'true'
      or new_row ->> 'captured_on' <> (statement_timestamp() at time zone 'UTC')::date::text
    then
      raise exception using errcode = '55000', message = 'activation storage evidence exceeds its one-row operation bound';
    end if;
    perform set_config('capital_lab.activation_storage_inserted', 'true', true);
  else
    raise exception using errcode = '55000', message = 'activation mutation guard was attached to an unknown relation';
  end if;

  insert into private.activation_mutation_evidence (
    campaign_id, owner_id, relation_name, mutation_kind,
    operation_id, row_identity, changed_columns
  ) values (
    campaign.id, campaign.owner_id, tg_table_schema || '.' || tg_table_name,
    tg_op, context_operation_id,
    jsonb_build_object(
      'owner_id', campaign.owner_id,
      'setting_key', case when tg_table_name = 'application_settings' then row_key else null end,
      'row_id', case when new_row ? 'id' then new_row ->> 'id' else null end
    ), changed
  );
  return new;
end;
$$;

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'private.application_settings', 'private.audit_log',
    'public.experiment_controls', 'public.storage_monitor_snapshots'
  ] loop
    execute format(
      'create trigger %I before insert or update or delete on %s '
        || 'for each row execute function private.guard_activation_bounded_mutation()',
      replace(relation_name, '.', '_') || '_activation_bounded_mutation',
      relation_name
    );
    execute format(
      'create trigger %I before truncate on %s '
        || 'for each statement execute function private.guard_activation_bounded_mutation()',
      replace(relation_name, '.', '_') || '_activation_bounded_truncate',
      relation_name
    );
  end loop;
end;
$$;

create or replace function private.capture_activation_control_snapshot(
  p_campaign_id uuid,
  p_snapshot_sequence bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  persisted private.activation_control_snapshots%rowtype;
  storage_result jsonb;
  dangerous_count integer;
  dangerous_wrong integer;
  control_count integer;
  scheduler_count integer;
  agent_count integer;
  non_paused_count integer;
begin
  if p_snapshot_sequence < 0 then
    raise exception using errcode = '22023', message = 'control snapshot sequence is invalid';
  end if;
  select * into strict campaign from private.no_ai_shadow_dry_runs
  where id = p_campaign_id;
  select count(*), count(*) filter (where value <> 'false'::jsonb)
  into dangerous_count, dangerous_wrong
  from private.application_settings
  where owner_id = campaign.owner_id and setting_key in (
    'scheduler_enabled', 'agent_enabled',
    'autonomous_paper_execution_enabled', 'paid_model_calls_enabled',
    'openai_canary_enabled', 'openai_web_search_enabled',
    'sol_challenger_enabled', 'sol_live_execution_enabled', 'real_broker_enabled'
  );
  select count(*), count(*) filter (where scheduler_enabled),
    count(*) filter (where agent_enabled), count(*) filter (where not emergency_paused)
  into control_count, scheduler_count, agent_count, non_paused_count
  from public.experiment_controls where owner_id = campaign.owner_id;
  select * into persisted from private.activation_control_snapshots
  where campaign_id = campaign.id and snapshot_sequence = p_snapshot_sequence;
  if persisted.id is not null then
    if row(persisted.dangerous_setting_count, persisted.dangerous_non_false_count,
      persisted.experiment_control_count, persisted.scheduler_enabled_count,
      persisted.agent_enabled_count, persisted.non_paused_count)
      is distinct from row(dangerous_count, dangerous_wrong, control_count,
      scheduler_count, agent_count, non_paused_count)
    then
      raise exception using errcode = '55000', message = 'persisted control baseline differs on retry';
    end if;
    return;
  end if;
  perform set_config('capital_lab.activation_campaign_id', campaign.id::text, true);
  perform set_config('capital_lab.activation_operation', 'control_snapshot', true);
  perform set_config('capital_lab.activation_operation_id',
    private.activation_deterministic_uuid(
      campaign.id, 'control-snapshot:' || p_snapshot_sequence::text
    )::text, true);
  perform set_config('capital_lab.activation_storage_inserted', 'false', true);
  storage_result := private.capture_storage_monitor_snapshot(campaign.owner_id, 524288000);
  insert into private.activation_control_snapshots (
    campaign_id, owner_id, snapshot_sequence, dangerous_setting_count,
    dangerous_non_false_count, experiment_control_count,
    scheduler_enabled_count, agent_enabled_count, non_paused_count,
    storage_snapshot_id
  ) values (
    campaign.id, campaign.owner_id, p_snapshot_sequence, dangerous_count,
    dangerous_wrong, control_count, scheduler_count, agent_count,
    non_paused_count, (storage_result ->> 'snapshot_id')::uuid
  );
  perform set_config('capital_lab.activation_campaign_id', '', true);
  perform set_config('capital_lab.activation_operation', '', true);
  perform set_config('capital_lab.activation_operation_id', '', true);
  perform set_config('capital_lab.activation_storage_inserted', '', true);
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
begin
  select * into strict campaign from private.no_ai_shadow_dry_runs
  where id = p_campaign_id for update;
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
      version = case when private.application_settings.value = 'false'::jsonb
        then private.application_settings.version
        else private.application_settings.version + 1 end;
  update public.experiment_controls
  set scheduler_enabled = false, agent_enabled = false,
      emergency_paused = true,
      pause_reason = coalesce(pause_reason, 'activation_emergency_kill'),
      state_version = case when scheduler_enabled or agent_enabled or not emergency_paused
        then state_version + 1 else state_version end
  where owner_id = campaign.owner_id;
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

create or replace function private.arm_activation_campaign(
  p_campaign_id uuid,
  p_commit_sha text,
  p_config_version text,
  p_manifest_sha256 text,
  p_phase_contract_sha256 text,
  p_database_fingerprint text,
  p_operation_id uuid,
  p_correlation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign private.no_ai_shadow_dry_runs%rowtype;
  updated_count integer;
begin
  campaign := private.assert_activation_context(
    p_campaign_id, p_commit_sha, p_config_version, p_manifest_sha256,
    p_phase_contract_sha256, p_database_fingerprint
  );
  if campaign.state = 'armed' then
    if not exists (
      select 1 from private.no_ai_shadow_dry_run_transitions as transition
      where transition.dry_run_id = campaign.id and transition.to_state = 'armed'
        and transition.correlation_id = p_correlation_id
        and transition.evidence ->> 'operation_id' = p_operation_id::text
    ) then
      raise exception using errcode = '55000', message = 'arm retry operation identity drifted';
    end if;
    perform private.assert_activation_controls(campaign.id, true);
    perform private.assert_activation_job_specs(campaign.id, true);
    return;
  end if;
  if campaign.state <> 'baseline_frozen'
    or campaign.planned_start_at < statement_timestamp() + interval '900 seconds'
    or campaign.expected_slot_count <> 52 or campaign.expected_event_count <> 104
    or not exists (
      select 1 from private.activation_deployment_bindings as runtime_binding
      where runtime_binding.campaign_id = campaign.id
        and runtime_binding.deployment_role = 'no_ai_runtime_enabled'
        and runtime_binding.deployment_id <> campaign.production_deployment_id
        and runtime_binding.commit_sha = campaign.prepared_commit_sha
        and runtime_binding.vercel_project_id = 'prj_pbCNwlmXZLeZprZpsRAfAAhPPXVR'
        and runtime_binding.vercel_team_id = 'team_yqndKHk6nfWGlte1UVLTJOHG'
        and runtime_binding.environment = 'production'
        and runtime_binding.target = 'production'
        and runtime_binding.ready_state = 'READY'
        and runtime_binding.scheduler_enabled
    )
  then
    raise exception using errcode = '55000', message = 'activation lead time, state, or frozen counts are invalid';
  end if;
  perform private.assert_activation_controls(campaign.id, false);
  perform private.assert_activation_job_specs(campaign.id, false);
  perform private.verify_activation_vault_scope(campaign.id);
  if campaign.manifest #>> '{providers,market_data}' <> 'mock'
    or campaign.manifest #>> '{providers,news}' <> 'mock'
    or campaign.manifest #>> '{providers,execution}' <> 'paper'
    or not private.activation_snapshots_match(
      campaign.id, 'pre_dry_run', 0, 'pre_dry_run', 0
    )
    or exists (
      select 1 from public.experiments
      where owner_id = campaign.owner_id and lifecycle_status = 'active'
    )
  then
    raise exception using errcode = '55000', message = 'activation data-mode or baseline invariant failed';
  end if;
  perform set_config('capital_lab.activation_campaign_id', campaign.id::text, true);
  perform set_config('capital_lab.activation_operation', 'arm', true);
  perform set_config('capital_lab.activation_operation_id', p_operation_id::text, true);
  update private.application_settings
  set value = 'true'::jsonb, version = version + 1
  where owner_id = campaign.owner_id and setting_key = 'scheduler_enabled';
  get diagnostics updated_count = row_count;
  perform set_config('capital_lab.activation_campaign_id', '', true);
  perform set_config('capital_lab.activation_operation', '', true);
  perform set_config('capital_lab.activation_operation_id', '', true);
  if updated_count <> 1 then
    raise exception using errcode = '55000', message = 'scheduler control row is missing';
  end if;
  update private.no_ai_shadow_dry_runs set scheduler_control_enabled = true
  where id = campaign.id;
  perform private.set_activation_jobs_active(
    campaign.id, true, p_operation_id, p_correlation_id
  );
  perform private.transition_no_ai_shadow_dry_run(
    campaign.id, 'baseline_frozen', 'armed', 'owner',
    campaign.prepared_commit_sha, campaign.config_version, p_correlation_id,
    jsonb_build_object('operation_id', p_operation_id, 'jobs_exactly_verified', true,
      'dangerous_settings_false_before_arm', 9, 'lead_seconds_minimum', 900)
  );
end;
$$;

revoke all on function private.guard_activation_bounded_mutation()
from public, anon, authenticated, service_role;

revoke all on function private.protect_activation_runtime_config_request()
from public, anon, authenticated, service_role;
revoke all on function private.assert_activation_expected_mutation_rules()
from public, anon, authenticated, service_role;
revoke all on function private.claim_activation_runtime_config_attestation(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.submit_activation_runtime_config_attestation(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.capture_activation_runtime_config_response(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.verify_activation_runtime_config_attestation(
  uuid, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.finalize_activation_runtime_deployment(
  uuid, uuid, uuid, text, text, text, text, text
) from public, anon, authenticated, service_role;

commit;
