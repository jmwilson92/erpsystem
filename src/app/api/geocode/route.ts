import { NextRequest, NextResponse } from "next/server";
import { geocodingEnabled } from "@/lib/airgap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-side proxy for address type-ahead.
 *
 * The browser used to call photon.komoot.io directly, which meant every
 * keystroke of a customer address went to a third party from the user's own
 * machine. Proxying moves that decision server-side, which buys two things:
 *
 *  - Air-gapped mode can actually enforce it. A client bundle cached before the
 *    switch was flipped would still have called out; an endpoint that refuses
 *    cannot be worked around.
 *  - Even hosted, customer addresses now leave from our server rather than from
 *    every user's browser, so the lookup is not attributable to them.
 *
 * This route requires a session (it is not in middleware's PUBLIC_PREFIXES), so
 * it is not an open geocoding relay.
 */
export async function GET(req: NextRequest) {
  // 204, not an error: the caller is a type-ahead. On-premise it should quietly
  // stop suggesting rather than surface a failure on every keystroke.
  if (!geocodingEnabled()) {
    return new NextResponse(null, { status: 204 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 4 || q.length > 200) {
    return NextResponse.json({ features: [] });
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 5000);
  try {
    const upstream = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=en`,
      { signal: ctrl.signal, headers: { Accept: "application/json" } }
    );
    if (!upstream.ok) return NextResponse.json({ features: [] });
    const data = await upstream.json();
    return NextResponse.json(data, {
      // Repeated keystrokes over the same prefix are common; a short cache keeps
      // the upstream call count down without holding stale addresses for long.
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch {
    // Offline, blocked, or slow upstream — the field stays a plain textarea.
    return NextResponse.json({ features: [] });
  } finally {
    clearTimeout(timeout);
  }
}
