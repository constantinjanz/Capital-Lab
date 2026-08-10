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
  complete content hashes, column signatures, a password-free role-attribute
  and role-membership policy fingerprint, and evidence-rule results.

Pre- and post-dump evidence must be identical. Any concurrent critical-row or
schema change aborts the export. No production export is part of an activation
code-review run unless separately authorized.

## Seed-free disposable target

Use a fully disposable local Supabase stack on loopback. A plain `template0`
database is not a valid target because official Supabase dumps assume the
managed Auth, Storage, extension, and Vault baseline of a freshly provisioned
project. The target must contain that platform baseline plus the exact empty
`supabase_realtime` publication, no project migration, no seed, no user
relation, and a database OID/name fingerprint distinct from the exported
source.

The CI sequence exports first, temporarily holds the exact project migration
files, runs pinned `supabase db reset --no-seed`, restores every migration file,
and uses the pinned Supabase CLI to create a short-lived logical schema dump of
the allowlisted `auth,storage,extensions,vault` platform baseline plus an
`auth,storage`-only data dump outside the repository. It restores the baseline
into a new `template0` database, installs local `supabase_vault` without a
version pin through `CREATE EXTENSION IF NOT EXISTS`, creates the local empty
`supabase_realtime` publication expected by an official schema dump, removes
the target's empty migration-history schema, and securely discards the
temporary baseline artifacts before verification. The helper derives the paths itself,
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

1. exact password-free role attributes and memberships are verified first;
   when they differ, the roles artifact is replayed only on a distinct server
   and reverified, while a same-server mismatch fails rather than mutating
   cluster-global state;
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

## Local rollback-only migration rehearsal

The database CI also proves the two PR migrations without retaining them. On a
clean checkout and loopback-only disposable Supabase stack,
`pnpm migration:rehearse:local` temporarily holds exactly the two allowlisted
PR migration files, runs `supabase db reset --no-seed`, restores their bytes,
requires exactly one outer `BEGIN`/`COMMIT` pair per file, applies both bodies
inside one bounded `psql -X --no-psqlrc` transaction, verifies the activation
probe relation, rolls back, and verifies the relation is absent. Git HEAD,
complete dirty-tree state, and migration hashes are checked before and after.
CI then performs a normal full reset before pgTAP. The command rejects every
non-loopback target and is never a substitute for a separately authorized
Hosted rehearsal or migration apply.

A backup is complete only after a disposable restore exits zero and reproduces
the entire versioned contract, including the global paid-Canary one-shot lock,
all activation campaign/job/auth/request/reconciliation/terminal evidence, and
every other declared critical relation. Record the external artifact location,
operator, source fingerprint, Git commit, manifest hash, restore target, UTC
time, commands, and exit codes without credentials.
