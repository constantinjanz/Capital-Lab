import { describe, expect, it } from 'vitest'

import { relationsFromMigrations } from './generate-backup-contracts.mjs'

describe('versioned backup contract generator', () => {
  it('derives table and altered composite primary-key evidence deterministically', () => {
    const relations = relationsFromMigrations([
      {
        sql: `create table public.example (
          id uuid primary key,
          owner_id uuid not null
        );
        alter table public.example drop constraint example_pkey,
          add primary key (id, owner_id);`,
      },
    ])
    expect(relations).toEqual([
      {
        evidenceRule: 'full-row-sha256',
        primaryKey: ['id', 'owner_id'],
        relation: 'public.example',
        sortKey: ['id', 'owner_id'],
      },
    ])
  })
})
