import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/current-user'
import { errorResponse, readJsonBody } from '@/lib/http'
import { createInterest, listInterests } from '@/lib/interests/service'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await requireUser()
    return NextResponse.json({ interests: await listInterests(user.id) })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const interest = await createInterest(user.id, await readJsonBody(request))
    return NextResponse.json({ interest }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
