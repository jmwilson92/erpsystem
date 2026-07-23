import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Real customer tenant lifecycle (DEMO_MODE=0). Provision a tenant fixture with:
 *   npx tsx scripts/_provision-fixture.ts   (writes e2e/tenant-fixture.json)
 * then this claims it in the browser and proves the customer can get in and
 * stay isolated:
 *   onboard/<token> -> set password -> lands in the guided setup wizard
 *   trial banner shows the chosen plan (not "pick a plan")
 *   /admin/tenants is refused for a tenant admin (dogfood-only)
 *   log out, log back in by email -> routed to their own tenant
 */
const FIXTURE = join(__dirname, "tenant-fixture.json");
const fixture: { email?: string; token?: string } = existsSync(FIXTURE)
  ? JSON.parse(readFileSync(FIXTURE, "utf8"))
  : {};
const { email = "", token = "" } = fixture;
const PASSWORD = "Tenant1234!";

test.skip(!email || !token, "e2e/tenant-fixture.json not generated (see header)");

test("customer claims workspace and logs into their own tenant", async ({ page }) => {
  test.setTimeout(90_000);

  // 1) Claim the workspace
  await page.goto(`/onboard/${token}`);
  await expect(page.getByText(email)).toBeVisible();
  await page.fill('input[name="password"]', PASSWORD);
  await page.getByRole("button", { name: /Set password & enter ForgeRP/i }).click();
  // Lands in the guided setup wizard
  await page.waitForURL(/\/setup/, { timeout: 30_000 });
  await expect(page.getByText(/Set up ForgeRP|company/i).first()).toBeVisible();

  // 2) Trial banner reflects the chosen plan, not "pick a plan"
  const bannerText = await page.locator("body").innerText();
  expect(bannerText).toMatch(/days left in your trial/i);
  expect(bannerText).toMatch(/Growth plan/i);
  expect(bannerText).not.toMatch(/Pick a plan any time/i);

  // 3) Tenant admin cannot reach the platform registry (dogfood-only)
  await page.goto("/admin/tenants");
  await expect(page).not.toHaveURL(/\/admin\/tenants$/); // redirected away

  // 4) Log out, then log back in by email -> routed back to this tenant
  await page.locator('[data-tour="account-menu"] button').first().click();
  await page.getByRole("button", { name: /Sign out/i }).click();
  await page.waitForURL(/\/login/, { timeout: 30_000 });

  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  // Back in the app as the tenant admin (account menu present)
  await expect(page.locator('[data-tour="account-menu"]')).toBeVisible();
});
