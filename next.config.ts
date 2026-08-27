import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // pg and pg-boss are native/CJS server-only packages: keep them out of the bundler.
  serverExternalPackages: ['pg', 'pg-boss'],
}

export default nextConfig
