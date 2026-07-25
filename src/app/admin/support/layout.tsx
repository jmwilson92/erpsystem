import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { isPlatformSupportEnabled } from "@/lib/platform";
import { DEMO_COOKIE, TENANT_COOKIE } from "@/lib/db";
import { StaffDeskShell } from "@/components/support/staff-desk-shell";

/**
 * Platform staff support desk — standalone (no ERP chrome).
 * Customer ADMINs and demos are rejected even if they type the URL.
 */
export default async function AdminSupportLayout({
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
