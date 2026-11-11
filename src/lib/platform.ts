import { cookies } from "next/headers";
import { DEMO_COOKIE, TENANT_COOKIE } from "@/lib/db";

/**
 * Platform (Protessera dogfood) context — not a customer tenant and not an
 * anonymous demo sandbox. Platform-only surfaces (support desk, tenant
 * registry, etc.) must call this before rendering or mutating.
 *
 * - Customer instance: `forge-tenant` cookie is set
 * - Demo test-drive: `forge-demo` cookie is set
 * - Dogfood / marketing / public: neither cookie → platform
 */
export async function isPlatformContext(): Promise<boolean> {
  const jar = await cookies();
  if (jar.get(TENANT_COOKIE)?.value) return false;
  if (jar.get(DEMO_COOKIE)?.value) return false;
  return true;
}

/** Alias for support features that must never appear in customer/demo ERP. */
export async function isPlatformSupportEnabled(): Promise<boolean> {
  return isPlatformContext();
}

/** Real, active public-schema session only; demo personas never carry platform authority. */
export async function getPlatformSessionAdmin() {
  if (!(await isPlatformContext())) return null;
  const { getSessionUser } = await import("@/lib/auth-core");
  const user = await getSessionUser();
  return user?.isActive && user.role === "ADMIN" ? user : null;
}
