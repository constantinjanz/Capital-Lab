import { beforeEach, describe, expect, it, vi } from 'vitest'

const processMocks = vi.hoisted(() => ({ spawnSync: vi.fn() }))

vi.mock('node:child_process', () => processMocks)
vi.mock('./safe-process.mjs', () => ({
  resolveNativeExecutable: () => ({ command: 'docker' }),
  resolvedArguments: (_executable: unknown, args: string[]) => args,
}))

import {
  createOwnedLocalSupabaseNetwork,
  LOCAL_SUPABASE_NETWORK_BINDING_OPTION,
  ownedLocalSupabaseNetworkSpec,
  removeOwnedLocalSupabaseNetwork,
  validateOwnedLocalSupabaseNetworkInspection,
} from './owned-local-supabase-network.mjs'

const target = {
  container: 'supabase_db_capital-lab-ci-run-12345-1',
  port: '54322',
  projectId: 'capital-lab-ci-run-12345-1',
  runId: 'run-12345-1',
}
const spec = ownedLocalSupabaseNetworkSpec('source', target, 'a'.repeat(40))
const networkId = 'b'.repeat(64)

function inspection(overrides: Record<string, unknown> = {}) {
  return {
    Containers: {},
    Driver: 'bridge',
    Id: networkId,
    Labels: { ...spec.labels },
    Name: spec.networkName,
    Options: {
      [LOCAL_SUPABASE_NETWORK_BINDING_OPTION]: '127.0.0.1',
    },
    Scope: 'local',
    ...overrides,
  }
}

function result(stdout: unknown, status = 0) {
  return {
    error: undefined,
    signal: null,
    status,
    stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout),
  }
}

describe('run-owned local Supabase loopback network', () => {
  beforeEach(() => {
    processMocks.spawnSync.mockReset()
  })

  it('derives one deterministic bounded network from reviewed stack identity', () => {
    expect(
      ownedLocalSupabaseNetworkSpec('source', target, 'a'.repeat(40)),
    ).toEqual(spec)
    expect(spec.networkName).toBe('capital-lab-net-capital-lab-ci-run-12345-1')
    expect(spec.labels).toMatchObject({
      'io.capital-lab.commit-sha': 'a'.repeat(40),
      'io.capital-lab.role': 'source',
      'io.capital-lab.run-id': 'run-12345-1',
    })
    expect(() =>
      ownedLocalSupabaseNetworkSpec('source', target, 'runtime-input'),
    ).toThrow(/identity is invalid/u)
  })

  it.each([
    ['missing binding option', { Options: {} }, /network contract is invalid/u],
    [
      'wildcard IPv4 binding',
      {
        Options: {
          [LOCAL_SUPABASE_NETWORK_BINDING_OPTION]: '0.0.0.0',
        },
      },
      /network contract is invalid/u,
    ],
    [
      'wildcard IPv6 binding',
      { Options: { [LOCAL_SUPABASE_NETWORK_BINDING_OPTION]: '::' } },
      /network contract is invalid/u,
    ],
    [
      'additional binding option',
      {
        Options: {
          [LOCAL_SUPABASE_NETWORK_BINDING_OPTION]: '127.0.0.1',
          unreviewed: 'value',
        },
      },
      /network contract is invalid/u,
    ],
    ['wrong driver', { Driver: 'overlay' }, /network contract is invalid/u],
    [
      'wrong name',
      { Name: 'capital-lab-net-other' },
      /network contract is invalid/u,
    ],
    [
      'missing ownership label',
      {
        Labels: Object.fromEntries(
          Object.entries(spec.labels).filter(
            ([key]) => key !== 'io.capital-lab.run-id',
          ),
        ),
      },
      /network contract is invalid/u,
    ],
    [
      'wrong ownership label',
      {
        Labels: { ...spec.labels, 'io.capital-lab.role': 'restore' },
      },
      /network contract is invalid/u,
    ],
  ] as const)('rejects %s', (_label, mutation, message) => {
    expect(() =>
      validateOwnedLocalSupabaseNetworkInspection(
        [inspection(mutation as Record<string, unknown>)],
        spec,
        'empty',
      ),
    ).toThrow(message)
  })

  it('rejects foreign and ambiguous container attachments', () => {
    const own = {
      Containers: {
        ['c'.repeat(64)]: {
          Name: 'supabase_db_capital-lab-ci-run-12345-1',
        },
      },
    }
    expect(
      validateOwnedLocalSupabaseNetworkInspection(
        [inspection(own)],
        spec,
        'running',
      ),
    ).toMatchObject({
      attachedContainerCount: 1,
      databaseContainerAttached: true,
      hostBindingIpv4: '127.0.0.1',
    })
    expect(() =>
      validateOwnedLocalSupabaseNetworkInspection(
        [
          inspection({
            Containers: {
              ['d'.repeat(64)]: { Name: 'foreign_container' },
            },
          }),
        ],
        spec,
        'running',
      ),
    ).toThrow(/foreign container/u)
    expect(() =>
      validateOwnedLocalSupabaseNetworkInspection(
        [inspection(), inspection()],
        spec,
        'empty',
      ),
    ).toThrow(/not unique/u)
  })

  it('creates a new bridge with exact option and labels, never reusing an existing name', () => {
    processMocks.spawnSync
      .mockReturnValueOnce(result(`${networkId}\n`))
      .mockReturnValueOnce(result([inspection()]))
    expect(createOwnedLocalSupabaseNetwork(spec)).toMatchObject({
      networkName: spec.networkName,
      attachedContainerCount: 0,
    })
    expect(processMocks.spawnSync).toHaveBeenNthCalledWith(
      1,
      'docker',
      expect.arrayContaining([
        'network',
        'create',
        '--driver',
        'bridge',
        '--opt',
        `${LOCAL_SUPABASE_NETWORK_BINDING_OPTION}=127.0.0.1`,
        spec.networkName,
      ]),
      expect.objectContaining({ shell: false }),
    )

    processMocks.spawnSync.mockReset()
    processMocks.spawnSync.mockReturnValueOnce(result('', 1))
    expect(() => createOwnedLocalSupabaseNetwork(spec)).toThrow(
      /uniqueness proof failed closed/u,
    )
    expect(processMocks.spawnSync).toHaveBeenCalledTimes(1)
  })

  it('re-inspects ownership and emptiness immediately before removal', () => {
    processMocks.spawnSync
      .mockReturnValueOnce(result([inspection()]))
      .mockReturnValueOnce(result(`${networkId}\n`))
      .mockReturnValueOnce(result(''))
      .mockReturnValueOnce(result(''))
    expect(removeOwnedLocalSupabaseNetwork(spec)).toMatchObject({
      networkName: spec.networkName,
      role: 'source',
    })
    expect(processMocks.spawnSync).toHaveBeenNthCalledWith(
      2,
      'docker',
      ['network', 'rm', networkId],
      expect.objectContaining({ shell: false }),
    )

    processMocks.spawnSync.mockReset()
    processMocks.spawnSync.mockReturnValueOnce(
      result([
        inspection({
          Labels: { ...spec.labels, 'io.capital-lab.run-id': 'run-other-1' },
        }),
      ]),
    )
    expect(() => removeOwnedLocalSupabaseNetwork(spec)).toThrow(
      /network contract is invalid/u,
    )
    expect(processMocks.spawnSync).toHaveBeenCalledTimes(1)
  })
})
