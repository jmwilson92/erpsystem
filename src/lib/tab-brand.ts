import { prisma, currentRequestSchema } from "@/lib/db";
import { SITE_NAME } from "@/lib/site";

/**
 * The name that belongs in the browser tab for the current request.
 *
 * Customers see their own company name — a tenant signed into their instance is
 * looking at their business, not at ours. Everyone else (marketing visitors,
 * demo sandboxes, and the platform/dogfood instance) sees the product name.
 *
 * Only `tenant_*` schemas qualify. `public` is our own instance, and a demo
 * sandbox is a sales surface where the product name is the point.
 *
 * Never throws. A tab title is not worth failing a page render over, so any
 * failure — unmigrated schema, database hiccup, called outside a request scope —
 * falls back to the product name.
 */
export async function getTabBrand(): Promise<string> {
  try {
    const schema = await currentRequestSchema();
    if (!schema.startsWith("tenant_")) return SITE_NAME;

    const company = await prisma.companySettings.findUnique({
      where: { id: "default" },
      select: { name: true },
    });
    return company?.name?.trim() || SITE_NAME;
  } catch {
    return SITE_NAME;
  }
}
