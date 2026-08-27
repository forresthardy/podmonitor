import bcrypt from 'bcryptjs'
import { bcryptCost } from '@/lib/env'

export const MIN_PASSWORD_LENGTH = 10
export const MAX_PASSWORD_LENGTH = 200

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, bcryptCost())
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}
