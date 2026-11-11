import { redirect } from "next/navigation";
import { getPlatformSessionAdmin } from "@/lib/platform";

/**
 * Platform (dogfood) ADMIN only.
 *
 * A customer's own admin is also role ADMIN inside their schema, and a demo
 * sandbox admin is too. The platform-context check (no forge-tenant and no
 * forge-demo cookie) is what keeps the registry off those instances. The
 * /admin layout repeats the role check; this function is the page-level gate
 * so the list and the detail route cannot drift apart.
 */
export async function requireTenantRegistryAccess(): Promise<void> {
  if (!(await getPlatformSessionAdmin())) redirect("/");
}
