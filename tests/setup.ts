import { afterAll } from 'vitest'
import './env'
import { closeDb } from '../src/db/client'

afterAll(async () => {
  await closeDb()
})
