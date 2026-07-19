import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { demoModeEnabled } from "@/lib/auth-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Liveness / readiness for load balancers and ops.
 * Public (middleware allowlist). Does not leak secrets.
 */
export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      {
        ok: true,
        status: "healthy",
        db: "up",
        demoMode: demoModeEnabled(),
        uptimeMs: Math.round(process.uptime() * 1000),
        latencyMs: Date.now() - started,
        version: process.env.npm_package_version || "1.0.0",
        time: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        status: "unhealthy",
        db: "down",
        error: e instanceof Error ? e.message : "database unreachable",
        latencyMs: Date.now() - started,
        time: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
