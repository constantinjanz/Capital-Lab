# Backup and restore

Capital Lab has two compact, sorted, versioned disaster-recovery contracts:

- `supabase/backup/pre-activation.v1.json` describes the exact 32-migration
  Hosted baseline before any of the three pending Activation/remediation
  migrations. It references no object introduced by those migrations.
- `supabase/backup/post-activation.v1.json` describes all 36 migrations and the
  complete post-migration Activation/Canary evidence schema.

Each relation contract is paired with a committed independent
`*.schema-golden.v2.json`. The goldens are generated only by the explicit
update command against a fresh seed-free local reference cluster built from
the reviewed migrations. Normal CI is verify-only. A backup source and its
restore target are both compared with the same golden, so copying the same
schema drift into both databases cannot pass.

Golden capture has a separate, fail-closed bootstrap closure. Manually dispatch
`Schema Golden Bootstrap Candidate` with one exact clean commit SHA. The
workflow uses Node 24 and Supabase CLI `2.113.0`, whose reviewed stack contract
pins the exact official runtime reference
`ghcr.io/supabase/postgres:17.6.1.158`, GHCR RepoDigest
`sha256:99b1729aeb0bac314445024fc149fbd39306170b61dd50800ccf180327ab3459`,
linux/amd64 config/image ID
`sha256:1ea9ca2e6b7be9424fed2bb2ba1a550dac552ba60ac798688e38709feec15864`,
OS and architecture. Every container is inspected by its immutable `.Image`
ID before PostgreSQL runs. It never accepts a mutable tag alone, an ECR runtime
alias, or a Hosted, Source, Backup, or Restore database URL. The reviewed
`public.ecr.aws/supabase/postgres:17.6.1.158` reference remains provenance
evidence only and is never an accepted runtime identity.

For each contract the workflow creates two fresh seed-free Reference stacks
with different project IDs, ports, container IDs, server identities, and
database identities. PRE receives exactly the 32 frozen PRE migrations; POST
receives the complete 36-migration set. Each migration is checked against its
contract checksum before the first stack starts. The two independently
captured candidates must be byte-identical. Cleanup is limited to run-owned
containers, networks, and directories and runs on every exit path. Reference
project IDs are deterministic, CLI-compatible, at most 40 characters, and bind
the PRE/POST contract, A/B replica, run identity, and a 64-bit hash. Every
Source, Restore, and Reference stack starts only on its own labeled Docker
bridge whose exact `com.docker.network.bridge.host_binding_ipv4=127.0.0.1`
option is verified before use. Cleanup re-verifies the network owner, requires
zero attached containers after stack stop, removes that exact network ID, and
proves that neither its ID nor name remains.

Every fresh Source or Reference replay establishes its migration-history
boundary through the same credential-free container `psql` simple-query path.
After immutable image identity succeeds, a read-only probe is fully validated
and bound to the requested role and PRE/POST contract. Only the exact
fresh-stack result with both `supabase_migrations` schema and
`schema_migrations` relation absent is bootstrap-eligible. One non-idempotent
transaction then creates only the schema and the empty three-column history
table, with a four-second local lock timeout and no `IF NOT EXISTS`, ownership,
grant, RLS, extension, or seed-history operation. Any race or DDL error rolls
back and stops the replay. The unchanged strict history contract must next
observe ordered `version`, `statements`, and `name` columns as `text`, `_text`,
and `text` through `information_schema.columns.udt_name`, corresponding to the
declared SQL types `text`, `text[]`, and `text`, with exact nullability, only
the `version` primary key, and zero rows before the first repository migration
runs.

Golden bootstrap emits one canonical replica-bound observation after each
validated pre-mutation Reference probe, rather than forwarding the inner
diagnosis directly. The CI gate accepts only the ordered sequence `pre/a`,
`pre/b`, `post/a`, `post/b`. Success requires all four; a later child failure
may retain only the exact observed prefix while preserving its nonzero exit.
Malformed, duplicate, swapped, fifth, or context-drifted observations persist
no sequence. A valid exact-commit Reference image-identity rejection has
priority over every buffered observation; wrong rejection context also fails
without sequence evidence. Raw child stdout and stderr are never forwarded or
stored.

The one-day artifact contains exactly:

- `pre-activation.schema-golden.v2.json`;
- `post-activation.schema-golden.v2.json`;
- `schema-golden-bootstrap-provenance.v1.json`, containing only commit,
  contract, migration-set, relation-set, schema, image, cluster, and evidence
  hashes and an explicit `outputContainsRowData=false` assertion.

The workflow verifies this exact file/key set before upload and never commits,
approves, or deploys anything. A reviewer must inspect the artifact and commit
exactly the two Golden JSON files; the transient provenance file remains
outside the repository. Normal CI invokes only
`verify-schema-golden-contracts.mjs`; it never executes the bootstrap or update
commands.

These generated contracts are the only relation source of truth for the
exporter, manifest writer, restore verifier, row ordering, full-row hashes,
primary keys, column signatures, and evidence rules. Their bytes and exact
relation-set hashes are frozen in every matching backup manifest. Generation
classifies every `public` and `private` base relation and permits no
non-critical application-table allowlist.

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
try {
  node scripts/export-critical-tables.mjs --contract=pre --output-dir=D:\Capital-Lab-Backups\pre
  # Use --contract=post only after both migrations exist on that exact source.
} finally {
  Remove-Item Env:\CAPITAL_LAB_DATABASE_URL -ErrorAction SilentlyContinue
}
```

The exporter requires pinned Supabase CLI `2.113.0`, a fully clean working tree
including untracked files, and an output directory whose canonical path is
outside the repository. It creates:

The repository ignores only the Supabase CLI's generated local state roots
`supabase/.temp` and `supabase/.branches`; every other tracked or untracked path
still makes the export fail closed. Dirty-path diagnostics contain status and
path only, with credential-file paths redacted.

- a roles dump;
- the complete Auth schema definition plus data only for the reviewed
  `auth.users` and `auth.identities` closure;
- a schema dump generated from a PostgreSQL custom archive and an explicit TOC;
- a data dump;
- a separate migration-history schema dump and migration-history data dump;
- a canonical manifest containing clean Git SHA, migration filenames and
  SHA-256 values, schema/contract versions, exact relation-set hash, safe source
  fingerprint metadata, tool versions, dump hashes, full relation counts,
  complete content hashes, primary-key and column signatures, a password-free role-attribute
  and role-membership policy fingerprint, and evidence-rule results. Manifest
  schema version 7 also freezes the exact Auth data-relation allowlist and the
  names of every excluded Auth state relation.

The independent Golden also freezes the complete portable Auth schema
dependency structure: every Auth base relation's owner, ACL, columns, defaults,
constraints, indexes, RLS/policies, grants and triggers, plus Auth functions,
views and function grants. Auth row data remains deliberately limited to
`auth.users` and `auth.identities`.

Auth recovery deliberately excludes sessions, refresh tokens, MFA state,
one-time codes, SSO state, audit entries, and every other internal Auth data
relation. Old sessions and JWTs are not recovery promises. The supported
contract preserves the user UUID/password record and its identity link; after
restore, a fresh password login must issue a new JWT. CI creates two synthetic
users through the local Auth Admin API, maps exactly one to `public.app_users`,
restores into stack B, proves the owner can read one RLS-protected row and the
other user reads none, then fault-injects missing user, missing identity,
orphan owner, empty Auth data, changed UUID, and disabled RLS. Auth-bearing
temporary files are mode 0600, remain outside the repository, are never
uploaded, and are removed with the run-owned artifact root.

The data artifact's schema scope is not an independent allowlist. It is derived
from the critical-relation contract, sorted, and frozen in the manifest. This
keeps the current `private,public` application evidence separate from the
freshly provisioned Auth/Storage platform baseline and makes any later critical
schema addition an explicit contract and restore change.

The schema TOC preserves application-owned `postgres` default privileges and
all current object grants. It excludes only `supabase_admin` `DEFAULT ACL`
entries because those belong to the destination Supabase platform baseline and
cannot safely be reassigned by an application restore. Any other default-ACL
owner aborts export. Counts and both exact owner classifications are frozen in
the version-5 manifest; the full restored table/function grant fingerprint must
still exactly match the source. The intermediate archive and TOC are mode 0600
and are removed before a successful export or with the entire incomplete output
directory after a failure.

Application data, Auth closure, migration history, relation counts and hashes
share one exported repeatable-read, read-only PostgreSQL snapshot. Role policy
is cluster-global and is therefore compared separately before and after. The
exporter performs no source DML. Its local concurrency test synchronizes with a
separate fault-injector through canonical run-owned external barrier files: the
writer commits one synthetic row after the snapshot, the dumps remain on the
old snapshot, and the writer removes the row before post-export evidence. A
mixed state, timeout, failed cleanup or missing barrier prevents a successful
manifest. No Production export is part of this remediation.

## Seed-free disposable target

Use two fully separate, run-owned local Supabase stacks on loopback: source A
uses database/API ports 54322/54321, while target B uses 55322/55321 and its own
project ID, Postgres container, volume and server system identifier. Two
databases or hostname aliases on one server are rejected. The target proof
binds the exact run ID, random disposable marker, container identity, database,
role, port, server fingerprint and a different retained source fingerprint
before any reset/restore subprocess is allowed.

CI creates B from the checked-in target-stack template, starts it separately,
and prepares only its exact `postgres` database after validating both server
identities and the run marker. The preparation command requires the exact
disposable confirmation phrase and writes a canonical proof outside the
repository. No broad Docker prune, unresolved database name, Hosted hostname,
project ref or same-cluster target is accepted. Cleanup is limited to the exact
run paths and stack-B workdir and fails the gate if cleanup itself fails.

```powershell
$env:CAPITAL_LAB_DATABASE_URL = '<loopback-source-url>'
try {
  node scripts/prepare-seed-free-local-restore-target.mjs --proof=D:\Capital-Lab-Backups\target-proof.json
  $env:CAPITAL_LAB_RESTORE_DATABASE_URL = '<loopback-restore-url>'
  $env:CAPITAL_LAB_RESTORE_CONFIRM_DISPOSABLE = 'seed-free-disposable-database-confirmed'
  $manifest = 'D:\Capital-Lab-Backups\pre\manifest.json'
  $expectedHash = '<externally-retained-manifest-sha256>'
  node scripts/verify-backup-restore.mjs --contract=pre `
    --manifest=$manifest --expected-manifest-sha256=$expectedHash `
    --target-proof=D:\Capital-Lab-Backups\target-proof.json `
    --expected-target-proof-sha256='<externally-retained-target-proof-sha256>'
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
2. the complete Auth schema;
3. the checksummed validation-only target Prelude;
4. application schema;
5. reviewed Auth user/identity data in one transaction after
   `SET session_replication_role = replica`;
6. application data in one transaction after
   `SET session_replication_role = replica`;
7. the separately dumped `supabase_migrations` schema and rows;
8. independently regenerated Golden schema, relation/column, Auth closure,
   owner/FK and source-unchanged evidence.

Every `psql` invocation uses `-X`, `ON_ERROR_STOP=1`, explicit transaction
boundaries where the dump format permits them, and bounded process time. A
role, schema, data, relation-set, column-signature, migration, HEAD, count, or
content-hash mismatch is terminal. Partial or unknown outcomes are failures;
the verifier never manufactures missing evidence.

## Local rollback-only migration rehearsal

The database CI proves every pending PR migration without retaining it. On a
clean checkout and loopback-only disposable Supabase stack,
`pnpm migration:rehearse:local` temporarily holds exactly the two allowlisted
pending migration file, runs `supabase db reset --no-seed`, restores its bytes,
requires exactly one outer `BEGIN`/`COMMIT` pair per file, applies every body
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
