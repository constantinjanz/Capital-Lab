import { describe, expect, it } from 'vitest'

import {
  deploymentEvidenceHash,
  validateDeploymentMetadata,
  validateDeploymentProof,
} from './vercel-deployment-proof.mjs'

const contract = {
  schemaVersion: 2,
  vercelTeamId: 'team_yqndKHk6nfWGlte1UVLTJOHG',
  vercelProjectId: 'prj_pbCNwlmXZLeZprZpsRAfAAhPPXVR',
  supabaseProjectRef: 'qrnuyibntcxwffrxmrvn',
  schedulerPath: '/api/internal/scheduler',
  runtimeConfigPath: '/api/internal/scheduler',
  allowedProductionHosts: ['capital-lab.example'],
  allowedDeploymentHostSuffixes: ['.vercel.app'],
}
const expected = {
  role: 'auth_disabled',
  deploymentId: 'dpl_7Gw5ZMBpQA8h9GF832KGp7nwbuh3',
  commitSha: 'a'.repeat(40),
  productionOrigin: 'https://capital-lab.example',
}
const deployment = {
  id: expected.deploymentId,
  projectId: contract.vercelProjectId,
  teamId: contract.vercelTeamId,
  target: 'production',
  readyState: 'READY',
  meta: { githubCommitSha: expected.commitSha },
  alias: ['capital-lab.example'],
  url: 'capital-runtime-immutable.example.vercel.app',
}

describe('read-only Vercel deployment proof', () => {
  it('binds a READY Production deployment to exact project, commit, alias, and path', () => {
    const immutable = validateDeploymentMetadata(contract, expected, deployment)
    const proof = {
      ...immutable,
      evidenceHash: deploymentEvidenceHash(immutable),
      verifiedAt: '2026-08-11T10:00:00.000Z',
    }
    expect(validateDeploymentProof(contract, expected, proof)).toEqual(proof)
  })

  it.each([
    [
      'hostile arbitrary domain',
      { productionOrigin: 'https://evil.example' },
      {},
    ],
    ['redirect alias', {}, { alias: ['redirect.example'] }],
    ['wrong team', {}, { teamId: 'team_00000000000000000000' }],
    ['wrong project', {}, { projectId: 'prj_00000000000000000000' }],
    ['Preview deployment', {}, { target: null }],
    ['wrong commit', {}, { meta: { githubCommitSha: 'b'.repeat(40) } }],
    ['deployment drift', {}, { id: 'dpl_00000000000000000000' }],
    ['untrusted deployment URL', {}, { url: 'attacker.example' }],
  ])('rejects %s', (_label, expectationDrift, deploymentDrift) => {
    expect(() =>
      validateDeploymentMetadata(
        contract,
        { ...expected, ...expectationDrift },
        { ...deployment, ...deploymentDrift },
      ),
    ).toThrow()
  })

  it.each([
    'https://user@capital-lab.example',
    'https://capital-lab.example:443',
    'https://capital-lab.example?query=1',
    'https://capital-lab.example#fragment',
    'https://capital-lab.example/redirect',
  ])('rejects ambiguous origin %s', (productionOrigin) => {
    expect(() =>
      validateDeploymentMetadata(
        contract,
        { ...expected, productionOrigin },
        deployment,
      ),
    ).toThrow()
  })

  it('rejects a forged echo proof for an arbitrary host even with self-consistent fields', () => {
    const forgedImmutable = {
      ...validateDeploymentMetadata(contract, expected, deployment),
      productionOrigin: 'https://attacker.example',
      productionHost: 'attacker.example',
      schedulerUrl: 'https://attacker.example/api/internal/scheduler',
    }
    const forged = {
      ...forgedImmutable,
      evidenceHash: deploymentEvidenceHash(forgedImmutable),
      verifiedAt: '2026-08-11T10:00:00.000Z',
    }
    expect(() => validateDeploymentProof(contract, expected, forged)).toThrow()
  })
})
