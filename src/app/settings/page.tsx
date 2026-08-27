import { redirect } from 'next/navigation'
import { AppNav } from '@/components/app-nav'
import { SettingsForm } from '@/components/connected/settings-form'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSettingsView } from '@/lib/settings/service'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const settings = await getSettingsView(user.id)

  return (
    <div className="stack">
      <AppNav email={user.email} />
      <SettingsForm initialSettings={settings} />
    </div>
  )
}
