import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { isPlatformSupportEnabled } from "@/lib/platform";
import { DEMO_COOKIE, TENANT_COOKIE } from "@/lib/db";
import { StaffDeskShell } from "@/components/support/staff-desk-shell";

/**
 * Support Staff portal — standalone (no ERP chrome).
 *
 * Support staff ≠ ERP company admins. Customer-tenant ADMINs manage their own
 * business instance only; they cannot open this ticket queue even if they
 * type the URL (tenant cookie / non-public schema → redirect home).
 */
export default async function AdminSupportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Must be public/platform context (no customer or demo routing cookie)
  if (!(await isPlatformSupportEnabled())) redirect("/");

  const jar = await cookies();
  if (jar.get(TENANT_COOKIE)?.value || jar.get(DEMO_COOKIE)?.value) {
    redirect("/");
  }

  const user = await getCurrentUser();
  // Public-schema ADMIN acts as support staff for now
  if (!user || user.role !== "ADMIN") redirect("/");

  return <StaffDeskShell userName={user.name}>{children}</StaffDeskShell>;
}
