/** @type {import('next').NextConfig} */
const nextConfig = {
  // Development and production must not share compiler output. Running
  // `next build` beside `next dev` otherwise replaces chunks used by the
  // live dev server and causes intermittent MODULE_NOT_FOUND errors.
  distDir: process.env.NEXT_DIST_DIR
    || (process.env.NODE_ENV === 'development' ? '.next-dev' : '.next'),
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.shopify.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
      },
    ],
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  // Shopify App Proxy serves this app under /a/s. App Router can miss dynamic
  // Router pages nested under the same pathname as assetPrefix, so rewrites
  // below map those requests to protected /checkout/[sessionId] aliases.
  assetPrefix: process.env.NODE_ENV === 'production'
    ? process.env.NEXT_PUBLIC_APP_PROXY_ASSET_PREFIX || '/a/s'
    : undefined,
  // Performance optimizations
  reactStrictMode: true,
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
    optimizeCss: true,
  },
  async rewrites() {
    return [
      { source: '/a/s/_next/:path*', destination: '/_next/:path*' },
      { source: '/a/s/checkout/:path*', destination: '/checkout/:path*' },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        source: '/a/s/checkout/:path*',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
}

export default nextConfig
