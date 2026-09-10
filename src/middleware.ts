import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/invite",
  "/onboard",
  "/demo",
  "/legal",
  "/welcome",
  "/preview",
  "/marketing-preview",
  "/api/demo",
  "/api/leads",
  "/support/t",
  "/_next",
  "/favicon",
  "/api/health",
  "/api/stripe",
  "/api/cron",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
  "/icons",
  "/opengraph-image",
  "/twitter-image",
  "/icon",
  "/apple-icon",
];

function isPublicPath(pathname: string) {
  return pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function withPathname(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  const isApex = req.nextUrl.pathname === "/";
  const enterApp = req.nextUrl.searchParams.get("app") === "1";
  const hasSession = !!req.cookies.get("forge-session")?.value;
  const hasDemo = !!req.cookies.get("forge-demo")?.value;
  if (isApex && (enterApp || hasSession || hasDemo)) {
    headers.set("x-forge-app", "1");
  } else if (isApex && !enterApp && !hasSession && !hasDemo) {
    headers.set("x-forge-splash", "1");
  }
  return NextResponse.next({ request: { headers } });
}

export function middleware(req: NextRequest) {
  if (process.env.DEMO_MODE !== "0") return withPathname(req);

  const { pathname } = req.nextUrl;
  if (req.headers.has("next-action") || req.headers.has("Next-Action")) {
    return withPathname(req);
  }
  if (isPublicPath(pathname)) {
    return withPathname(req);
  }
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
  matcher: [
    "/((?!_next/static|_next/image|marketing-preview/|.*\\.(?:png|jpg|jpeg|svg|ico|css|html|webp|gif|mp4|webm)$).*)",
  ],
};
