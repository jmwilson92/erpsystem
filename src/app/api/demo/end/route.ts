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
    void import("@/lib/services/tenancy")
      .then((m) => m.destroyTenant(schema))
      .catch(() => undefined);
  }

  // Absolute URL with Codespaces-safe origin (no *.app.github.dev:3000).
  return NextResponse.redirect(publicUrlFromRequest(req, "/welcome?ended=1"), 303);
}

export async function POST(req: Request) {
  return GET(req);
}
