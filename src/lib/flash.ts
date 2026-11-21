import { cookies } from "next/headers";

const FLASH_COOKIE = "forge-flash";

export type FlashPayload = {
  m: string;
  k: "success" | "error";
  t: number;
  code?: string;
  cid?: string;
  route?: string;
  et?: string;
  ei?: string;
  a?: string;
};

/**
 * Queue a bottom-right toast for the next render — call from a server
 * action right before revalidatePath/redirect. The shell reads the cookie,
 * fires the toast client-side, and clears it.
 */
export async function flashToast(
  message: string,
  kind: "success" | "error" = "success",
  meta?: { errorCode?: string; correlationId?: string; route?: string; entityType?: string; entityId?: string; action?: string }
) {
  const jar = await cookies();
  const payload: FlashPayload = { m: message, k: kind, t: Date.now() };
  if (meta?.errorCode) payload.code = meta.errorCode;
  if (meta?.correlationId) payload.cid = meta.correlationId;
  if (meta?.route) payload.route = meta.route;
  if (meta?.entityType) payload.et = meta.entityType;
  if (meta?.entityId) payload.ei = meta.entityId;
  if (meta?.action) payload.a = meta.action;
  jar.set(
    FLASH_COOKIE,
    encodeURIComponent(JSON.stringify(payload)),
    { path: "/", maxAge: 30, httpOnly: false, sameSite: "lax" }
  );
}

/** Read (without clearing — the client clears) the pending flash toast. */
export async function readFlashToast(): Promise<FlashPayload | null> {
  try {
    const jar = await cookies();
    const raw = jar.get(FLASH_COOKIE)?.value;
    if (!raw) return null;
    const parsed = JSON.parse(decodeURIComponent(raw)) as FlashPayload;
    if (!parsed?.m) return null;
    // Stale guard — ignore flashes older than 30s
    if (Date.now() - (parsed.t || 0) > 30_000) return null;
    return parsed;
  } catch {
    return null;
  }
}
