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

export function getOwnerConfirmationRedirectUrl(appBaseUrl: string): string {
  const redirectUrl = new URL('/login', appBaseUrl)
  redirectUrl.searchParams.set('reason', 'email-confirmed')
  return redirectUrl.toString()
}
