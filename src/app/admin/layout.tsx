import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

/**
 * /admin/* is ADMIN-only. Server actions already re-check permissions on
 * every mutation; this keeps the pages themselves (user lists, permission
 * catalog, import tools) from rendering for other roles.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/");
  return <>{children}</>;
}
