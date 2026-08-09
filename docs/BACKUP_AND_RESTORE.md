# Backup and restore

Supabase Free is the sole runtime database but is not treated as an adequate automatic disaster-recovery system. Create one manual backup each week and before every reviewed migration.

## Export

Link the CLI to the intended project, choose a directory outside the Capital Lab repository and Supabase project, then run:

```powershell
pnpm backup:critical -- --output-dir=D:\Capital-Lab-Backups
```

The script runs a linked `supabase db dump --data-only --use-copy` and writes a manifest naming the critical ledger, orders/fills, portfolio, budget/usage, decisions, comparisons, scheduler, and audit relations. Also retain the repository migration set at the same Git commit; the data-only dump requires that schema during restore. Never commit dumps or upload them to a new service without explicit approval.

For an additional schema artifact, run manually:

```powershell
supabase db dump --linked --file D:\Capital-Lab-Backups\capital-lab-schema.sql
```

## Restore verification

Create/reset a local or disposable test database from migrations, then restore the data dump. The verifier refuses non-local database hostnames:

```powershell
pnpm backup:restore:test -- --dump=D:\Capital-Lab-Backups\capital-lab-critical-<timestamp>.sql --db-url=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

A weekly backup is complete only after the restore exits zero and the critical relation counts are reviewed. Record timestamp, Git commit, dump checksum, storage location, restore date, and operator. Rotate media according to local policy, keeping at least one copy outside the computer and outside the Supabase project.
