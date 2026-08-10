const TRANSACTION_CONTROL =
  /^\s*(begin|commit|rollback)(?:\s+(?:work|transaction))?\s*;\s*(?:--.*)?$/gimu

export function extractRollbackMigrationBody(sql, filename) {
  if (
    typeof sql !== 'string' ||
    !/^[0-9]{14}_[a-z0-9_]+\.sql$/u.test(filename)
  ) {
    throw new Error('Rollback rehearsal migration input is invalid')
  }
  const controls = [...sql.matchAll(TRANSACTION_CONTROL)]
  if (
    controls.length !== 2 ||
    controls[0][1].toLowerCase() !== 'begin' ||
    controls[1][1].toLowerCase() !== 'commit'
  ) {
    throw new Error(
      `Migration ${filename} must have exactly one outer BEGIN/COMMIT pair`,
    )
  }
  const first = controls[0]
  const second = controls[1]
  const body =
    sql.slice(0, first.index) +
    sql.slice(first.index + first[0].length, second.index) +
    sql.slice(second.index + second[0].length)
  if (!body.trim()) {
    throw new Error(`Migration ${filename} has no rehearsal body`)
  }
  return body
}
