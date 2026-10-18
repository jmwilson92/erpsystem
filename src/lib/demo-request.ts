import { cookies } from "next/headers";
import { DEMO_COOKIE } from "@/lib/db";

/**
 * Anonymous demo sandbox. A real login clears the demo cookie, so this is the
 * test-drive visitor — not a paying tenant who happens to share a browser.
 */
export async function isAnonymousDemoRequest(): Promise<boolean> {
  const jar = await cookies();
  return !!jar.get(DEMO_COOKIE)?.value && !jar.get("forge-session")?.value;
}
