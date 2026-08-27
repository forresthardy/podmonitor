import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CredentialsForm } from '@/components/credentials-form'
import { getCurrentUser } from '@/lib/auth/current-user'

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect('/dashboard')

  return (
    <div className="stack">
      <h1>Create your account</h1>
      <p className="muted">Passwords must be at least 10 characters.</p>
      <CredentialsForm mode="register" />
      <p className="muted">
        Already registered? <Link href="/login">Sign in</Link>
      </p>
    </div>
  )
}
