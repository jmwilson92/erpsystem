/**
 * Public site identity + SEO defaults for ForgeRP marketing surfaces.
 * Prefer APP_URL / NEXT_PUBLIC_APP_URL in production so absolute OG/sitemap
 * URLs match the live domain (www.forge-rp.live).
 */

export const SITE_NAME = "ForgeRP";
export const SITE_LEGAL = "ForgeRP, LLC";
export const SITE_TAGLINE = "Manufacturing ERP for shops that build real hardware";

export const SITE_DESCRIPTION =
  "ForgeRP is plug-and-play manufacturing ERP: sales, engineering, purchasing, production, quality, and accounting in one connected system. 45-day free trial — no consultants required.";

/** Primary phrase we want to rank for + supporting terms. */
export const SITE_KEYWORDS = [
  "manufacturing ERP",
  "manufacturing ERP software",
  "shop floor ERP",
  "aerospace ERP",
  "defense manufacturing software",
  "AS9100 quality system",
  "MRB software",
  "work order software",
  "manufacturing inventory management",
  "configuration management ERP",
  "government property tracking",
  "small manufacturer ERP",
  "ForgeRP",
];

export function getSiteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    "https://www.forge-rp.live";
  return raw.replace(/\/$/, "");
}

export const SITE_CONTACT = {
  legal: "legal@forge-rp.live",
  privacy: "privacy@forge-rp.live",
};
