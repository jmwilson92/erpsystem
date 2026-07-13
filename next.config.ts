import type { NextConfig } from "next";

// Security headers applied to every response. HSTS only matters behind
// HTTPS (cloud / reverse proxy) and is ignored over plain HTTP.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
