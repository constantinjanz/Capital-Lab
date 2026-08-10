\set ON_ERROR_STOP on

begin;

do $$
begin
  if to_regnamespace('extensions') is null
    or to_regnamespace('vault') is null
    or to_regclass('auth.users') is null
    or to_regprocedure('auth.uid()') is null
    or to_regclass('storage.buckets') is null
    or to_regclass('vault.secrets') is null
    or not exists (
      select 1
      from pg_catalog.pg_publication as publication
      where publication.pubname = 'supabase_realtime'
        and publication.puballtables = false
        and publication.pubinsert
        and publication.pubupdate
        and publication.pubdelete
        and publication.pubtruncate
    )
    or exists (
      select 1
      from pg_catalog.pg_publication as publication
      join pg_catalog.pg_publication_rel as relation
        on relation.prpubid = publication.oid
      where publication.pubname = 'supabase_realtime'
    )
  then
    raise exception using
      errcode = '55000',
      message = 'restore target is not a provisioned Supabase baseline';
  end if;
end;
$$;

commit;
