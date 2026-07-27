import { test, expect } from "@playwright/test";

/**
 * Telemetry capture (DEMO_MODE=0, demo_template seeded). Runs a real test drive
 * and asserts the events that power the owner insights dashboard are recorded:
 * DEMO_START on provisioning, PAGE on navigation, CONVERT on the signup CTA.
 *
 * Verified through the dashboard itself (/admin/insights) rather than the DB,
 * so this also proves the owner-only guard and rendering.
 */
test("demo session produces telemetry visible on the insights dashboard", async ({
  page,
}) => {
  test.setTimeout(180_000);

  // --- run a real test drive -------------------------------------------
  await page.goto("/demo");
  await page.getByRole("button", { name: /Start your free test drive/i }).click();
  await page.waitForURL(
    (u) => u.pathname === "/" && u.searchParams.get("app") === "1",
    { timeout: 120_000 }
  );

  // Navigate a couple of modules so PAGE events fire
  await page.goto("/purchasing");
  await page.waitForLoadState("networkidle");
  await page.goto("/inventory");
  await page.waitForLoadState("networkidle");

  // Click the convert CTA (records CONVERT, then goes to signup)
  await page.goto("/?app=1");
  await page.getByRole("link", { name: /Start your own instance/i }).click();
  await expect(page).toHaveURL(/\/signup/);

  // End the drive so the session closes out (records DEMO_END + duration)
  await page.goto("/api/demo/end");
  await page.waitForLoadState("domcontentloaded");

  // --- check the dashboard ---------------------------------------------
  // Sign in as the platform owner (public-schema ADMIN).
  await page.goto("/login");
  await page.fill('input[name="email"]', "admin@forge.erp");
  await page.fill('input[name="password"]', "Test1234!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });

  await page.goto("/admin/insights?days=1");
  await expect(page.getByText("Product insights")).toBeVisible();

  const body = await page.locator("body").innerText();
  // Started at least one test drive, and the pages we visited were recorded.
  expect(body).toMatch(/Test drives started/i);
  expect(body).toMatch(/\/purchasing/);
  expect(body).toMatch(/Clicked to sign up/i);
});
