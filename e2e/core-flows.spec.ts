import { test, expect } from "@playwright/test";

/**
 * Interactive checks in demo mode — list pages + drill into first records.
 */

test.describe("Core interactive flows (demo mode)", () => {
  test("health API is healthy", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok(), await res.text()).toBeTruthy();
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.db).toBe("up");
  });

  test("command center renders shell", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("aside, nav, main").first()).toBeVisible();
  });

  test("sales list loads", async ({ page }) => {
    await page.goto("/sales", { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText();
    expect(body.length).toBeGreaterThan(30);
    expect(body).not.toMatch(/Application error/i);
  });

  test("open first sales order if listed", async ({ page }) => {
    await page.goto("/sales", { waitUntil: "networkidle" });
    // Prefer deep links with cuid-like ids, not /sales itself or /sales/new
    const hrefs = await page.locator('a[href^="/sales/"]').evaluateAll((as) =>
      as
        .map((a) => (a as HTMLAnchorElement).getAttribute("href") || "")
        .filter(
          (h) =>
            h.startsWith("/sales/") &&
            !h.includes("new") &&
            !h.includes("quotes") &&
            h.length > "/sales/".length + 5
        )
    );
    if (!hrefs.length) {
      test.skip(true, "No sales order detail links in seed UI");
      return;
    }
    await page.goto(hrefs[0], { waitUntil: "networkidle" });
    expect(page.url()).toMatch(/\/sales\/.+/);
    expect(await page.locator("body").innerText()).not.toMatch(/Application error/i);
  });

  test("work orders list loads", async ({ page }) => {
    await page.goto("/work-orders", { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText();
    expect(body.length).toBeGreaterThan(30);
    expect(body).not.toMatch(/Application error/i);
  });

  test("purchasing, receiving, shipping load", async ({ page }) => {
    for (const path of ["/purchasing", "/receiving", "/shipping"]) {
      await page.goto(path, { waitUntil: "networkidle" });
      const body = await page.locator("body").innerText();
      expect(body.length, path).toBeGreaterThan(20);
      expect(body, path).not.toMatch(/Application error/i);
    }
  });

  test("BOM, CM, planning, timesheet, accounting load", async ({ page }) => {
    for (const path of [
      "/bom",
      "/cm",
      "/planning",
      "/hr/timesheet",
      "/accounting",
      "/pmo/projects",
      "/budgets",
    ]) {
      await page.goto(path, { waitUntil: "networkidle" });
      const body = await page.locator("body").innerText();
      expect(body.length, path).toBeGreaterThan(20);
      expect(body, path).not.toMatch(/Application error/i);
    }
  });

  test("PMO project budgets tab if project exists", async ({ page }) => {
    await page.goto("/pmo/projects", { waitUntil: "networkidle" });
    // Prefer real project detail links — never /pmo/projects/new
    const hrefs = await page.locator('a[href*="/pmo/projects/"]').evaluateAll((as) =>
      as
        .map((a) => (a as HTMLAnchorElement).getAttribute("href") || "")
        .filter(
          (h) =>
            h.includes("/pmo/projects/") &&
            !h.endsWith("/new") &&
            !h.includes("/new?") &&
            h.length > "/pmo/projects/".length + 4
        )
    );
    if (!hrefs.length) {
      test.skip(true, "No project detail links");
      return;
    }
    // Navigate to budgets tab via query (soft tab links can be flaky under SPA)
    const base = hrefs[0].split("?")[0];
    await page.goto(`${base}?tab=budgets`, { waitUntil: "networkidle" });
    expect(page.url()).toMatch(/tab=budgets/);
    const body = await page.locator("body").innerText();
    expect(body).toMatch(/charge|WBS|budget|Generate|production|contract/i);
  });

  test("search API responds in demo", async ({ request }) => {
    const res = await request.get("/api/search?q=WO");
    expect([200, 401]).toContain(res.status());
  });

  test("forms reachable", async ({ page }) => {
    for (const path of ["/customers/new", "/sales/new"]) {
      await page.goto(path, { waitUntil: "networkidle" });
      expect(await page.locator("body").innerText()).not.toMatch(
        /Application error/i
      );
    }
  });

  test("demo persona switcher when demo mode on", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const demo = page.getByText(/Demo Mode/i);
    // Soft assert — production overlay would hide it
    if (await demo.count()) {
      await expect(demo.first()).toBeVisible();
    }
  });
});
