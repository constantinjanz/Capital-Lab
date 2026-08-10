# Backup and restore

Capital Lab treats every activation/canary record and every relation in
`supabase/backup/critical-relations.v2.json` as disaster-recovery evidence. The
compact, sorted JSON contract is the single source of truth for the exporter,
manifest writer, restore verifier, row ordering, full-row hashes, column
signatures, and evidence rules. Its bytes and relation-set hash are frozen in
each backup manifest.

Backups are sensitive artifacts. Keep them outside the repository, CI
artifacts, Supabase project, and shared logs. The scripts never print a database
URL, credential, raw row, Vault value, or secret-derived hash.

## Export from one exact source

Start from a clean reviewed Git commit. Supply one direct, TLS-verifying
database URL; the same parsed URL is used for the roles, schema, data, and both
evidence reads. `supabase --linked` and an unrelated `DATABASE_URL` are not a
valid source identity.

```powershell
$env:CAPITAL_LAB_DATABASE_URL = '<redacted direct URL with sslmode=verify-full>'
pnpm backup:critical -- --output-dir=D:\Capital-Lab-Backups
Remove-Item Env:\CAPITAL_LAB_DATABASE_URL
```

The exporter requires pinned Supabase CLI `2.113.0`, a fully clean working tree
including untracked files, and an output directory whose canonical path is
outside the repository. It creates:

The repository ignores only the Supabase CLI's generated local state roots
`supabase/.temp` and `supabase/.branches`; every other tracked or untracked path
still makes the export fail closed. Dirty-path diagnostics contain status and
path only, with credential-file paths redacted.

- a roles dump;
- a schema dump;
- a data dump;
- a canonical manifest containing clean Git SHA, migration filenames and
  SHA-256 values, schema/contract versions, exact relation-set hash, safe source
  fingerprint metadata, tool versions, dump hashes, full relation counts,
  complete content hashes, column signatures, a password-free role-policy
  fingerprint, and evidence-rule results.

Pre- and post-dump evidence must be identical. Any concurrent critical-row or
schema change aborts the export. No production export is part of an activation
code-review run unless separately authorized.

## Seed-free disposable target

Use an empty disposable PostgreSQL/Supabase database on loopback. Do not run
`supabase db reset`: migrations and `supabase/seed.sql` would contaminate the
target and invalidate the restore proof. The target database must contain no
user relations before restore and must not be the source database.

For the local Supabase container, create a blank database explicitly:

```powershell
docker exec supabase_db_capital-lab createdb -U postgres capital_lab_restore
$env:CAPITAL_LAB_RESTORE_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/capital_lab_restore?sslmode=disable'
$env:CAPITAL_LAB_RESTORE_CONFIRM_DISPOSABLE = 'seed-free-disposable-database-confirmed'
pnpm backup:restore:test -- `
  --manifest=D:\Capital-Lab-Backups\capital-lab-<timestamp>-manifest.json
Remove-Item Env:\CAPITAL_LAB_RESTORE_DATABASE_URL
Remove-Item Env:\CAPITAL_LAB_RESTORE_CONFIRM_DISPOSABLE
```

Use the actual local container name reported by `docker ps`; never interpolate a
Hosted hostname. The verifier accepts loopback only and requires the exact
database-name confirmation.

## Restore order and failure contract

The verifier first checks clean HEAD, contract/schema versions, migration list
and checksums, exact relation set, safe source/server fingerprints, artifact
hashes, the password-free role-policy fingerprint, the exact tracked
seed-free-target Prelude checksum, and an empty target. The Prelude creates only
the empty `extensions` schema expected by Supabase CLI dumps; it contains no
table, migration, role, extension, or data. The verifier then restores in this
order:

1. roles (or, for a disposable database in the same PostgreSQL cluster,
   verifies the identical cluster-global role policy without replaying global
   role mutations into the still-running source cluster);
2. the checksummed data-free target Prelude;
3. schema;
4. data;
5. independently regenerated relation/column evidence.

Every `psql` invocation uses `-X`, `ON_ERROR_STOP=1`, explicit transaction
boundaries where the dump format permits them, and bounded process time. A
role, schema, data, relation-set, column-signature, migration, HEAD, count, or
content-hash mismatch is terminal. Partial or unknown outcomes are failures;
the verifier never manufactures missing evidence.

A backup is complete only after a disposable restore exits zero and reproduces
the entire versioned contract, including the global paid-Canary one-shot lock,
all activation campaign/job/auth/request/reconciliation/terminal evidence, and
every other declared critical relation. Record the external artifact location,
operator, source fingerprint, Git commit, manifest hash, restore target, UTC
time, commands, and exit codes without credentials.
