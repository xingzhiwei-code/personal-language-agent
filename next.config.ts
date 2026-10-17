import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @libsql/client optionally loads a native SQLite binding for local `file:`
  // URLs; keep the package external to the server bundle (Turso `libsql://`
  // URLs use the pure-JS HTTP client at runtime).
  serverExternalPackages: ['@libsql/client'],
  // drizzle/*.sql are read by the migration runner at runtime (getDb auto-migrates
  // on first touch). Include them in the serverless deployment package.
  outputFileTracingIncludes: {
    '/**': ['./drizzle/**/*.sql'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  eslint: {
    // Linting is run explicitly via `npm run lint` in CI/verify.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
