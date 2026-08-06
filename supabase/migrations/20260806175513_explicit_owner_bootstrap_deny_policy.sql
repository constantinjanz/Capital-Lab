begin;

create policy owner_bootstrap_config_deny_clients
on private.owner_bootstrap_config
as restrictive
for all
to authenticated
using (false)
with check (false);

commit;
