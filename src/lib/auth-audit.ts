/** Internal auth audit routing. Before login there is deliberately no tenant cookie. */
import { controlPlaneClient, clientForSchema } from "./db";
export async function logAuthAudit(userId: string, schema: string | null, action: string) {
  try {
    const db = schema && schema !== "public" ? clientForSchema(schema) : controlPlaneClient();
    let ipAddress: string | null = null;
    try {
      const { headers } = await import("next/headers");
      const h = await headers();
      ipAddress = (h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "").slice(0, 64) || null;
    } catch { /* CLI regressions have no request headers. */ }
    await db.auditLog.create({ data: { entityType: "User", entityId: userId, userId, action, ipAddress } });
  } catch (error) {
    console.error("Auth audit failed:", error);
  }
}
