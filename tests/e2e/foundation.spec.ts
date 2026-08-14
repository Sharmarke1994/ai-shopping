import { expect, test } from "@playwright/test";

test("serves the application foundation", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "A better way to decide what to buy.",
    }),
  ).toBeVisible();
  await expect(page).toHaveTitle("AI Shopping");
});
