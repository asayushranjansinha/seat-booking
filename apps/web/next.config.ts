import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // The geometry package ships TypeScript source rather than a build step, so the two
  // engines can never drift through a stale dist/ directory.
  transpilePackages: ['@seat-booking/geometry'],
};

export default config;
