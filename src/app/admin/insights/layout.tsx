import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { isPlatformSupportEnabled } from "@/lib/platform";
import { DEMO_COOKIE, TENANT_COOKIE } from "@/lib/db";
import { StaffDeskShell } from "@/components/support/staff-desk-shell";

/**
 * Product insights — part of the same unlisted staff portal as the support
 * queue, with the same guard: platform (dogfood) context only, ADMIN only.
 *
 * A customer-tenant ADMIN is also "ADMIN" inside their own instance, so the
 * platform-context check (no tenant/demo routing cookie) is what actually keeps
 * this owner-only.
 */
export default async function AdminInsightsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isPlatformSupportEnabled())) redirect("/");

  const jar = await cookies();
  if (jar.get(TENANT_COOKIE)?.value || jar.get(DEMO_COOKIE)?.value) {
    redirect("/");
  }

  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/");

  return <StaffDeskShell userName={user.name}>{children}</StaffDeskShell>;
}
