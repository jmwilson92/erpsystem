import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

/**
 * Web app manifest — what makes "Install app" appear in Chrome/Edge and turns
 * the site into a real desktop window with its own icon and taskbar entry.
 *
 * Served at /manifest.webmanifest, which has to be reachable without a session:
 * the browser fetches it while deciding whether the site is installable, and a
 * redirect to /login would silently make the install option disappear. See the
 * "/manifest" entry in middleware's PUBLIC_PREFIXES.
 *
 * Static because none of it varies per request — a tenant's own branding is not
 * used here, since an installed icon is chosen once and shared by every profile
 * on the machine.
 */
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — ${SITE_TAGLINE}`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    // Land straight in the app. With a session `/` resolves to the ERP shell;
    // without one it resolves to login, which is the correct place to start.
    start_url: "/",
    // Everything is same-origin, so the whole site stays inside the app window.
    // A narrower scope would kick ordinary navigation back out to the browser.
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#020617",
    theme_color: "#020617",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // Separate maskable asset: platforms that crop to a circle would clip the
      // flame off the full-bleed version, so this one is padded into the safe zone.
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
