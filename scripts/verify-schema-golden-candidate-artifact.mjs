import { readdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  canonicalJson,
  loadCriticalRelationContract,
  loadSchemaGolden,
  sha256,
} from './critical-backup-contract.mjs'
import { loadSchemaGoldenBootstrapContract } from './lib/schema-golden-bootstrap-contract.mjs'

const SHA = /^[0-9a-f]{64}$/u
const COMMIT = /^[0-9a-f]{40}$/u
const EXPECTED_FILES = [
  'post-activation.schema-golden.v2.json',
  'pre-activation.schema-golden.v2.json',
  'schema-golden-bootstrap-provenance.v1.json',
]

export function parseSchemaGoldenCandidateOptions(argv) {
  const entries = argv.map((argument) => {
    const match = /^--(directory|expected-commit-sha)=(.+)$/u.exec(argument)
    if (!match)
      throw new Error('Golden candidate verification arguments are invalid')
    return [match[1], match[2]]
  })
  const parsed = Object.fromEntries(entries)
  if (
    entries.length !== 2 ||
    new Set(entries.map(([key]) => key)).size !== 2 ||
    !COMMIT.test(parsed['expected-commit-sha'] ?? '')
  ) {
    throw new Error('Exact candidate directory and commit SHA are required')
  }
  return parsed
}

function exactKeys(value, keys, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join('\n') !== [...keys].sort().join('\n')
  ) {
    throw new Error(`${label} fields are incomplete or unexpected`)
  }
}

export function validateSchemaGoldenCandidateProvenance(provenance, expected) {
  exactKeys(
    provenance,
    [
      'bootstrapContractSha256',
      'contractVersion',
      'contracts',
      'evidenceSha256',
      'gitCommitSha',
      'outputContainsRowData',
      'postgresImage',
      'postgresImageArchitecture',
      'postgresImageId',
      'postgresImageOs',
      'postgresImageRegistry',
      'postgresImageRepoDigest',
      'postgresProvenanceImage',
      'schemaVersion',
      'supabaseCliVersion',
    ],
    'Golden bootstrap provenance',
  )
  const { evidenceSha256, ...payload } = provenance
  if (
    provenance.schemaVersion !== 1 ||
    provenance.contractVersion !== expected.bootstrap.contractVersion ||
    provenance.gitCommitSha !== expected.gitCommitSha ||
    provenance.supabaseCliVersion !== expected.bootstrap.supabaseCliVersion ||
    provenance.postgresImage !== expected.bootstrap.postgresImage ||
    provenance.postgresImageArchitecture !==
      expected.bootstrap.postgresImageArchitecture ||
    provenance.postgresImageId !== expected.bootstrap.postgresImageId ||
    provenance.postgresImageOs !== expected.bootstrap.postgresImageOs ||
    provenance.postgresImageRegistry !==
      expected.bootstrap.postgresImageRegistry ||
    provenance.postgresImageRepoDigest !==
      expected.bootstrap.postgresImageRepoDigest ||
    provenance.postgresProvenanceImage !==
      expected.bootstrap.postgresProvenanceImage ||
    provenance.bootstrapContractSha256 !== expected.bootstrapContractSha256 ||
    provenance.outputContainsRowData !== false ||
    !SHA.test(evidenceSha256 ?? '') ||
    evidenceSha256 !== sha256(canonicalJson(payload)) ||
    !Array.isArray(provenance.contracts) ||
    provenance.contracts.length !== 2
  ) {
    throw new Error('Golden bootstrap provenance identity is invalid')
  }
  const byKind = new Map()
  for (const contract of provenance.contracts) {
    exactKeys(
      contract,
      [
        'builds',
        'contractKind',
        'goldenSha256',
        'migrationSetSha256',
        'rawMigrationSetSha256',
        'relationContractSha256',
        'relationContractVersion',
        'relationSetSha256',
        'schemaEvidenceSha256',
        'schemaFingerprintSha256',
      ],
      'Golden contract provenance',
    )
    if (
      !['pre_activation', 'post_activation'].includes(contract.contractKind) ||
      byKind.has(contract.contractKind) ||
      !Number.isSafeInteger(contract.relationContractVersion) ||
      [
        contract.goldenSha256,
        contract.migrationSetSha256,
        contract.rawMigrationSetSha256,
        contract.relationContractSha256,
        contract.relationSetSha256,
        contract.schemaEvidenceSha256,
        contract.schemaFingerprintSha256,
      ].some((value) => !SHA.test(value ?? '')) ||
      !Array.isArray(contract.builds) ||
      contract.builds.length !== 2
    ) {
      throw new Error('Golden contract provenance is invalid')
    }
    const clusterIds = new Set()
    const containerFingerprints = new Set()
    for (const build of contract.builds) {
      exactKeys(
        build,
        [
          'clusterId',
          'containerFingerprint',
          'containerImage',
          'containerImageArchitecture',
          'containerImageId',
          'containerImageOs',
          'containerImageRepoDigest',
          'databaseFingerprint',
          'referenceEvidenceSha256',
          'referenceProofSha256',
          'serverFingerprint',
        ],
        'Reference build provenance',
      )
      if (
        !/^capital-lab-reference-run-(?:pre|post)-(?:a|b)-[a-z0-9-]+$/u.test(
          build.clusterId ?? '',
        ) ||
        build.containerImage !== expected.bootstrap.postgresImage ||
        build.containerImageArchitecture !==
          expected.bootstrap.postgresImageArchitecture ||
        build.containerImageId !== expected.bootstrap.postgresImageId ||
        build.containerImageOs !== expected.bootstrap.postgresImageOs ||
        build.containerImageRepoDigest !==
          expected.bootstrap.postgresImageRepoDigest ||
        [
          build.containerFingerprint,
          build.databaseFingerprint,
          build.referenceEvidenceSha256,
          build.referenceProofSha256,
          build.serverFingerprint,
        ].some((value) => !SHA.test(value ?? ''))
      ) {
        throw new Error('Reference build identity is invalid')
      }
      clusterIds.add(build.clusterId)
      containerFingerprints.add(build.containerFingerprint)
    }
    if (clusterIds.size !== 2 || containerFingerprints.size !== 2) {
      throw new Error('Reference builds are not independently isolated')
    }
    byKind.set(contract.contractKind, contract)
  }
  for (const [kind, golden] of Object.entries(expected.goldens)) {
    const contract = byKind.get(kind)
    if (
      !contract ||
      contract.goldenSha256 !== golden.sha256 ||
      contract.relationContractSha256 !== golden.relationContractSha256 ||
      contract.relationSetSha256 !== golden.relationSetSha256 ||
      contract.schemaEvidenceSha256 !== golden.schemaEvidenceSha256 ||
      contract.schemaFingerprintSha256 !== golden.schemaFingerprintSha256
    ) {
      throw new Error('Candidate Golden differs from its bootstrap provenance')
    }
  }
  return provenance
}

async function main() {
  const requested = parseSchemaGoldenCandidateOptions(process.argv.slice(2))
  const workspace = await realpath(process.cwd())
  const directory = await realpath(requested.directory)
  if (
    directory === workspace ||
    directory.startsWith(`${workspace}${path.sep}`)
  ) {
    throw new Error('Golden candidate must remain outside the repository')
  }
  const files = (await readdir(directory)).sort()
  if (files.join('\n') !== EXPECTED_FILES.join('\n')) {
    throw new Error(
      'Golden candidate artifact file set is incomplete or unexpected',
    )
  }
  const goldens = {}
  for (const [short, kind] of [
    ['pre', 'pre_activation'],
    ['post', 'post_activation'],
  ]) {
    const { sha256: relationContractSha256 } =
      await loadCriticalRelationContract(
        path.join(
          workspace,
          'supabase',
          'backup',
          `${short}-activation.v1.json`,
        ),
        kind,
      )
    const loaded = await loadSchemaGolden(
      path.join(directory, `${short}-activation.schema-golden.v2.json`),
      kind,
      relationContractSha256,
    )
    goldens[kind] = {
      ...loaded.golden,
      sha256: loaded.sha256,
      relationContractSha256,
    }
  }
  const provenanceBytes = await readFile(
    path.join(directory, 'schema-golden-bootstrap-provenance.v1.json'),
  )
  const provenance = JSON.parse(provenanceBytes.toString('utf8'))
  if (provenanceBytes.toString('utf8') !== `${canonicalJson(provenance)}\n`) {
    throw new Error('Golden provenance bytes are not canonical')
  }
  const { contract: bootstrap, sha256: bootstrapContractSha256 } =
    await loadSchemaGoldenBootstrapContract(workspace)
  validateSchemaGoldenCandidateProvenance(provenance, {
    bootstrap,
    bootstrapContractSha256,
    gitCommitSha: requested['expected-commit-sha'],
    goldens,
  })
  process.stdout.write(
    `${JSON.stringify({ status: 'schema_golden_candidate_verified', fileCount: files.length, outputContainsRowData: false, preGoldenSha256: goldens.pre_activation.sha256, postGoldenSha256: goldens.post_activation.sha256 })}\n`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main().catch(() => {
    process.stderr.write(
      'Schema-golden candidate verification failed closed.\n',
    )
    process.exit(1)
  })
}
