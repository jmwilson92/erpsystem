import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DEMO_COOKIE, TENANT_COOKIE } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Leave demo/tenant routing and continue to a staff page.
 *
 * The staff desk is the platform owner's, not a tenant's, so its layouts
 * refuse to render while a demo or tenant routing cookie is present — they
 * must run against the public schema. They used to answer that by bouncing to
 * "/", which meant the owner got silently dropped onto a demo dashboard for
 * the cookie's four-hour life, with nothing on screen saying why. Clearing
 * site data or a private window were the only ways back.
 *
 * The cookie is the problem, so drop the cookie. The isolation rule is
 * untouched: staff pages still refuse to run in demo context. This ends the
 * demo first rather than stranding the person.
 *
 * A Server Component cannot mutate cookies during render, which is why this
 * is a route handler and not something the layout does inline.
 */
export async function GET(req: NextRequest) {
  const jar = await cookies();
  const schema = jar.get(DEMO_COOKIE)?.value;

  // Only ever back into the staff area, and same-origin. An open redirect here
  // would be a phishing primitive handed out on a plate.
  const requested = req.nextUrl.searchParams.get("next") || "";
  const next =
    requested.startsWith("/admin/") && !requested.startsWith("//")
      ? requested
      : "/admin/support";

  const res = NextResponse.redirect(new URL(next, req.nextUrl.origin));

  // Expired on the RESPONSE rather than only through the request jar: the
  // browser must be told to drop these before it follows the redirect, or the
  // staff layout sees them again and bounces straight back here.
  for (const name of [DEMO_COOKIE, "forge-demo-user", TENANT_COOKIE]) {
    res.cookies.set(name, "", { path: "/", maxAge: 0, expires: new Date(0) });
  }

  // Reap the sandbox rather than leaving it for the sweep — the visitor has
  // explicitly walked away from it. Fire-and-forget; destroy is idempotent.
  if (schema && schema !== "demo_template" && /^demo_[a-z0-9]{6,40}$/.test(schema)) {
    const { destroyTenant } = await import("@/lib/services/tenancy");
    void destroyTenant(schema).catch(() => undefined);
  }

  return res;
}
