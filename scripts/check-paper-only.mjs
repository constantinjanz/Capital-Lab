import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const ignored = new Set([
  '.git',
  '.next',
  'node_modules',
  'node_modules.partial',
  'capital-lab-scaffold',
  'coverage',
  'playwright-report',
  'test-results',
])

const forbidden = [
  { name: 'Alpaca brokerage host', pattern: /paper-api\.alpaca\.markets/i },
  { name: 'broker order endpoint', pattern: /\/v2\/orders(?:\b|\/)/i },
  { name: 'Alpaca trading SDK', pattern: /@alpacahq\/alpaca-trade-api/i },
  { name: 'broker order client', pattern: /\bTradingClient\b|\bsubmitOrder\b/ },
  { name: 'broker secret variable', pattern: /ALPACA_(?:PAPER_)?TRADING_/i },
  {
    name: 'private key material',
    pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
  },
  {
    name: 'committed OpenAI-style secret',
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/,
  },
  {
    name: 'committed Supabase secret',
    pattern: /\bsb_secret_[A-Za-z0-9_-]{16,}\b/,
  },
  {
    name: 'committed JWT-like token',
    pattern:
      /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/,
  },
]

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const results = []
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) results.push(...(await filesUnder(fullPath)))
    else if (
      /\.(?:ts|tsx|js|mjs|cjs|json|md|sql|toml|ya?ml|env)$/i.test(entry.name)
    ) {
      results.push(fullPath)
    }
  }
  return results
}

const findings = []
for (const filename of await filesUnder(root)) {
  if (filename.endsWith(path.join('scripts', 'check-paper-only.mjs'))) continue
  const content = await readFile(filename, 'utf8')
  for (const rule of forbidden) {
    if (rule.pattern.test(content)) {
      findings.push(`${path.relative(root, filename)}: ${rule.name}`)
    }
  }

  const isCodeFile = /\.(?:ts|tsx|js|mjs|cjs)$/i.test(filename)
  const isOpenAIGateway = filename.endsWith(
    path.join('src', 'providers', 'openai', 'gateway.ts'),
  )
  const importsOpenAISdk =
    /(?:from\s+['"]openai['"]|import\s*\(\s*['"]openai['"]\s*\)|require\s*\(\s*['"]openai['"]\s*\))/m.test(
      content,
    )

  if (isCodeFile && importsOpenAISdk && !isOpenAIGateway) {
    findings.push(
      `${path.relative(root, filename)}: OpenAI SDK import outside the single gateway`,
    )
  }
}

if (findings.length > 0) {
  console.error('PAPER TRADING ONLY safety scan failed:')
  findings.forEach((finding) => console.error(`- ${finding}`))
  process.exit(1)
}

console.log('PAPER TRADING ONLY safety scan passed.')
