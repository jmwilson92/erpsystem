import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DEMO_COOKIE } from "@/lib/db";
import { publicUrlFromRequest } from "@/lib/request-origin";

/**
 * Hard end of a test drive — full browser navigation.
 * Clears demo cookies and lands on the marketing landing page without
 * auto-starting a new sandbox.
 */
export async function GET(req: Request) {
  const jar = await cookies();
  const schema = jar.get(DEMO_COOKIE)?.value;

  jar.delete(DEMO_COOKIE);
  jar.delete("forge-demo-user");

  if (
    schema &&
    schema !== "demo_template" &&
    /^demo_[a-z0-9]{6,40}$/.test(schema)
  ) {
    // Record how long the test drive lasted before dropping the schema — the
    // Tenant row still has its createdAt at this point.
    void (async () => {
      try {
        const [{ controlPlaneClient }, { recordEvent }, tenancy] = await Promise.all([
          import("@/lib/db"),
          import("@/lib/services/telemetry"),
          import("@/lib/services/tenancy"),
        ]);
        const t = await controlPlaneClient()
          .tenant.findUnique({
            where: { schemaName: schema },
            select: { createdAt: true },
          })
          .catch(() => null);
        const minutes = t
          ? Math.max(0, (Date.now() - t.createdAt.getTime()) / 60_000)
          : null;
        await recordEvent({
          kind: "DEMO_END",
          source: "DEMO",
          sessionId: schema,
          schemaName: schema,
          detail: minutes == null ? null : { minutes: Math.round(minutes * 10) / 10 },
        });
        await tenancy.destroyTenant(schema);
      } catch {
        /* teardown is best-effort */
      }
    })();
  }

  // Absolute URL with Codespaces-safe origin (no *.app.github.dev:3000).
  return NextResponse.redirect(publicUrlFromRequest(req, "/welcome?ended=1"), 303);
}

export async function POST(req: Request) {
  return GET(req);
}
