import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CredentialsForm } from '@/components/credentials-form'
import { getCurrentUser } from '@/lib/auth/current-user'

export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/dashboard')

  return (
    <div className="stack">
      <h1>Sign in to Podmonitor</h1>
      <CredentialsForm mode="login" />
      <p className="muted">
        No account yet? <Link href="/register">Create one</Link>
      </p>
    </div>
  )
}
