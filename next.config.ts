/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_GA_ID: process.env.NEXT_PUBLIC_GA_ID,
    NEXT_PUBLIC_RELEASE: process.env.NEXT_PUBLIC_RELEASE,
  },
  // If you need to enable source maps upload, add the following:
  // webpack(config, { isServer }) {
  //   if (!isServer) {
  //     config.devtool = 'source-map';
  //   }
  //   return config;
  // },
};

module.exports = nextConfig;
