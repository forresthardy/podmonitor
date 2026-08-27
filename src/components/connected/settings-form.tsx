'use client'

import { useState } from 'react'
import { SettingsPanel } from '@/components/settings-panel'
import { deleteJson, getJson, patchJson, postJson } from '@/lib/http-client'
import type { SettingsView } from '@/lib/settings/types'

interface SettingsResponse {
  settings: SettingsView
}

/**
 * Settings holds its own copy of the view because three different writes change it and each
 * one must leave the panel showing what the server stored. `refresh()` re-reads rather than
 * merging a guess: the interest list is server-ordered, and an add that collided with an
 * existing interest changes nothing at all — a local append would have shown a phantom row.
 */
export function SettingsForm({ initialSettings }: { initialSettings: SettingsView }) {
  const [settings, setSettings] = useState(initialSettings)

  async function refresh(): Promise<void> {
    const response = await getJson<SettingsResponse>('/api/settings')
    setSettings(response.settings)
  }

  return (
    <SettingsPanel
      settings={settings}
      onAddInterest={async (text) => {
        await postJson('/api/interests', { text })
        await refresh()
      }}
      onRemoveInterest={async (interestId) => {
        await deleteJson(`/api/interests/${interestId}`)
        await refresh()
      }}
      onSetDigestOptIn={async (optIn) => {
        const response = await patchJson<SettingsResponse>('/api/settings', {
          weeklyDigestOptIn: optIn,
        })
        setSettings(response.settings)
      }}
    />
  )
}
