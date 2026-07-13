import { cookies } from "next/headers";

const FLASH_COOKIE = "forge-flash";

export type FlashPayload = {
  m: string;
  k: "success" | "error";
  t: number;
};

/**
 * Queue a bottom-right toast for the next render — call from a server
 * action right before revalidatePath/redirect. The shell reads the cookie,
 * fires the toast client-side, and clears it.
 */
export async function flashToast(
  message: string,
  kind: "success" | "error" = "success"
) {
  const jar = await cookies();
  jar.set(
    FLASH_COOKIE,
    encodeURIComponent(
      JSON.stringify({ m: message, k: kind, t: Date.now() } satisfies FlashPayload)
    ),
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
