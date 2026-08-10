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
  then
    raise exception using
      errcode = '55000',
      message = 'restore target is not a provisioned Supabase baseline';
  end if;
end;
$$;

commit;
