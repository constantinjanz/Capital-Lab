import { ArrowRight, LockKeyhole } from 'lucide-react'

import { signIn } from '@/lib/auth/actions'

export function OwnerLoginForm({ reason }: { reason?: string }) {
  const error =
    reason === 'invalid-credentials'
      ? 'The email or password was not accepted.'
      : reason === 'unauthorized'
        ? 'This account is not the authorized Capital Lab owner.'
        : reason === 'session-expired'
          ? 'Your owner session expired. Sign in again.'
          : null

  return (
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
      <button className="button button--primary button--full" type="submit">
        Sign in as owner <ArrowRight size={15} aria-hidden="true" />
      </button>
      <p className="login-form__security">
        <LockKeyhole size={13} aria-hidden="true" /> Authorization is checked
        against the server-controlled owner table.
      </p>
    </form>
  )
}
