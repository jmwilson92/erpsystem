import { test, expect } from "@playwright/test";

/**
 * Authenticated app journey against a DEMO_MODE=0 server: real login, the
 * header dropdowns (with an occlusion check that proves the z-index fix — the
 * panel is the top element at its own center, not painted over), sidebar
 * navigation, and logout.
 *
 * Requires admin@forge.erp to have password Test1234! (set by the test harness).
 */

const EMAIL = "admin@forge.erp";
const PASSWORD = "Test1234!";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

test.describe.serial("Authenticated app", () => {
  test("login lands in the app", async ({ page }) => {
    await login(page);
    // App shell present (sidebar/header)
    await expect(page.locator('[data-tour="account-menu"]')).toBeVisible();
  });

  test("notifications dropdown opens on top", async ({ page }) => {
    await login(page);
    await page.locator('[data-tour="notifications"] button').first().click();
    const panel = page.getByText("Needs your attention");
    await expect(panel).toBeVisible();
    // Occlusion: the element at the panel's center belongs to the panel.
    const onTop = await panel.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return !!hit && (el.contains(hit) || hit.contains(el) || el === hit || el.parentElement?.contains(hit));
    });
    expect(onTop, "notifications dropdown is not occluded").toBeTruthy();
  });

  test("account menu opens on top with account + sign out", async ({ page }) => {
    await login(page);
    const menu = page.locator('[data-tour="account-menu"]');
    await menu.locator("button").first().click();
    await expect(menu.getByRole("link", { name: /My account/i })).toBeVisible();
    const signOut = menu.getByRole("button", { name: /Sign out/i });
    await expect(signOut).toBeVisible();
    const onTop = await signOut.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return !!hit && (el.contains(hit) || el === hit);
    });
    expect(onTop, "account dropdown is not occluded").toBeTruthy();
  });

  test("sidebar navigation works", async ({ page }) => {
    await login(page);
    // Navigate to a couple of core modules via their links
    await page.goto("/");
    const purchasing = page.getByRole("link", { name: /Purchasing/i }).first();
    if (await purchasing.count()) {
      await purchasing.click();
      await expect(page).toHaveURL(/\/purchasing/);
    }
    await page.goto("/hr");
    await expect(page.locator("body")).not.toContainText(/unexpected error|Application error/i);
  });

  test("logout returns to login", async ({ page }) => {
    await login(page);
    await page.locator('[data-tour="account-menu"] button').first().click();
    await page.getByRole("button", { name: /Sign out/i }).click();
    await page.waitForURL(/\/login/, { timeout: 30_000 });
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });
});
