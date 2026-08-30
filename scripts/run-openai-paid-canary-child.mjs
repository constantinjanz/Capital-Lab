import { spawn } from 'node:child_process'

const child = spawn(
  process.execPath,
  [
    '--conditions=react-server',
    '--import',
    'tsx',
    'scripts/run-openai-paid-canary.ts',
    ...process.argv.slice(2),
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AGENT_ENABLED: 'false',
      AGENT_EXECUTION_MODE: 'mock',
      AUTONOMOUS_PAPER_EXECUTION_ENABLED: 'false',
      PAID_MODEL_CALLS_ENABLED: 'true',
      OPENAI_CANARY_ENABLED: 'true',
      OPENAI_WEB_SEARCH_ENABLED: 'false',
      SOL_ENABLED: 'false',
      SOL_CHALLENGER_ENABLED: 'false',
      SOL_LIVE_EXECUTION_ENABLED: 'false',
      REAL_BROKER_ENABLED: 'false',
      SCHEDULER_ENABLED: 'false',
      MARKET_DATA_PROVIDER: 'mock',
      NEWS_PROVIDER: 'mock',
    },
    shell: false,
    windowsHide: true,
    stdio: 'inherit',
  },
)

let interrupted = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    interrupted = true
    child.kill(signal)
  })
}

child.once('error', () => {
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  process.exitCode = interrupted || signal ? 130 : (code ?? 1)
})
