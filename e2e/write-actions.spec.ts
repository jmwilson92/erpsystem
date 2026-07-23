import { test, expect } from "@playwright/test";

/**
 * A real data-writing action end-to-end (DEMO_MODE=0, authed as admin): create
 * a customer via the form's submit button and confirm it persists and shows in
 * the list. Proves the create → server action → DB → list-render loop, not just
 * that pages render.
 */
const EMAIL = "admin@forge.erp";
const PASSWORD = "Test1234!";

test("create a customer and see it in the list", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/login");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });

  const uniqueName = `E2E Customer ${Date.now()}`;
  await page.goto("/customers/new");
  await page.fill('input[name="name"]', uniqueName);
  await page.fill('input[name="contactEmail"]', "buyer@e2e-customer.com");
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/customers/new"), { timeout: 30_000 }),
    page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit()),
  ]);

  // The new name must show in the customers list.
  await page.goto("/customers");
  await expect(page.getByText(uniqueName).first()).toBeVisible();
});
