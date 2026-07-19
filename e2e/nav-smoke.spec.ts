import { test, expect } from "@playwright/test";

/**
 * Visit every major module route — page must not 500 / crash.
 * Serial + small delay to avoid crushing a turbopack dev server.
 */

const ROUTES: { path: string; name: string }[] = [
  { path: "/", name: "Command center" },
  { path: "/approvals", name: "Approvals" },
  { path: "/floor", name: "Floor" },
  { path: "/radiators", name: "Radiators" },
  { path: "/value-stream", name: "Value stream" },
  { path: "/ai", name: "AI" },
  { path: "/sales", name: "Sales orders" },
  { path: "/sales/quotes", name: "Quotes" },
  { path: "/sales/new", name: "New SO" },
  { path: "/customers", name: "Customers" },
  { path: "/shipping", name: "Shipping" },
  { path: "/work-orders", name: "Work orders" },
  { path: "/work-instructions", name: "Work instructions" },
  { path: "/workcenters", name: "Workcenters" },
  { path: "/kitting", name: "Kitting" },
  { path: "/planning", name: "Planning" },
  { path: "/planning/forecasts", name: "Forecasts" },
  { path: "/planning/mrs", name: "MRS list" },
  { path: "/budgets", name: "Budgets" },
  { path: "/engineering", name: "Engineering" },
  { path: "/requirements", name: "Requirements" },
  { path: "/items", name: "Items" },
  { path: "/bom", name: "BOMs" },
  { path: "/products", name: "Products" },
  { path: "/cm", name: "CM" },
  { path: "/uom", name: "UOM" },
  { path: "/purchasing", name: "Purchasing" },
  { path: "/purchasing/po", name: "POs" },
  { path: "/purchasing/approvals", name: "PR approvals" },
  { path: "/receiving", name: "Receiving" },
  { path: "/suppliers", name: "Suppliers" },
  { path: "/inventory", name: "Inventory" },
  { path: "/virtual-assets", name: "Virtual assets" },
  { path: "/government-property", name: "Gov property" },
  { path: "/assets", name: "Assets" },
  { path: "/qa", name: "QA" },
  { path: "/test-center", name: "Test center" },
  { path: "/test-procedures", name: "Test procedures" },
  { path: "/quality", name: "Quality" },
  { path: "/mrb", name: "MRB" },
  { path: "/mrb/cars", name: "CARs" },
  { path: "/leadership", name: "Leadership" },
  { path: "/pmo", name: "PMO" },
  { path: "/pmo/projects", name: "Projects" },
  { path: "/pmo/programs", name: "Programs" },
  { path: "/pmo/pi", name: "PI planning" },
  { path: "/pmo/alerts", name: "PMO alerts" },
  { path: "/accounting", name: "Accounting" },
  { path: "/accounting/banking", name: "Banking" },
  { path: "/accounting/payroll", name: "Payroll" },
  { path: "/hr", name: "HR" },
  { path: "/hr/timesheet", name: "Timesheet" },
  { path: "/reports", name: "Reports" },
  { path: "/reports/builder", name: "Report builder" },
  { path: "/email", name: "Email" },
  { path: "/admin/settings", name: "Admin settings" },
  { path: "/admin/permissions", name: "Permissions" },
  { path: "/admin/import", name: "Import" },
  { path: "/setup", name: "Setup wizard" },
  { path: "/account", name: "Account" },
  { path: "/login", name: "Login" },
  { path: "/demo", name: "Demo landing" },
];

// Independent tests so one crash doesn't skip the rest of the suite
test.describe("Module navigation smoke", () => {
  test("health first", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
  });

  for (const route of ROUTES) {
    test(`${route.name} (${route.path}) loads`, async ({ page }) => {
      let res;
      try {
        res = await page.goto(route.path, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
      } catch (e) {
        // Retry once if dev server hiccups
        await page.waitForTimeout(1000);
        res = await page.goto(route.path, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
      }
      const status = res?.status() ?? 0;
      expect(status, `${route.path} status`).toBeLessThan(500);
      await page.waitForTimeout(200);
      const body = await page.locator("body").innerText().catch(() => "");
      expect(body, route.path).not.toMatch(/Application error/i);
      expect(body.length, route.path).toBeGreaterThan(5);
    });
  }
});
