import { NextRequest } from "next/server";
import { controlPlaneClient, isValidSchemaName, runWithSchema } from "@/lib/db";
import { prismaCarinaTaskDeps, runDueTasks } from "@/lib/services/carina-tasks";
import { prismaFloorMonitorDeps, runFloorMonitor } from "@/lib/services/carina-floor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Run queued Carina to-do tasks as the creating user, per tenant.
 * Vercel Cron every 5 minutes (vercel.json). When CRON_SECRET is set,
 * the caller must present it (Vercel Cron sends `Authorization: Bearer <secret>`).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const schemas = await listServingSchemas();
  const results: { schema: string; ran: number; floorNotified?: number; floorRan?: boolean; error?: string }[] = [];
  for (const schema of schemas) {
    try {
      const ran = await runWithSchema(schema, async () => {
        const deps = await prismaCarinaTaskDeps();
        const tasks = await runDueTasks(deps, { limit: 10 });
        let floor = { notified: 0, ran: false as boolean };
        try {
          floor = await runFloorMonitor(await prismaFloorMonitorDeps());
        } catch {
          // A missing floor-alert table on a lagging schema should not fail the sweep.
        }
        return { tasks, floor };
      });
      results.push({ schema, ran: ran.tasks, floorNotified: ran.floor.notified, floorRan: ran.floor.ran });
    } catch (err) {
      const message = err instanceof Error ? err.message : "failed";
      // A missing table on a lagging schema should not fail the whole sweep.
      results.push({ schema, ran: 0, error: message.slice(0, 200) });
    }
  }
  return Response.json({ ok: true, results });
}

async function listServingSchemas(): Promise<string[]> {
  const tenants = await controlPlaneClient().tenant.findMany({
    where: { status: "ACTIVE" },
    select: { schemaName: true },
  });
  const names = ["public", ...tenants.map((t) => t.schemaName).filter((s) => isValidSchemaName(s))];
  return [...new Set(names)];
}
