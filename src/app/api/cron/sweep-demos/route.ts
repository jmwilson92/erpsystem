import { NextRequest } from "next/server";
import { sweepIdleDemos } from "@/lib/services/tenancy";

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
  const maxIdle = Number(process.env.DEMO_IDLE_MINUTES) || 60;
  const destroyed = await sweepIdleDemos(maxIdle);
  return Response.json({ ok: true, destroyed, maxIdleMinutes: maxIdle });
}
