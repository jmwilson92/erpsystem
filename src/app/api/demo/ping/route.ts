import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DEMO_COOKIE } from "@/lib/db";

/** Keep the throwaway demo alive while the visitor is still on the site. */
export async function POST() {
  const jar = await cookies();
  const schema = jar.get(DEMO_COOKIE)?.value;
  if (schema && /^demo_[a-z0-9]{6,40}$/.test(schema)) {
    const { touchTenant } = await import("@/lib/services/tenancy");
    void touchTenant(schema).catch(() => undefined);
  }
  return new NextResponse(null, { status: 204 });
}

export async function GET() {
  return POST();
}
