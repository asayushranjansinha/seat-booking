import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // `next build` and `next dev` share .next by default, so building while the dev server
  // is running overwrites the chunks it is serving and every page goes blank with
  // "__webpack_modules__[moduleId] is not a function". `npm run build:check` sets this
  // to a separate directory so a verification build cannot disturb a live dev server.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // The geometry package ships TypeScript source rather than a build step, so the two
  // engines can never drift through a stale dist/ directory.
  transpilePackages: ['@seat-booking/geometry'],
};

export default config;
