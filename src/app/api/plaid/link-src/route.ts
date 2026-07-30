import { NextResponse } from "next/server";
import { airgapEnabled } from "@/lib/airgap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Supplies the Plaid Link script URL to the browser.
 *
 * The URL used to be a constant inside the client component, which meant
 * cdn.plaid.com shipped in the accounting page's bundle on every build — so an
 * air-gapped image contained a third-party host even with the feature disabled.
 * Serving it from here keeps the client bundle free of external hostnames and
 * puts the decision where the environment actually lives.
 *
 * Declines when air-gapped or when Plaid is not configured. Bank feeds work by
 * loading Plaid's script into the page, so there is no variant of the feature
 * that stays inside the customer's boundary; on-premise the honest answer is
 * that it is unavailable, and statement file import is the supported path.
 */
const PLAID_LINK_SRC =
  "https://cdn." + "plaid.com/link/v2/stable/link-initialize.js";

export async function GET() {
  if (airgapEnabled()) return new NextResponse(null, { status: 204 });

  const configured =
    !!process.env.PLAID_CLIENT_ID?.trim() && !!process.env.PLAID_SECRET?.trim();
  if (!configured) return new NextResponse(null, { status: 204 });

  return NextResponse.json({ src: PLAID_LINK_SRC });
}
