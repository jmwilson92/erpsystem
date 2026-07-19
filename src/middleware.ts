import { NextRequest, NextResponse } from "next/server";

/**
 * Route guard for production (DEMO_MODE=0): anything but the auth
 * screens requires a session cookie. Cookie *presence* is checked here
 * (edge runtime — no DB); the session itself is validated server-side
 * in getCurrentUser / getSessionUser on every request.
 *
 * With DEMO_MODE on (default / evaluation), everything stays open so
 * prospects can use the persona switcher and /demo test-drive.
 *
 * Production hosts must set DEMO_MODE=0 (enforced at boot by
 * src/instrumentation.ts unless ALLOW_DEMO_IN_PRODUCTION=1).
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/invite",
  "/demo",
  "/_next",
  "/favicon",
  "/api/health",
];

/** Pass the current path to server components (root layout) via a header so
 *  the module guard can block disabled-module routes before they render. */
function withPathname(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export function middleware(req: NextRequest) {
  if (process.env.DEMO_MODE !== "0") return withPathname(req);

  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return withPathname(req);
  }
  if (req.cookies.get("forge-session")?.value) {
    return withPathname(req);
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
