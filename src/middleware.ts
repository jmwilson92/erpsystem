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
  "/signup",
  "/invite",
  "/onboard",
  "/demo",
  "/legal",
  "/welcome",
  // Local / staging marketing mocks (splash, tenant URL concepts)
  "/preview",
  "/marketing-preview",
  "/api/demo", // includes /api/demo/end, /api/demo/reset
  // Guest support chat thread (secret token in path)
  "/support/t",
  "/_next",
  "/favicon",
  "/api/health",
  "/api/stripe", // Stripe webhooks are signature-verified, not cookie-authed
  // Vercel Cron calls this with no session cookie; it authenticates itself with
  // CRON_SECRET. Without this the scheduled demo sweep / pool refill just gets
  // redirected to /login and silently never runs.
  "/api/cron",
  // SEO / social previews must stay crawlable without a session
  "/robots.txt",
  "/sitemap.xml",
  // The browser fetches the manifest while deciding whether the site is
  // installable, before any session exists. Redirecting it to /login makes the
  // "Install app" option quietly never appear.
  "/manifest.webmanifest",
  "/icons",
  "/opengraph-image",
  "/twitter-image",
  "/icon",
  "/apple-icon",
];

/** The public marketing home is an exact match (can't prefix-match "/"). */
function isPublicPath(pathname: string) {
  return pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/** Pass the current path to server components (root layout) via a header so
 *  the module guard can block disabled-module routes before they render. */
function withPathname(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  // Apex splash for anonymous visitors only (not password sessions).
  // ?app=1 = post-splash ERP entry for a live demo cookie.
  const isApex = req.nextUrl.pathname === "/";
  const enterApp = req.nextUrl.searchParams.get("app") === "1";
  const hasSession = !!req.cookies.get("forge-session")?.value;
  if (isApex && enterApp) {
    headers.set("x-forge-app", "1");
  } else if (isApex && !enterApp && !hasSession) {
    headers.set("x-forge-splash", "1");
  }
  return NextResponse.next({ request: { headers } });
}

export function middleware(req: NextRequest) {
  if (process.env.DEMO_MODE !== "0") return withPathname(req);

  const { pathname } = req.nextUrl;
  // Never block Next.js server-action POSTs — a middleware redirect/HTML
  // response surfaces as "unexpected response was received from the server".
  if (req.headers.has("next-action") || req.headers.has("Next-Action")) {
    return withPathname(req);
  }
  if (isPublicPath(pathname)) {
    return withPathname(req);
  }
  // A real session, or an anonymous demo visitor with a demo schema cookie,
  // may proceed. (Identity is still resolved + validated server-side.)
  if (
    req.cookies.get("forge-session")?.value ||
    req.cookies.get("forge-demo")?.value
  ) {
    return withPathname(req);
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip static assets (incl. marketing-preview HTML/CSS under public/)
  matcher: [
    "/((?!_next/static|_next/image|marketing-preview/|.*\\.(?:png|jpg|jpeg|svg|ico|css|html|webp|gif|mp4|webm)$).*)",
  ],
};
