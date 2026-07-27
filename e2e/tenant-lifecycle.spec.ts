import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Real customer tenant lifecycle (DEMO_MODE=0). Provision a tenant fixture with:
 *   npx tsx scripts/e2e-provision-fixture.ts   (writes e2e/tenant-fixture.json)
 *
 * The fixture is SINGLE USE — claiming consumes the onboarding token (that is
 * the product behaviour), so re-run the provision script before each run of
 * this spec or the claim step reports "invalid or has expired".
 *
 * It claims the tenant in the browser and proves the customer can get in and
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

  // 3a) The staff portal must be invisible to a tenant admin — nav links absent
  await expect(page.getByRole("link", { name: /Support desk/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Product insights/i })).toHaveCount(0);
  // ...and the pages themselves stay guarded
  await page.goto("/admin/insights");
  await expect(page).not.toHaveURL(/\/admin\/insights$/);
  await page.goto("/admin/support");
  await expect(page).not.toHaveURL(/\/admin\/support$/);

  // 3) Tenant admin cannot reach the platform registry (dogfood-only)
  await page.goto("/admin/tenants");
  await expect(page).not.toHaveURL(/\/admin\/tenants$/); // redirected away

  // 4) Log out, then log back in by email -> routed back to this tenant.
  //    Signing out lands on the public marketing site (by design), so navigate
  //    to /login explicitly rather than expecting a redirect there.
  const menu = page.locator('[data-tour="account-menu"]');
  await menu.locator("button").first().click();
  await menu.getByRole("button", { name: /Sign out/i }).click();
  await page.waitForURL(/\/welcome|\/$/, { timeout: 30_000 });

  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  // Back in the app as the tenant admin (account menu present)
  await expect(page.locator('[data-tour="account-menu"]')).toBeVisible();
});
