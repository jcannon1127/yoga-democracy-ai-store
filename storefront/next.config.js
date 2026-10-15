const checkEnvVariables = require("./check-env-variables")

checkEnvVariables()

/**
 * Medusa Cloud-related environment variables
 */
const S3_HOSTNAME = process.env.MEDUSA_CLOUD_S3_HOSTNAME
const S3_PATHNAME = process.env.MEDUSA_CLOUD_S3_PATHNAME

const MEDUSA_BACKEND_URL = process.env.MEDUSA_BACKEND_URL || "http://127.0.0.1:9000"

/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  /**
   * Medusa stores image URLs relative — `/static/foo.jpg` — which is right: absolute URLs
   * would bake today's hostname into the database. At the edge, /static/* is proxied to
   * Medusa, so a browser resolves them fine.
   *
   * But next/image's optimizer runs ON THE NEXT SERVER and resolves a relative src against
   * its OWN origin, i.e. :8000/static/..., which does not exist. Every product image was
   * failing with "The requested resource isn't a valid image ... received text/html" — the
   * optimizer was being handed Next's own 404 page. This rewrite gives the Next server the
   * same view of /static that the browser has at the edge.
   */
  async rewrites() {
    return [
      {
        source: "/static/:path*",
        destination: `${MEDUSA_BACKEND_URL}/static/:path*`,
      },
    ]
  },
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    /**
     * Stop generating widths that carry no extra information.
     *
     * Next's defaults top out at 2048 and 3840, so `sizes="100vw"` asks for a 3840px render
     * of every photograph — up to 2.57 MB, measured by the catalogue agent across the catalogue. The
     * sources are genuinely 2400x3606, so this is not upscaling, BUT the verified
     * photography ceiling is 1200px: above that SFCC's own renders are interpolation,
     * measured at 0.177/255 difference from a 1200->2000 upscale. So the extra bytes are
     * paying for pixels that carry no detail.
     *
     * 1920 is kept as the ceiling because the hero artwork is a genuine 2000px-wide banner.
     * Product imagery should ask for ~1200 via its own `sizes`, which is the component's
     * decision rather than this file's.
     */
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    remotePatterns: [
      // Loopback: dev, and any image URL Medusa still serves as an absolute local URL.
      { protocol: "http", hostname: "localhost" },
      { protocol: "http", hostname: "127.0.0.1" },
      // The public preview origin — /static/* is proxied to Medusa at the edge, so images
      // referenced either relatively or as https://yd.thisisus.ai/static/... both resolve.
      { protocol: "https", hostname: "yd.thisisus.ai" },
      {
        protocol: "https",
        hostname: "medusa-public-images.s3.eu-west-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "medusa-server-testing.s3.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "medusa-server-testing.s3.us-east-1.amazonaws.com",
      },
      ...(S3_HOSTNAME && S3_PATHNAME
        ? [
            {
              protocol: "https",
              hostname: S3_HOSTNAME,
              pathname: S3_PATHNAME,
            },
          ]
        : []),
    ],
  },
}

module.exports = nextConfig
