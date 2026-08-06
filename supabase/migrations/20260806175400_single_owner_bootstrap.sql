begin;

create unique index app_users_singleton_idx
on public.app_users ((true));

create table private.owner_bootstrap_config (
  singleton boolean primary key default true check (singleton),
  expected_email extensions.citext not null,
  consumed_by uuid unique references auth.users(id) on delete restrict,
  consumed_at timestamptz,
  configured_at timestamptz not null default statement_timestamp(),
  check ((consumed_by is null) = (consumed_at is null))
);

alter table private.owner_bootstrap_config enable row level security;
alter table private.owner_bootstrap_config force row level security;

revoke all on private.owner_bootstrap_config from public, anon, authenticated;
grant select, insert, update, delete on private.owner_bootstrap_config to service_role;

create function private.bootstrap_first_owner()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester auth.users%rowtype;
  bootstrap_config private.owner_bootstrap_config%rowtype;
  existing_owner_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('capital-lab:first-owner', 0));

  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  select * into requester
  from auth.users
  where id = auth.uid();

  if not found or requester.email is null or requester.email_confirmed_at is null then
    raise exception using errcode = '42501', message = 'confirmed email required';
  end if;

  select user_id into existing_owner_id
  from public.app_users
  limit 1;

  if existing_owner_id = requester.id then
    return jsonb_build_object('status', 'already_bound', 'user_id', requester.id);
  end if;

  if existing_owner_id is not null then
    raise exception using errcode = '42501', message = 'owner already provisioned';
  end if;

  select * into bootstrap_config
  from private.owner_bootstrap_config
  where singleton
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'owner bootstrap is not configured';
  end if;

  if bootstrap_config.consumed_by is not null then
    raise exception using errcode = '42501', message = 'owner bootstrap is already consumed';
  end if;

  if bootstrap_config.expected_email <> requester.email then
    raise exception using errcode = '42501', message = 'email is not authorized for owner bootstrap';
  end if;

  insert into public.app_users(user_id, email, role, is_active)
  values (requester.id, requester.email, 'owner', true);

  update private.owner_bootstrap_config
  set consumed_by = requester.id,
      consumed_at = statement_timestamp()
  where singleton;

  return jsonb_build_object('status', 'bound', 'user_id', requester.id);
end;
$$;

create function public.bootstrap_first_owner()
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.bootstrap_first_owner();
$$;

revoke all on function private.bootstrap_first_owner() from public, anon;
revoke all on function public.bootstrap_first_owner() from public, anon;
grant execute on function private.bootstrap_first_owner() to authenticated;
grant execute on function public.bootstrap_first_owner() to authenticated;

commit;
