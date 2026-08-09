\set ON_ERROR_STOP on
begin;

select set_config('capital_lab.auth_noop_request_id', :'auth_noop_request_id', true) \gset
select status_code as auth_noop_http_status
from net._http_response
where id = :'auth_noop_request_id'::bigint \gset

do $$
declare
  response record;
begin
  select status_code, timed_out, error_msg into strict response
  from net._http_response
  where id = current_setting('capital_lab.auth_noop_request_id')::bigint;
  if response.status_code not between 200 and 299
    or coalesce(response.timed_out, true) or response.error_msg is not null
  then
    raise exception 'authorized scheduler no-op response did not pass';
  end if;
  if exists (
    select 1 from private.no_ai_shadow_dry_run_events
    where dry_run_id = '6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001'
      and (cron_trigger_count <> 0 or authenticated_count <> 0
        or claimed_cycle_count <> 0)
  ) or exists (
    select 1 from private.scheduler_slots
    where slot_key like 'no-ai-infrastructure:%'
  ) then
    raise exception 'auth/no-op gate produced a scheduler side effect';
  end if;
end;
$$;

select private.verify_no_ai_shadow_auth_noop(
  '6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001',
  :'auth_noop_request_id'::bigint, :'auth_noop_http_status'::integer,
  :'expected_commit_sha', :'config_version', :'correlation_id'::uuid
);

select jsonb_build_object(
  'schema_version', 1,
  'phase', 'auth_noop_verified',
  'pg_net_request_id', :'auth_noop_request_id',
  'authenticated', true,
  'side_effect_count', 0,
  'secret_values_returned', false
) as evidence;

commit;
