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
- a separate migration-history schema dump and migration-history data dump;
- a canonical manifest containing clean Git SHA, migration filenames and
  SHA-256 values, schema/contract versions, exact relation-set hash, safe source
  fingerprint metadata, tool versions, dump hashes, full relation counts,
  complete content hashes, column signatures, a password-free role-policy
  fingerprint, and evidence-rule results.

Pre- and post-dump evidence must be identical. Any concurrent critical-row or
schema change aborts the export. No production export is part of an activation
code-review run unless separately authorized.

## Seed-free disposable target

Use a fully disposable local Supabase stack on loopback. A plain `template0`
database is not a valid target because official Supabase dumps assume the
managed Auth, Storage, extension, and Vault baseline of a freshly provisioned
project. The target must contain that platform baseline, no project migration,
no seed, no user relation, and a database OID/name fingerprint distinct from
the exported source.

The CI sequence exports first, temporarily holds the exact project migration
files, runs pinned `supabase db reset --no-seed`, restores every migration file,
and uses the pinned Supabase CLI to create a short-lived logical dump of the
allowlisted `auth,storage,extensions,vault` platform baseline outside the
repository. It restores the baseline into a new `template0` database, removes
the target's empty migration-history schema, and securely discards the temporary
baseline artifacts before verification. The helper derives the paths itself,
accepts no arguments, uses `shell:false`, and refuses a dirty tree. Run it only
in a disposable local stack because rebuilding the local source database is
destructive. Only the allowlisted managed baseline is restored as the fixed
local `supabase_admin`, preserving its role/owner statements; the Capital Lab
restore and evidence queries continue to use the parsed operator:

```powershell
$env:CAPITAL_LAB_DATABASE_URL = '<loopback-source-url>'
try {
  node scripts/prepare-seed-free-local-restore-target.mjs
  $env:CAPITAL_LAB_RESTORE_DATABASE_URL = '<loopback-restore-url>'
  $env:CAPITAL_LAB_RESTORE_CONFIRM_DISPOSABLE = 'seed-free-disposable-database-confirmed'
  pnpm backup:restore:test -- `
    --manifest=D:\Capital-Lab-Backups\capital-lab-<timestamp>-manifest.json
} finally {
  Remove-Item Env:\CAPITAL_LAB_DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:\CAPITAL_LAB_RESTORE_DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:\CAPITAL_LAB_RESTORE_CONFIRM_DISPOSABLE -ErrorAction SilentlyContinue
}
```

Never substitute a Hosted hostname. Both helpers accept loopback only; the
verifier also requires the exact disposable confirmation.

## Restore order and failure contract

The verifier first checks clean HEAD, contract/schema versions, migration list
and checksums, exact relation set, safe source/server fingerprints, artifact
hashes, the password-free role-policy fingerprint, the exact tracked
seed-free-target Prelude checksum, an empty user-schema target, and the required
managed Supabase baseline. The Prelude is validation-only: it creates no schema,
table, migration, role, extension, or data. The verifier then restores in this
order:

1. roles (or, for a disposable database in the same PostgreSQL cluster,
   verifies the identical cluster-global role policy without replaying global
   role mutations into the still-running source cluster);
2. the checksummed validation-only target Prelude;
3. schema;
4. data in the same transaction after
   `SET session_replication_role = replica`;
5. the separately dumped `supabase_migrations` schema and rows;
6. independently regenerated relation/column evidence.

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
