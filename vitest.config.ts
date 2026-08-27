import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: { '@': resolve(root, 'src') },
  },
  // `tsconfig.json` sets jsx: preserve for Next's compiler, which esbuild cannot run.
  // Tests need real JSX transforms, so they are configured here rather than by weakening
  // the app's tsconfig.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    // Component tests are .tsx and opt into jsdom per file with a @vitest-environment
    // docblock — the default stays node so integration tests keep real Postgres behaviour.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    // Integration tests share one Postgres database: run files serially.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
})
