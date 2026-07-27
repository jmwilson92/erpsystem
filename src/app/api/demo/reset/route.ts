import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DEMO_COOKIE } from "@/lib/db";
import { publicUrlFromRequest } from "@/lib/request-origin";

/**
 * Clear a broken/stale forge-demo cookie and land on marketing (no auto-start).
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
    void import("@/lib/services/tenancy")
      .then((m) => m.destroyTenant(schema))
      .catch(() => undefined);
  }

  return NextResponse.redirect(publicUrlFromRequest(req, "/welcome?ended=1"), 303);
}
