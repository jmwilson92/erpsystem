import { test, expect } from "@playwright/test";

/**
 * Public marketing + auth surfaces (run against a DEMO_MODE=0 server with a
 * dummy STRIPE_SECRET_KEY so the signup form renders). Exercises the launch-
 * critical clicks: nav, pricing CTAs, signup validation, legal, onboarding,
 * and the header/footer that must appear on every public page.
 */

test.describe("Landing page", () => {
  test("header + footer + hero CTAs", async ({ page }) => {
    await page.goto("/");
    // Header nav
    await expect(page.getByRole("link", { name: /^ForgeRP/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
    // Hero CTAs
    await expect(page.getByRole("link", { name: /Start your 45-day free trial/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Take the live demo/i }).first()).toBeVisible();
    // Footer present with legal links
    await expect(page.getByRole("link", { name: "Terms" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy" }).first()).toBeVisible();
  });

  test("hero 'Start free trial' navigates to signup", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /Start your 45-day free trial/i }).first().click();
    await expect(page).toHaveURL(/\/signup/);
  });

  test("pricing CTAs pre-select their plan", async ({ page }) => {
    await page.goto("/#pricing");
    // Each paid plan CTA carries ?plan=<key>
    const growth = page.locator('a[href="/signup?plan=growth"]');
    await expect(growth.first()).toBeVisible();
    await expect(page.locator('a[href="/signup?plan=starter"]').first()).toBeVisible();
    await expect(page.locator('a[href="/signup?plan=business"]').first()).toBeVisible();
    // Most popular badge appears once (on Growth)
    await expect(page.getByText("Most popular", { exact: false })).toHaveCount(1);
  });

  test("logo returns home from a deep page", async ({ page }) => {
    await page.goto("/legal/terms-of-service");
    await page.getByRole("link", { name: /ForgeRP home|^ForgeRP/ }).first().click();
    await expect(page).toHaveURL(/\/$|\/#/);
  });
});

test.describe("Signup", () => {
  test("plan pre-selected from query", async ({ page }) => {
    await page.goto("/signup?plan=growth");
    await expect(page.locator('input[name="plan"][value="GROWTH"]')).toBeChecked();
  });

  test("invalid email is rejected", async ({ page }) => {
    await page.goto("/signup?plan=starter");
    await page.fill('input[name="email"]', "not-an-email");
    // bypass native validation to hit the server check
    await page.locator('input[name="email"]').evaluate((el: HTMLInputElement) => (el.type = "text"));
    await page.getByRole("button", { name: /Continue to secure checkout/i }).click();
    await expect(page).toHaveURL(/error=email/);
  });

  test("valid submit reaches checkout attempt (graceful with dummy Stripe)", async ({ page }) => {
    await page.goto("/signup?plan=starter");
    await page.fill('input[name="email"]', "tester@example.com");
    await page.fill('input[name="company"]', "Test Co");
    await page.getByRole("button", { name: /Continue to secure checkout/i }).click();
    // dummy key → Stripe API rejects → graceful redirect back with error=stripe
    await expect(page).toHaveURL(/error=stripe|checkout\.stripe\.com/);
  });
});

test.describe("Legal", () => {
  test("index lists docs with header/footer", async ({ page }) => {
    await page.goto("/legal");
    await expect(page.getByRole("link", { name: /Terms of Service/i }).first()).toBeVisible();
    await expect(page.getByText(/Refund Policy/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy", exact: true }).first()).toBeVisible(); // footer
  });

  test("terms shows real entity + 45-day trial, no template disclaimer", async ({ page }) => {
    await page.goto("/legal/terms-of-service");
    const body = await page.locator("body").innerText();
    expect(body).toMatch(/ForgeRP, LLC/);
    expect(body).toMatch(/California/);
    expect(body).toMatch(/45 days/);
    expect(body).not.toMatch(/template and not legal advice|have counsel review/i);
  });
});

test.describe("Auth + onboarding pages", () => {
  test("login renders", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test("onboard with bad token shows invalid message", async ({ page }) => {
    await page.goto("/onboard/deadbeefdeadbeef");
    await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
  });

  test("demo splash renders with CTA + header/footer", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.getByRole("button", { name: /Start your free test drive/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "Terms" }).first()).toBeVisible(); // footer
  });
});
