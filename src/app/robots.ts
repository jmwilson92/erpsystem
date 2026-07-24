import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site";

/**
 * Tell crawlers what is public marketing vs. the authenticated product.
 * Auth walls already block app routes; disallow keeps crawl budget on pages
 * that convert (landing, demo, signup, legal).
 */
export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/demo", "/signup", "/login", "/legal", "/legal/"],
        disallow: [
          "/api/",
          "/admin/",
          "/billing",
          "/account",
          "/invite/",
          "/onboard/",
          "/setup",
          "/approvals",
          "/work-orders",
          "/work-instructions",
          "/purchasing",
          "/receiving",
          "/inventory",
          "/quality",
          "/mrb",
          "/hr/",
          "/accounting",
          "/pmo/",
          "/engineering",
          "/sales",
          "/customers",
          "/suppliers",
          "/shipping",
          "/floor",
          "/planning",
          "/ai",
          "/email",
          "/reports",
          "/print/",
          "/module-off",
          "/no-access",
          "/radiators",
          "/test-center",
          "/test-procedures",
          "/trace",
          "/kitting",
          "/assets",
          "/virtual-assets",
          "/government-property",
          "/cm",
          "/bom",
          "/items",
          "/parts",
          "/products",
          "/projects",
          "/budgets",
          "/recruiting",
          "/requirements",
          "/value-stream",
          "/leadership",
          "/guides",
          "/qa",
          "/uom",
          "/workcenters",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
