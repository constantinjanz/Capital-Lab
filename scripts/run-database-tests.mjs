import { spawnSync } from 'node:child_process'

function commandExists(command) {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  return result.status === 0
}

if (!commandExists('docker')) {
  console.error(
    'Database tests require Docker; Docker is not installed or running.',
  )
  process.exit(2)
}

if (!commandExists('supabase')) {
  console.error('Database tests require the Supabase CLI.')
  process.exit(2)
}

const reset = spawnSync('supabase', ['db', 'reset'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (reset.status !== 0) process.exit(reset.status ?? 1)

const tests = spawnSync('supabase', ['test', 'db'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
process.exit(tests.status ?? 1)
