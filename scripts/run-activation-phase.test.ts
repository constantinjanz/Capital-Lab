import { describe, expect, it } from 'vitest'

import {
  canonicalJson,
  validateDatabaseTarget,
  validateSchedulerIdentity,
} from './run-activation-phase.mjs'

const projectRef = 'qrnuyibntcxwffrxmrvn'
const projectIdentity = {
  schemaVersion: 2,
  vercelTeamId: 'team_yqndKHk6nfWGlte1UVLTJOHG',
  vercelProjectId: 'prj_pbCNwlmXZLeZprZpsRAfAAhPPXVR',
  supabaseProjectRef: projectRef,
  schedulerPath: '/api/internal/scheduler',
  runtimeConfigPath: '/api/internal/scheduler',
  allowedDeploymentHostSuffixes: ['.vercel.app'],
  allowedProductionHosts: [
    'capital-lab-constantinjanz-7876s-projects.vercel.app',
  ],
}
const target = {
  project_ref: projectRef,
  connection_mode: 'direct',
  hostname: `db.${projectRef}.supabase.co`,
  username: 'postgres',
  database: 'postgres',
  port: 5432,
  sslmode: 'verify-full',
  database_fingerprint: 'a'.repeat(64),
}

const identity = {
  production_origin:
    'https://capital-lab-constantinjanz-7876s-projects.vercel.app',
  production_host: 'capital-lab-constantinjanz-7876s-projects.vercel.app',
  scheduler_path: '/api/internal/scheduler',
  scheduler_url:
    'https://capital-lab-constantinjanz-7876s-projects.vercel.app/api/internal/scheduler',
  production_deployment_id: 'dpl_7Gw5ZMBpQA8h9GF832KGp7nwbuh3',
  vercel_commit_sha: 'a'.repeat(40),
  vercel_environment: 'production',
  vercel_team_id: projectIdentity.vercelTeamId,
  vercel_project_id: projectIdentity.vercelProjectId,
  supabase_project_ref: projectRef,
}

describe('activation runner boundaries', () => {
  it('canonicalizes nested JSON independently of insertion order', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: [true, null] } })).toBe(
      '{"a":{"x":[true,null],"y":2},"z":1}',
    )
  })

  it('accepts only the exact HTTPS Production origin and scheduler path', () => {
    expect(() =>
      validateSchedulerIdentity(identity, projectIdentity),
    ).not.toThrow()
    for (const mutation of [
      { scheduler_url: 'https://evil.example/api/internal/scheduler' },
      {
        scheduler_url:
          'https://capital-lab-constantinjanz-7876s-projects.vercel.app:443/api/internal/scheduler',
      },
      {
        scheduler_url:
          'https://user@capital-lab-constantinjanz-7876s-projects.vercel.app/api/internal/scheduler',
      },
      {
        scheduler_url:
          'https://capital-lab-constantinjanz-7876s-projects.vercel.app/api/internal/scheduler?x=1',
      },
      {
        scheduler_url:
          'https://capital-lab-constantinjanz-7876s-projects.vercel.app/api/internal/scheduler#x',
      },
      { scheduler_path: '/api/internal/other' },
      { vercel_environment: 'preview' },
      { production_deployment_id: 'not-a-deployment' },
      { vercel_commit_sha: 'caller-asserted' },
    ]) {
      expect(() =>
        validateSchedulerIdentity(
          { ...identity, ...mutation },
          projectIdentity,
        ),
      ).toThrow()
    }
  })

  it('parses the exact direct target and requires verified TLS', () => {
    const databaseUrl =
      `postgresql://postgres:opaque@db.${projectRef}.supabase.co:5432/postgres` +
      '?sslmode=verify-full'
    expect(validateDatabaseTarget(databaseUrl, target)).toEqual({
      hostname: `db.${projectRef}.supabase.co`,
      username: 'postgres',
      database: 'postgres',
      port: '5432',
      connectionMode: 'direct',
    })
    for (const invalid of [
      databaseUrl.replace('verify-full', 'require'),
      databaseUrl.replace('db.', 'db.evil-'),
      databaseUrl.replace('postgres:opaque', `postgres.${projectRef}:opaque`),
      databaseUrl.replace(':5432/', ':6543/'),
      `${databaseUrl}&application_name=override`,
    ]) {
      expect(() => validateDatabaseTarget(invalid, target)).toThrow()
    }
  })

  it('permits a separately frozen session-pooler boundary but not a silent switch', () => {
    const pooler = {
      ...target,
      connection_mode: 'session_pooler',
      hostname: 'aws-0-eu-west-3.pooler.supabase.com',
      username: `postgres.${projectRef}`,
    }
    const poolerUrl =
      `postgresql://postgres.${projectRef}:opaque@` +
      'aws-0-eu-west-3.pooler.supabase.com:5432/postgres?sslmode=verify-full'
    expect(validateDatabaseTarget(poolerUrl, pooler).connectionMode).toBe(
      'session_pooler',
    )
    expect(() => validateDatabaseTarget(poolerUrl, target)).toThrow()
  })

  it('rejects malformed Windows/metacharacter target fields as data', () => {
    for (const hostname of [
      `db.${projectRef}.supabase.co&whoami`,
      `db.${projectRef}.supabase.co|echo`,
      `db.${projectRef}.supabase.co\"`,
    ]) {
      expect(() =>
        validateDatabaseTarget(
          `postgresql://postgres:opaque@${encodeURIComponent(hostname)}:5432/postgres?sslmode=verify-full`,
          { ...target, hostname },
        ),
      ).toThrow()
    }
  })
})
