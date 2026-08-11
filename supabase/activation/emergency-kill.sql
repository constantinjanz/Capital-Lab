-- Phase 1 only: unconditional DB-first kill. It deliberately performs no Cron,
-- Vercel, transport, audit-finalization, or unschedule work.
\set ON_ERROR_STOP on
begin;
select private.emergency_kill_activation_controls(:'campaign_id'::uuid);
commit;

begin read only;
select jsonb_build_object(
  'schema_version', 3, 'phase', 'emergency-kill',
  'persisted_state', campaign.state,
  'scheduler_control_enabled', campaign.scheduler_control_enabled,
  'false_setting_count', count(*) filter (where setting.value = 'false'::jsonb),
  'expected_setting_count', 9,
  'unpaused_experiment_control_count', (
    select count(*) from public.experiment_controls as control
    where control.owner_id = campaign.owner_id
      and (control.scheduler_enabled or control.agent_enabled or not control.emergency_paused)
  ),
  'stopped_at', campaign.stopped_at,
  'cron_change_attempted', false,
  'vercel_contact_attempted', false
)
from private.no_ai_shadow_dry_runs as campaign
join private.application_settings as setting on setting.owner_id = campaign.owner_id
  and setting.setting_key in (
    'scheduler_enabled', 'agent_enabled', 'autonomous_paper_execution_enabled',
    'paid_model_calls_enabled', 'openai_canary_enabled',
    'openai_web_search_enabled', 'sol_challenger_enabled',
    'sol_live_execution_enabled', 'real_broker_enabled'
  )
where campaign.id = :'campaign_id'::uuid
group by campaign.id;

select exists (
    select 1
    from private.no_ai_shadow_dry_runs as campaign
    where campaign.id = :'campaign_id'::uuid
      and not campaign.scheduler_control_enabled
      and campaign.stopped_at is not null
      and (select count(*) from private.application_settings as setting
        where setting.owner_id = campaign.owner_id
          and setting.setting_key in (
            'scheduler_enabled', 'agent_enabled', 'autonomous_paper_execution_enabled',
            'paid_model_calls_enabled', 'openai_canary_enabled',
            'openai_web_search_enabled', 'sol_challenger_enabled',
            'sol_live_execution_enabled', 'real_broker_enabled'
          ) and setting.value = 'false'::jsonb) = 9
      and not exists (select 1 from public.experiment_controls as control
        where control.owner_id = campaign.owner_id
          and (control.scheduler_enabled or control.agent_enabled or not control.emergency_paused))
  ) as kill_verified
\gset
\if :kill_verified
\else
  \echo 'emergency kill readback failed closed'
  \quit 1
\endif
commit;
