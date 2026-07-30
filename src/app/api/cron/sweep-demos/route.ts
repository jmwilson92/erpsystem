import { NextRequest } from "next/server";
import {
  sweepIdleDemos,
  demoIdleMinutes,
  ensureDemoPool,
  recycleStalePool,
  demoPoolTarget,
} from "@/lib/services/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reap idle demo tenants (throwaway schemas). Triggered by Vercel Cron on a
 * schedule (see vercel.json) and safe to hit manually. When CRON_SECRET is set,
 * the caller must present it (Vercel Cron sends `Authorization: Bearer <secret>`);
 * without the env var the route is open (local/dev).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  const maxIdle = demoIdleMinutes();
  const destroyed = await sweepIdleDemos(maxIdle);
  // Recycle spares that have been sitting unclaimed for a day so the pool never
  // serves stale seed data after a template rebuild.
  const recycled = await recycleStalePool(24);
  // Then refill so the next visitor gets an instant sandbox.
  const warmed = await ensureDemoPool().catch(() => 0);
  return Response.json({
    ok: true,
    destroyed,
    recycled,
    warmed,
    poolTarget: demoPoolTarget(),
    maxIdleMinutes: maxIdle,
  });
}
