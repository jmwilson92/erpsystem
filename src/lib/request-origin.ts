/**
 * Build an absolute public origin for redirects.
 * Codespaces / reverse proxies often present Host as localhost:3000 while the
 * browser is on https://{name}-3000.app.github.dev — using request.url.origin
 * then produces broken URLs like *.app.github.dev:3000 (404).
 */
export function publicOriginFromRequest(req: Request): string {
  const xfHost = req.headers.get("x-forwarded-host");
  const xfProto = req.headers.get("x-forwarded-proto");
  const hostHeader = req.headers.get("host");

  let host = (xfHost || hostHeader || "").split(",")[0]?.trim() || "";
  let proto = (xfProto || "").split(",")[0]?.trim() || "";

  // Prefer parsing the request URL when headers are missing.
  try {
    const u = new URL(req.url);
    if (!host) host = u.host;
    if (!proto) proto = u.protocol.replace(":", "");
  } catch {
    /* ignore */
  }

  // *.app.github.dev already encodes the forwarded port in the hostname.
  // Never keep :3000 (or any port) on that host.
  if (/\.app\.github\.dev(?::\d+)?$/i.test(host)) {
    host = host.replace(/:\d+$/, "");
    proto = "https";
  }

  // Local dev
  if (!proto) {
    proto = host.includes("localhost") || host.startsWith("127.") ? "http" : "https";
  }

  if (!host) {
    return "http://localhost:3000";
  }

  return `${proto}://${host}`;
}

export function publicUrlFromRequest(req: Request, pathAndQuery: string): string {
  const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  return `${publicOriginFromRequest(req)}${path}`;
}
