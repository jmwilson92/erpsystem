import { NextRequest } from "next/server";
import {
  demoIdleMinutes,
  ensureDemoPool,
  recycleStalePool,
  demoPoolTarget,
} from "@/lib/services/tenancy";
import { reapAbandonedDemos } from "@/lib/services/demo-reaper";

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
  const reaped = await reapAbandonedDemos(maxIdle);
  const recycled = await recycleStalePool(24);
  const warmed = await ensureDemoPool().catch(() => 0);
  return Response.json({
    ok: true,
    destroyed: reaped.idle + reaped.stuck + reaped.extraReady,
    reaped,
    recycled,
    warmed,
    poolTarget: demoPoolTarget(),
    maxIdleMinutes: maxIdle,
  });
}
