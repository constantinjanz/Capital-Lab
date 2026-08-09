# Backup and restore

Supabase Free is the sole runtime database but is not treated as an adequate automatic disaster-recovery system. Create one manual backup each week and before every reviewed migration.

## Export

Link the CLI to the intended project, choose a directory outside the Capital Lab repository and Supabase project, then run:

```powershell
$env:CAPITAL_LAB_DATABASE_URL='<redacted direct database URL>'
pnpm backup:critical -- --output-dir=D:\Capital-Lab-Backups
```

The script requires the pinned Supabase CLI `2.113.0`, refuses output inside the repository, runs a linked `supabase db dump --data-only --use-copy`, and writes a manifest with the exact Git commit, dump SHA-256, critical row counts, deterministic content checksums, exact ledger currency totals, and a duplicate-ledger-ID assertion. The database URL remains process-local and is never printed. Also retain the repository migration set at the same Git commit; the data-only dump requires that schema during restore. Never commit dumps or upload them to a new service or CI artifact.

For an additional schema artifact, run manually:

```powershell
supabase db dump --linked --file D:\Capital-Lab-Backups\capital-lab-schema.sql
```

## Restore verification

Create/reset a local or disposable test database from migrations, then restore the data dump. The verifier refuses non-local database hostnames:

```powershell
$env:CAPITAL_LAB_RESTORE_DATABASE_URL='<redacted disposable local URL>'
pnpm backup:restore:test -- --dump=D:\Capital-Lab-Backups\capital-lab-critical-<timestamp>.sql --manifest=D:\Capital-Lab-Backups\capital-lab-critical-<timestamp>.json
```

A backup is complete only after the restore exits zero and exactly reproduces every preregistered row count, content checksum, ledger currency total, and the zero-duplicate ledger assertion. Record timestamp, Git commit, dump checksum, storage location, restore date, database fingerprint, exit code, and operator. A static script review is not a restore test. Rotate media according to local policy, keeping at least one copy outside the computer and outside the Supabase project.
