import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

/**
 * Component-test plumbing: unmount between tests.
 *
 * Vitest runs without global test APIs, so React Testing Library's automatic cleanup never
 * registers itself. Without this, a second `render` in the same file finds two copies of
 * every element and queries fail with "found multiple elements" — a confusing failure that
 * has nothing to do with the component under test. Importing this module once per component
 * test file is enough.
 */
afterEach(cleanup)
