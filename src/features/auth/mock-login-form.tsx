'use client'

import { ArrowRight, CheckCircle2, LockKeyhole } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

const mockEmail = 'owner@capital-lab.local'

export function MockLoginForm() {
  const router = useRouter()
  const [error, setError] = useState('')

  return (
    <form
      className="login-form"
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        if (
          form.get('email') !== mockEmail ||
          form.get('password') !== 'mock-access'
        ) {
          setError('Use the local mock owner credentials shown below.')
          return
        }
        router.push('/dashboard')
      }}
    >
      <label className="field-label" htmlFor="email">
        Owner email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="username"
        defaultValue={mockEmail}
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
        defaultValue="mock-access"
        required
      />
      <p className="login-form__hint">
        <CheckCircle2 size={14} aria-hidden="true" />
        Local credentials: {mockEmail} / mock-access
      </p>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="button button--primary button--full" type="submit">
        Enter mock laboratory <ArrowRight size={15} aria-hidden="true" />
      </button>
      <p className="login-form__security">
        <LockKeyhole size={13} aria-hidden="true" />
        No remote session or credential is created in mock mode.
      </p>
    </form>
  )
}
