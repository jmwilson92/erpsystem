import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Every route in the app, crawled as the demo admin (DEMO_MODE=1): each must
 * render without a server error (<500), without React's error boundary, and
 * without a client-side console error. This is the automated approximation of
 * "open every page and make sure nothing is broken".
 *
 * Static routes use their own path; dynamic routes ([id]/[slug]/[key]) are
 * resolved to real seeded ids. Regenerate the URL list for your seeded DB with:
 *   npx tsx scripts/_dump-ids.ts   (writes e2e/crawl-urls.json)
 * plus the static routes. If the file is absent the suite skips.
 */
const CRAWL_FILE = join(__dirname, "crawl-urls.json");
const crawlUrls: Record<string, string> = existsSync(CRAWL_FILE)
  ? JSON.parse(readFileSync(CRAWL_FILE, "utf8"))
  : {};
const entries = Object.entries(crawlUrls);

test.skip(entries.length === 0, "e2e/crawl-urls.json not generated (see header)");

// Routes that legitimately redirect or are guarded (not a failure).
const ALLOW_REDIRECT = new Set(["/", "/login", "/billing", "/module-off", "/no-access"]);

test.describe("Full route crawl", () => {
  for (const [name, url] of entries) {
    test(`renders: ${name}`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          const t = msg.text();
          // ignore noisy third-party / expected warnings
          if (
            !/favicon|Failed to load resource|manifest|hydrat|Download the React|preload/i.test(t)
          ) {
            consoleErrors.push(t);
          }
        }
      });
      page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      const status = res?.status() ?? 0;
      expect(status, `${url} HTTP status`).toBeLessThan(500);

      await page.waitForTimeout(300);
      const body = await page.locator("body").innerText().catch(() => "");
      expect(body, `${url} error boundary`).not.toMatch(
        /Application error|unexpected error|hit an (unexpected )?error|This page could not be found/i
      );
      if (!ALLOW_REDIRECT.has(name)) {
        expect(body.length, `${url} empty body`).toBeGreaterThan(20);
      }
      expect(consoleErrors, `${url} console errors: ${consoleErrors.join(" | ")}`).toHaveLength(0);
    });
  }
});
