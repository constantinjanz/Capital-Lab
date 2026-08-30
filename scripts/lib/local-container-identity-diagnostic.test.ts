import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  classifyLocalContainerHostIp,
  diagnoseOwnedLocalDatabaseContainer,
  diagnoseOwnedLocalDatabaseImage,
  emitLocalContainerIdentityRejection,
  localContainerInspectFailureDiagnostic,
  LocalContainerImageIdentityRejection,
  parseLocalContainerIdentityRejection,
} from './local-container-identity-diagnostic.mjs'
import {
  LOCAL_CI_IMAGE,
  LOCAL_CI_IMAGE_ARCHITECTURE,
  LOCAL_CI_IMAGE_ID,
  LOCAL_CI_IMAGE_OS,
  LOCAL_CI_IMAGE_REPO_DIGEST,
} from './owned-local-ci-stack.mjs'

const expected = {
  container: 'supabase_db_capital-lab-ci-run-12345-1',
  port: '54322',
  projectId: 'capital-lab-ci-run-12345-1',
}
const validContainer = {
  Config: { Image: LOCAL_CI_IMAGE },
  Id: 'a'.repeat(64),
  Image: LOCAL_CI_IMAGE_ID,
  Name: `/${expected.container}`,
  NetworkSettings: {
    Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '54322' }] },
  },
  State: { Running: true },
}
const validImage = {
  Architecture: LOCAL_CI_IMAGE_ARCHITECTURE,
  Id: LOCAL_CI_IMAGE_ID,
  Os: LOCAL_CI_IMAGE_OS,
  RepoDigests: [LOCAL_CI_IMAGE_REPO_DIGEST],
}
const tempDirectories: string[] = []

function tempDirectory() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'capital-lab-diag-'))
  tempDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('local container identity diagnostic contract', () => {
  it.each([
    ['127.0.0.1', 'loopback_v4'],
    ['0.0.0.0', 'wildcard_v4'],
    ['::', 'wildcard_v6'],
    ['secret.invalid', 'other'],
  ])('classifies host IP %s without returning it', (value, kind) => {
    expect(classifyLocalContainerHostIp(value)).toBe(kind)
  })

  it.each([
    [
      'wrong name',
      { ...validContainer, Name: '/other' },
      'container_binding',
      ['container_name'],
    ],
    [
      'stopped state',
      { ...validContainer, State: { Running: false } },
      'container_binding',
      ['container_running'],
    ],
    [
      'invalid container ID',
      { ...validContainer, Id: undefined },
      'container_shape',
      ['container_id_shape'],
    ],
    [
      'invalid container image ID shape',
      { ...validContainer, Image: 'not-an-image-id' },
      'container_shape',
      ['container_image_id_shape'],
    ],
    [
      'ECR runtime reference',
      {
        ...validContainer,
        Config: { Image: 'public.ecr.aws/supabase/postgres:17.6.1.158' },
      },
      'container_binding',
      ['config_image'],
    ],
    [
      'unclassified runtime reference',
      { ...validContainer, Config: { Image: 'secret.invalid/postgres:token' } },
      'container_shape',
      ['config_image_shape'],
    ],
  ] as const)(
    'classifies %s as %s',
    (_label, container, stage, mismatchFields) => {
      const diagnostic = diagnoseOwnedLocalDatabaseContainer(
        [container],
        expected,
      )
      expect(diagnostic).toMatchObject({
        failure_stage: stage,
        mismatch_fields: mismatchFields,
      })
    },
  )

  it.each([
    ['zero', []],
    ['multiple', [validContainer, validContainer]],
  ])('classifies %s container inspect results', (_label, containers) => {
    expect(
      diagnoseOwnedLocalDatabaseContainer(containers, expected),
    ).toMatchObject({
      binding_count: null,
      failure_stage: 'container_shape',
      mismatch_fields: ['container_result_count'],
    })
  })

  it.each([
    ['zero', [], [], false, ['binding_count']],
    [
      'multiple loopback',
      [
        { HostIp: '127.0.0.1', HostPort: '54322' },
        { HostIp: '127.0.0.1', HostPort: '54322' },
      ],
      ['loopback_v4'],
      true,
      ['binding_count'],
    ],
    [
      'wildcard IPv4',
      [{ HostIp: '0.0.0.0', HostPort: '54322' }],
      ['wildcard_v4'],
      true,
      ['binding_host_ip'],
    ],
    [
      'wildcard IPv6',
      [{ HostIp: '::', HostPort: '54322' }],
      ['wildcard_v6'],
      true,
      ['binding_host_ip'],
    ],
    [
      'other host',
      [{ HostIp: '192.0.2.1', HostPort: '54322' }],
      ['other'],
      true,
      ['binding_host_ip'],
    ],
    [
      'wrong port',
      [{ HostIp: '127.0.0.1', HostPort: '59999' }],
      ['loopback_v4'],
      false,
      ['binding_host_port'],
    ],
  ] as const)(
    'distinguishes %s binding evidence',
    (_label, bindings, hostKinds, portMatch, mismatchFields) => {
      const diagnostic = diagnoseOwnedLocalDatabaseContainer(
        [
          {
            ...validContainer,
            NetworkSettings: { Ports: { '5432/tcp': bindings } },
          },
        ],
        expected,
      )
      expect(diagnostic).toMatchObject({
        binding_count: bindings.length,
        binding_host_ip_kinds: hostKinds,
        failure_stage: 'container_binding',
        host_port_match: portMatch,
        mismatch_fields: mismatchFields,
      })
    },
  )

  it('sorts and bounds classified public RepoDigests', () => {
    const repoDigests = [
      LOCAL_CI_IMAGE_REPO_DIGEST,
      `public.ecr.aws/supabase/postgres@sha256:${'9'.repeat(64)}`,
      `ghcr.io/supabase/postgres@sha256:${'8'.repeat(64)}`,
      `public.ecr.aws/supabase/postgres@sha256:${'7'.repeat(64)}`,
      `ghcr.io/supabase/postgres@sha256:${'6'.repeat(64)}`,
    ]
    const diagnostic = diagnoseOwnedLocalDatabaseImage(
      validContainer,
      [{ ...validImage, RepoDigests: repoDigests }],
      expected,
    )
    expect(diagnostic).toMatchObject({
      failure_stage: 'immutable_identity',
      repo_digest_count: 5,
    })
    expect(diagnostic?.observed_runtime.repoDigests).toEqual(
      [...repoDigests].sort().slice(0, 4),
    )
  })

  it.each([
    [
      'wrong container image ID',
      { ...validContainer, Image: `sha256:${'f'.repeat(64)}` },
      [validImage],
      ['container_image_id'],
    ],
    [
      'wrong image inspect ID',
      validContainer,
      [{ ...validImage, Id: `sha256:${'f'.repeat(64)}` }],
      ['image_inspect_id'],
    ],
    ['wrong OS', validContainer, [{ ...validImage, Os: 'windows' }], ['os']],
    [
      'wrong architecture',
      validContainer,
      [{ ...validImage, Architecture: 'arm64' }],
      ['architecture'],
    ],
    [
      'missing RepoDigest',
      validContainer,
      [{ ...validImage, RepoDigests: [] }],
      ['expected_repo_digest_missing', 'repo_digest_count'],
    ],
    [
      'wrong RepoDigest',
      validContainer,
      [
        {
          ...validImage,
          RepoDigests: [`ghcr.io/supabase/postgres@sha256:${'f'.repeat(64)}`],
        },
      ],
      ['expected_repo_digest_missing', 'repo_digest_value'],
    ],
    [
      'additional RepoDigest',
      validContainer,
      [
        {
          ...validImage,
          RepoDigests: [
            LOCAL_CI_IMAGE_REPO_DIGEST,
            `public.ecr.aws/supabase/postgres@sha256:${'9'.repeat(64)}`,
          ],
        },
      ],
      ['repo_digest_count', 'repo_digest_value'],
    ],
  ] as const)(
    'classifies immutable %s',
    (_label, container, images, mismatchFields) => {
      const diagnostic = diagnoseOwnedLocalDatabaseImage(
        container,
        images,
        expected,
      )
      expect(diagnostic).toMatchObject({
        failure_stage: 'immutable_identity',
        mismatch_fields: mismatchFields,
      })
    },
  )

  it.each([
    ['empty image result', [], ['image_result_count']],
    [
      'multiple image results',
      [validImage, validImage],
      ['image_result_count'],
    ],
    [
      'missing image ID',
      [{ ...validImage, Id: undefined }],
      ['image_inspect_id_shape'],
    ],
    [
      'missing RepoDigests',
      [{ ...validImage, RepoDigests: undefined }],
      ['repo_digests_shape'],
    ],
    [
      'unclassified RepoDigest',
      [
        {
          ...validImage,
          RepoDigests: ['secret.invalid/token@sha256:not-safe'],
        },
      ],
      ['repo_digests_shape'],
    ],
    ['missing OS', [{ ...validImage, Os: undefined }], ['os_shape']],
    [
      'missing architecture',
      [{ ...validImage, Architecture: undefined }],
      ['architecture_shape'],
    ],
  ] as const)('classifies image shape %s', (_label, images, mismatchFields) => {
    expect(
      diagnoseOwnedLocalDatabaseImage(validContainer, images, expected),
    ).toMatchObject({
      failure_stage: 'image_shape',
      mismatch_fields: mismatchFields,
    })
  })

  it('distinguishes container and image inspect subprocess failures', () => {
    expect(
      localContainerInspectFailureDiagnostic(
        'container_inspect',
        'container_inspect_unavailable',
        expected,
      ),
    ).toMatchObject({
      failure_stage: 'container_inspect',
      mismatch_fields: ['container_inspect_unavailable'],
    })
    expect(
      localContainerInspectFailureDiagnostic(
        'image_inspect',
        'image_inspect_unavailable',
        expected,
        [validContainer],
      ),
    ).toMatchObject({
      failure_stage: 'image_inspect',
      mismatch_fields: ['image_inspect_unavailable'],
    })
  })

  it('writes one byte-identical safe log and evidence file', () => {
    const secret = `synthetic-private-value-${'x'.repeat(32)}`
    const unsafeContainer = {
      ...validContainer,
      Config: { Env: [`PASSWORD=${secret}`], Image: LOCAL_CI_IMAGE },
      Labels: { arbitrary: secret },
      NetworkSettings: {
        Ports: { '5432/tcp': [{ HostIp: secret, HostPort: '54322' }] },
      },
    }
    const diagnostic = diagnoseOwnedLocalDatabaseContainer(
      [unsafeContainer],
      expected,
    )
    expect(diagnostic).not.toBeNull()
    const error = new LocalContainerImageIdentityRejection(
      'source',
      diagnostic!,
    )
    let stdout = ''
    const directory = tempDirectory()
    const line = emitLocalContainerIdentityRejection(error, 'c'.repeat(40), {
      cwd: directory,
      write: (value: string) => {
        stdout += value
        return true
      },
    })
    const evidence = readFileSync(
      path.join(
        directory,
        '.ci-evidence',
        'local-container-image-identity-rejected.json',
      ),
      'utf8',
    )
    expect(stdout).toBe(line)
    expect(evidence).toBe(line)
    expect(parseLocalContainerIdentityRejection(line)).toMatchObject({
      commitSha: 'c'.repeat(40),
      failure_stage: 'container_binding',
      mismatch_fields: ['binding_host_ip'],
      status: 'local_container_image_identity_rejected',
    })
    const stderr = String(error)
    expect(`${stdout}${stderr}${evidence}`).not.toContain(secret)
    expect(line).not.toMatch(/PASSWORD|Labels|Config\.Env/u)
  })

  it('keeps the first evidence bytes and first log when a second write fails closed', () => {
    const diagnostic = diagnoseOwnedLocalDatabaseContainer(
      [
        {
          ...validContainer,
          Config: {
            Image: 'public.ecr.aws/supabase/postgres:17.6.1.158',
          },
        },
      ],
      expected,
    )
    const error = new LocalContainerImageIdentityRejection(
      'source',
      diagnostic!,
    )
    const directory = tempDirectory()
    const logs: string[] = []
    const options = {
      cwd: directory,
      write: (value: string) => {
        logs.push(value)
        return true
      },
    }
    const first = emitLocalContainerIdentityRejection(
      error,
      'd'.repeat(40),
      options,
    )
    expect(parseLocalContainerIdentityRejection(first)).toMatchObject({
      commitSha: 'd'.repeat(40),
      failure_stage: 'container_binding',
      mismatch_fields: ['config_image'],
      status: 'local_container_image_identity_rejected',
    })
    expect(() =>
      emitLocalContainerIdentityRejection(error, 'd'.repeat(40), options),
    ).toThrow()
    const evidence = readFileSync(
      path.join(
        directory,
        '.ci-evidence',
        'local-container-image-identity-rejected.json',
      ),
      'utf8',
    )
    expect(evidence).toBe(first)
    expect(logs).toEqual([first])
  })

  it('emits neither evidence nor a log for an invalid commit SHA', () => {
    const diagnostic = diagnoseOwnedLocalDatabaseContainer(
      [{ ...validContainer, State: { Running: false } }],
      expected,
    )
    const error = new LocalContainerImageIdentityRejection(
      'source',
      diagnostic!,
    )
    const directory = tempDirectory()
    const logs: string[] = []
    expect(() =>
      emitLocalContainerIdentityRejection(error, 'invalid', {
        cwd: directory,
        write: (value: string) => {
          logs.push(value)
          return true
        },
      }),
    ).toThrow(/evidence is invalid/u)
    expect(logs).toEqual([])
    expect(() =>
      readFileSync(
        path.join(
          directory,
          '.ci-evidence',
          'local-container-image-identity-rejected.json',
        ),
        'utf8',
      ),
    ).toThrow()
  })

  it('keeps the established success path diagnostic-free', () => {
    expect(
      diagnoseOwnedLocalDatabaseContainer([validContainer], expected),
    ).toBeNull()
    expect(
      diagnoseOwnedLocalDatabaseImage(validContainer, [validImage], expected),
    ).toBeNull()
  })
})
