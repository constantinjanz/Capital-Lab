\set ON_ERROR_STOP on
select jsonb_build_object(
  'schema_version', 1,
  'relations', jsonb_build_object(
    'experiments', (select jsonb_build_object(
      'row_count', count(*)::text,
      'content_checksum', md5(coalesce(string_agg(id::text || ':' || lifecycle_status, '|' order by id), ''))
    ) from public.experiments),
    'orders', (select jsonb_build_object(
      'row_count', count(*)::text,
      'content_checksum', md5(coalesce(string_agg(
        id::text || ':' || quantity::text || ':' || filled_quantity::text || ':'
          || coalesce(limit_price::text, '') || ':' || coalesce(stop_price::text, '')
          || ':' || current_status,
        '|' order by id
      ), ''))
    ) from public.orders),
    'fills', (select jsonb_build_object(
      'row_count', count(*)::text,
      'content_checksum', md5(coalesce(string_agg(
        id::text || ':' || quantity::text || ':' || execution_price::text || ':'
          || notional::text || ':' || commission::text || ':'
          || regulatory_fee::text || ':' || slippage_amount::text,
        '|' order by id
      ), ''))
    ) from public.fills),
    'cash_ledger_entries', (select jsonb_build_object(
      'row_count', count(*)::text,
      'content_checksum', md5(coalesce(string_agg(
        id::text || ':' || simulation_account_id::text || ':' || entry_type
          || ':' || currency || ':' || amount::text || ':' || effective_at::text,
        '|' order by id
      ), '')),
      'duplicate_id_count', (count(*) - count(distinct id))::text,
      'currency_totals', coalesce((
        select jsonb_object_agg(currency, amount order by currency)
        from (
          select currency, sum(amount)::text as amount
          from private.cash_ledger_entries group by currency
        ) as totals
      ), '{}'::jsonb)
    ) from private.cash_ledger_entries),
    'ai_budget_reservations', (select jsonb_build_object(
      'row_count', count(*)::text,
      'content_checksum', md5(coalesce(string_agg(
        id::text || ':' || status || ':' || reserved_amount::text || ':'
          || coalesce(settled_amount::text, ''),
        '|' order by id
      ), ''))
    ) from private.ai_budget_reservations),
    'ai_usage_events', (select jsonb_build_object(
      'row_count', count(*)::text,
      'content_checksum', md5(coalesce(string_agg(
        id::text || ':' || reservation_id::text || ':' || actual_cost::text
          || ':' || finish_state,
        '|' order by id
      ), ''))
    ) from private.ai_usage_events),
    'scheduler_slots', (select jsonb_build_object(
      'row_count', count(*)::text,
      'content_checksum', md5(coalesce(string_agg(
        slot_key || ':' || status || ':' || slot_at::text,
        '|' order by slot_key
      ), ''))
    ) from private.scheduler_slots),
    'scheduler_runs', (select jsonb_build_object(
      'row_count', count(*)::text,
      'content_checksum', md5(coalesce(string_agg(
        id::text || ':' || slot_key || ':' || status,
        '|' order by id
      ), ''))
    ) from private.scheduler_runs)
  )
) as evidence;
