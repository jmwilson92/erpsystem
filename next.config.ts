import type { NextConfig } from "next";
import path from "node:path";

/**
 * Air-gapped builds replace every module that would ship a third-party URL with
 * a local stub.
 *
 * Aliasing rather than run-time gating, because a conditional render still bundles
 * the dependency: `{analyticsEnabled() && <Analytics />}` kept
 * va.vercel-scripts.com in a shared chunk, so the build could still call out even
 * though the component never rendered. Removing the module is the only version of
 * this that survives scripts/assert-airgap-build.mjs.
 *
 * Build with AIRGAP=1 for an on-premise image; hosted builds are unaffected.
 */
const AIRGAP = process.env.AIRGAP === "1";

const airgapAliases = AIRGAP
  ? {
      "@vercel/analytics/next": path.resolve(
        __dirname,
        "src/lib/airgap-stubs/analytics.tsx"
      ),
    }
  : {};

// Security headers applied to every response. HSTS only matters behind
// HTTPS (cloud / reverse proxy) and is ignored over plain HTTP.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    // microphone=(self) — voice assistant needs the mic on this origin.
    // camera/geo stay off. payment stays off (Stripe uses its own flow).
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  webpack(config) {
    // Ours first: webpack matches alias entries in insertion order, and Next
    // already registers a broad "@" mapping for tsconfig paths. Spread after it
    // and the broad key wins, so the stub is never reached — which is exactly
    // what happened on the first attempt, silently.
    config.resolve.alias = { ...airgapAliases, ...config.resolve.alias };
    return config;
  },
  images: {
    // Marketing art is full-bleed photography. AVIF first (typically 40-60%
    // smaller than JPEG at the same quality), WebP fallback — so high-resolution
    // source images can be dropped into public/marketing without shipping
    // multi-megabyte JPEGs to phones.
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  // Allow Codespaces + Cloudflare quick tunnels to call dev RSC / HMR endpoints
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "*.app.github.dev",
    "*.github.dev",
    "localhost:3000",
    "localhost:3001",
    "127.0.0.1:3000",
    "127.0.0.1:3001",
  ],
  // Required for Server Actions behind Codespaces / Cloudflare tunnels
  experimental: {
    serverActions: {
      // Uploads (drawings, WI/step photos, quote PDFs, employee docs) travel as
      // data URLs inside the action body; the 1MB default rejects them with
      // "An unexpected response was received from the server".
      bodySizeLimit: "25mb",
      allowedOrigins: [
        "localhost:3000",
        "localhost:3001",
        "127.0.0.1:3000",
        "127.0.0.1:3001",
        "*.app.github.dev",
        "*.github.dev",
        "*.trycloudflare.com",
      ],
    },
  },
};

export default nextConfig;
