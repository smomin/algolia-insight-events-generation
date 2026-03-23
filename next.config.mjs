/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep native Node.js addons out of webpack bundling
    serverComponentsExternalPackages: ['node-cron', 'couchbase'],
  },
};

export default nextConfig;
