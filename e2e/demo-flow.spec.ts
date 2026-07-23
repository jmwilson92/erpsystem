import { test, expect } from "@playwright/test";

/**
 * Public demo end-to-end (DEMO_MODE=0 server, demo_template seeded). One test so
 * the demo cookie/session persists across the whole funnel: start the test
 * drive -> the seeded app loads with the sandbox banner + "Start your own
 * instance" CTA -> switch personas -> browse a module with demo data -> convert
 * CTA -> end the test drive (cleans up the sandbox).
 */
test("demo funnel: start -> switch persona -> browse -> convert -> end", async ({ page }) => {
  test.setTimeout(120_000);

  // Start the test drive
  await page.goto("/demo");
  await page.getByRole("button", { name: /Start your free test drive/i }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 60_000 });

  // Sandbox banner + convert CTA
  await expect(page.getByText(/Test drive/i).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Start your own instance/i })).toBeVisible();

  // Persona switcher (enabled for anonymous demo visitors), scoped to the sandbox
  const select = page.getByLabel("Switch demo user");
  await expect(select).toBeVisible();
  const values = (await select.locator("option").all()).length;
  expect(values).toBeGreaterThan(1);
  const before = await select.inputValue();
  const other = (await Promise.all(
    (await select.locator("option").all()).map((o) => o.getAttribute("value"))
  )).find((v) => v && v !== before)!;
  await select.selectOption(other);
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Switch demo user")).toHaveValue(other);

  // Browse a module with demo data
  await page.goto("/purchasing");
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/unexpected error|Application error|could not be found/i);
  expect(body.length).toBeGreaterThan(50);

  // Convert CTA -> signup
  await page.goto("/");
  await page.getByRole("link", { name: /Start your own instance/i }).click();
  await expect(page).toHaveURL(/\/signup/);

  // End the test drive (cleans up the sandbox schema)
  await page.goto("/");
  await page.getByRole("button", { name: /End test drive/i }).click();
  await page.waitForURL(/\/demo/, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: /Start your free test drive/i })).toBeVisible();
});
