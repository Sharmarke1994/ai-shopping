import { expect, test } from "@playwright/test";

test("runs a direct persisted shopping request and restores it after refresh", async ({
  page,
}) => {
  await page.goto("/live");
  await page
    .getByLabel("What are you looking for?")
    .fill("A light breathable cap for running in hot weather");
  await page.getByRole("button", { name: "Start looking" }).click();

  await expect(
    page.getByRole("heading", { name: "Products found for your brief" }),
  ).toBeVisible();
  await expect(page.getByText("Breathability")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(
    page.getByRole("link", { name: "View on Google Shopping" }).first(),
  ).toHaveAttribute("href", /^https:\/\/example\.test\/products\//);

  const restoredUrl = page.url();
  expect(restoredUrl).toContain("session=");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Products found for your brief" }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);
});

test("runs a deterministic ASK to answer to SEARCH on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/live");
  await page
    .getByLabel("What are you looking for?")
    .fill("A visually light shelving unit for a narrow alcove");
  await page.getByRole("button", { name: "Start looking" }).click();

  await expect(
    page.getByRole("heading", {
      name: "What is the maximum width that will fit?",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Up to 60 cm" }).click();

  await expect(
    page.getByRole("heading", { name: "Products found for your brief" }),
  ).toBeVisible();
  await expect(page.getByText("Maximum width")).toBeVisible();
  await expect(page.getByText("maximum 60 cm")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);
});
