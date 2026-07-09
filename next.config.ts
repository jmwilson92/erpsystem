import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
