import { NextRequest, NextResponse } from "next/server";

/**
 * Route guard for production (DEMO_MODE=0): anything but the auth
 * screens requires a session cookie. Cookie *presence* is checked here
 * (edge runtime — no DB); the session itself is validated server-side
 * in getCurrentUser on every request.
 *
 * With DEMO_MODE on (default / evaluation), everything stays open.
 */
const PUBLIC_PREFIXES = ["/login", "/invite", "/_next", "/favicon", "/api/health"];

export function middleware(req: NextRequest) {
  if (process.env.DEMO_MODE !== "0") return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  if (req.cookies.get("forge-session")?.value) {
    return NextResponse.next();
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
