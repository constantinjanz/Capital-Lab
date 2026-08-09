import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const separatorIndex = process.argv.indexOf('--')
const idIndex = process.argv.indexOf('--id')
if (
  idIndex < 0 ||
  !process.argv[idIndex + 1] ||
  separatorIndex < 0 ||
  !process.argv[separatorIndex + 1]
) {
  console.error('Usage: run-ci-gate.mjs --id <gate> -- <command> [args...]')
  process.exit(2)
}

const id = process.argv[idIndex + 1]
if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
  console.error('Gate id must contain only lowercase letters, digits, _ or -.')
  process.exit(2)
}

const command = process.argv[separatorIndex + 1]
const args = process.argv.slice(separatorIndex + 2)
const startedAt = new Date().toISOString()
let combinedOutput = ''

const child = spawn(command, args, {
  env: process.env,
  shell: process.platform === 'win32',
})

child.stdout.on('data', (chunk) => {
  const text = chunk.toString()
  combinedOutput += text
  process.stdout.write(text)
})
child.stderr.on('data', (chunk) => {
  const text = chunk.toString()
  combinedOutput += text
  process.stderr.write(text)
})

const exitCode = await new Promise((resolve) => {
  child.on('error', () => resolve(127))
  child.on('close', (code) => resolve(code ?? 1))
})

const normalizedOutput = combinedOutput.replace(
  /\u001b\[[0-?]*[ -/]*[@-~]/g,
  '',
)
const vitestFiles = normalizedOutput.match(/Test Files\s+(\d+)\s+passed/i)
const vitestTests = normalizedOutput.match(/Tests\s+(\d+)\s+passed/i)
const pgTap = normalizedOutput.match(/Files=(\d+),\s+Tests=(\d+)/i)
const playwrightPassed = normalizedOutput.match(/(?:^|\n)\s*(\d+)\s+passed\b/i)
const playwrightFlaky = normalizedOutput.match(/(?:^|\n)\s*(\d+)\s+flaky\b/i)
const passedTests =
  Number(vitestTests?.[1] ?? pgTap?.[2] ?? playwrightPassed?.[1]) || null
const flakyTests = Number(playwrightFlaky?.[1]) || 0
const evidence = {
  schemaVersion: 2,
  gate: id,
  commitSha: process.env.CAPITAL_LAB_CI_COMMIT_SHA ?? null,
  startedAt,
  completedAt: new Date().toISOString(),
  exitCode,
  counts: {
    files: Number(vitestFiles?.[1] ?? pgTap?.[1]) || null,
    tests: passedTests === null ? null : passedTests + flakyTests,
    passed: passedTests,
    flaky: flakyTests,
  },
}

const evidenceDirectory = path.join(process.cwd(), '.ci-evidence')
await mkdir(evidenceDirectory, { recursive: true })
await writeFile(
  path.join(evidenceDirectory, `${id}.json`),
  `${JSON.stringify(evidence, null, 2)}\n`,
  'utf8',
)

process.exit(exitCode)
