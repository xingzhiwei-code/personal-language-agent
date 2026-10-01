import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // better-sqlite3 is a native module; keep it external to the server bundle.
  serverExternalPackages: ['better-sqlite3'],
  eslint: {
    // Linting is run explicitly via `npm run lint` in CI/verify.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
