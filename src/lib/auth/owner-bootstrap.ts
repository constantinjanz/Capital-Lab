export function isExpectedOwnerEmail(
  submittedEmail: string,
  expectedEmail: string | undefined,
): boolean {
  if (!expectedEmail) return false
  return (
    submittedEmail.trim().toLocaleLowerCase('en-US') ===
    expectedEmail.trim().toLocaleLowerCase('en-US')
  )
}
