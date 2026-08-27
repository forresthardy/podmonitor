import { NextResponse } from 'next/server'
import { checkHealth } from '@/queue/health'

export const dynamic = 'force-dynamic'

/** Unauthenticated on purpose: it reports component reachability, never any user data. */
export async function GET() {
  const report = await checkHealth()
  return NextResponse.json(report, { status: report.ok ? 200 : 503 })
}
