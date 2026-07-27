import { test, expect } from "@playwright/test";

/**
 * Public demo end-to-end (DEMO_MODE=0 server, demo_template seeded). One test so
 * the demo cookie/session persists across the whole funnel.
 *
 * Flow shape (current):
 *   /demo splash -> "Start your free test drive" (server action provisions a
 *   throwaway schema) -> redirects to `/?app=1` (apex + app flag, since bare "/"
 *   shows the marketing splash) -> sandbox banner with a convert CTA and an
 *   "End test drive" link to GET /api/demo/end (full navigation, so the ERP
 *   shell is never left half-mounted).
 */
test("demo funnel: start -> switch persona -> browse -> convert -> end", async ({ page }) => {
  test.setTimeout(180_000);

  // Start the test drive
  await page.goto("/demo");
  await page.getByRole("button", { name: /Start your free test drive/i }).click();
  await page.waitForURL((u) => u.pathname === "/" && u.searchParams.get("app") === "1", {
    timeout: 120_000,
  });

  // Sandbox banner + convert CTA
  await expect(page.getByText(/Test drive/i).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Start your own instance/i })).toBeVisible();

  // Persona switcher (enabled for anonymous demo visitors), scoped to the sandbox
  const select = page.getByLabel("Switch demo user");
  await expect(select).toBeVisible();
  const options = await select.locator("option").all();
  expect(options.length).toBeGreaterThan(1);
  const before = await select.inputValue();
  const other = (
    await Promise.all(options.map((o) => o.getAttribute("value")))
  ).find((v) => v && v !== before)!;
  await select.selectOption(other);
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Switch demo user")).toHaveValue(other);

  // Browse a module with demo data
  await page.goto("/purchasing");
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/unexpected error|Application error|could not be found/i);
  expect(body.length).toBeGreaterThan(50);

  // Convert CTA -> signup
  await page.getByRole("link", { name: /Start your own instance/i }).click();
  await expect(page).toHaveURL(/\/signup/);

  // End the test drive (GET /api/demo/end clears cookies + drops the schema)
  await page.goto("/?app=1");
  await page.getByRole("link", { name: /End test drive/i }).click();
  await page.waitForURL(/\/welcome|\/demo|\/$/, { timeout: 60_000 });
  // Sandbox is gone: the app flag no longer yields a demo session.
  await page.goto("/purchasing");
  await expect(page).toHaveURL(/\/login/);
});
