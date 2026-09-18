import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

for (const sample of [
  { name: "Warehouse entrance", type: "warehouse", width: 1440 },
  { name: "Upstairs hallway", type: "hallway", width: 390 },
]) {
  test(`named ${sample.type} remains a space throughout creation and design`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: sample.width, height: 950 });
    await page.goto("/spaces");
    await page.getByLabel("Space name").fill(sample.name);
    await page.getByLabel("Space type").selectOption(sample.type);
    await page.getByRole("button", { name: "+ Add a space" }).click();
    await page.waitForURL(/\/spaces\/[a-f0-9-]+$/);
    await expect(
      page.getByRole("heading", { name: sample.name, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: `${sample.name}, from a few angles` }),
    ).toBeVisible();
    const path = new URL(page.url()).pathname;
    await page.reload();
    await expect(
      page.getByRole("heading", { name: sample.name, exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Explore a space design →" }).click();
    await expect(
      page.getByRole("heading", { name: /See what works in your space/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: `← ${sample.name}` }),
    ).toBeVisible();
    await expect(page.getByText("Your room", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Save this design" }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await mkdir("docs/screenshots/v0-10-space-types", { recursive: true });
    await page.screenshot({
      path: `docs/screenshots/v0-10-space-types/${sample.type}-${sample.width}.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: `← ${sample.name}` }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  });
}
