import { ArrowRight, LockKeyhole } from 'lucide-react'

import { registerOwner, signIn } from '@/lib/auth/actions'

export function OwnerLoginForm({
  reason,
  bootstrapEnabled,
}: {
  reason?: string
  bootstrapEnabled: boolean
}) {
  const error =
    reason === 'invalid-credentials'
      ? 'The email or password was not accepted.'
      : reason === 'unauthorized'
        ? 'This account is not the authorized Capital Lab owner.'
        : reason === 'session-expired'
          ? 'Your owner session expired. Sign in again.'
          : reason === 'invalid-registration'
            ? 'Use a valid email and matching password of at least 12 characters.'
            : reason === 'registration-unavailable'
              ? 'Owner setup could not be completed. Retry later or use the existing owner login.'
              : null

  const success =
    reason === 'check-email'
      ? 'Check your inbox, confirm the account, then return here to sign in.'
      : reason === 'email-confirmed'
        ? 'Email confirmed. Sign in to bind this account as the Capital Lab owner.'
        : null

  return (
    <>
      <form className="login-form" action={signIn}>
        <label className="field-label" htmlFor="email">
          Owner email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
        />
        <label className="field-label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="form-success" role="status">
            {success}
          </p>
        ) : null}
        <button className="button button--primary button--full" type="submit">
          Sign in as owner <ArrowRight size={15} aria-hidden="true" />
        </button>
        <p className="login-form__security">
          <LockKeyhole size={13} aria-hidden="true" /> Authorization is checked
          against the server-controlled owner table.
        </p>
      </form>

      {bootstrapEnabled ? (
        <details className="owner-bootstrap">
          <summary>First-time owner setup</summary>
          <p>
            Create the pre-authorized owner account. Supabase will ask you to
            confirm the email before the first sign-in.
          </p>
          <form className="login-form" action={registerOwner}>
            <label className="field-label" htmlFor="registration-email">
              Owner email
            </label>
            <input
              id="registration-email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
            <label className="field-label" htmlFor="registration-password">
              New password
            </label>
            <input
              id="registration-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
            <label
              className="field-label"
              htmlFor="registration-password-confirmation"
            >
              Confirm password
            </label>
            <input
              id="registration-password-confirmation"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
            <button
              className="button button--secondary button--full"
              type="submit"
            >
              Create owner account
            </button>
          </form>
        </details>
      ) : null}
    </>
  )
}
