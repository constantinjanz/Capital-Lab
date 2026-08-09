\set ON_ERROR_STOP on
begin;

select private.plan_no_ai_shadow_dry_run(
  '6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001',
  :'activated_at'::timestamptz,
  :'decision_at'::timestamptz
) as plan_evidence \gset

select private.capture_storage_monitor_snapshot(
  (select owner_id from private.no_ai_shadow_dry_runs
   where id = '6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001'),
  524288000
);

do $$
begin
  if not exists (
    select 1 from public.storage_monitor_snapshots
    where owner_id = (
      select owner_id from private.no_ai_shadow_dry_runs
      where id = '6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001'
    ) and threshold_state not in ('block_raw_85', 'pause_90')
  ) then
    raise exception 'safe storage baseline is unavailable';
  end if;
end;
$$;

select private.freeze_no_ai_shadow_dry_run_baseline(
  '6f4d4ac2-bbcb-4f2a-9a5e-5b05ead8d001',
  :'expected_commit_sha', :'config_version', :'correlation_id'::uuid
);

select jsonb_build_object(
  'schema_version', 1,
  'phase', 'baseline_frozen',
  'plan', :'plan_evidence'::jsonb,
  'expected_slots', 52,
  'expected_events', 104,
  'model_calls', 0,
  'orders', 0,
  'fills', 0,
  'ledger_entries', 0
) as evidence;

commit;
