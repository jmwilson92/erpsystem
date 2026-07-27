import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DEMO_COOKIE } from "@/lib/db";

/**
 * Best-effort teardown when a demo visitor closes the tab.
 * Cookie is cleared; schema drop is fire-and-forget.
 */
export async function POST() {
  const jar = await cookies();
  const schema = jar.get(DEMO_COOKIE)?.value;
  jar.delete(DEMO_COOKIE);
  jar.delete("forge-demo-user");

  if (schema && schema !== "demo_template" && /^demo_[a-z0-9]{6,40}$/.test(schema)) {
    const { destroyTenant } = await import("@/lib/services/tenancy");
    // Don't await long drops — beacon may abort; destroy is idempotent.
    void destroyTenant(schema).catch(() => undefined);
  }

  return new NextResponse(null, { status: 204 });
}

export async function GET() {
  // Some beacons fall back to GET
  return POST();
}
