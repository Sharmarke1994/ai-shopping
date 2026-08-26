import { expect, test } from "@playwright/test";

test("shops recursively, saves an option, and restores the same task", async ({
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
    page.getByRole("link", { name: "View at Fixture Outfitters" }).first(),
  ).toHaveAttribute("href", /^https:\/\/example\.test\/products\//);

  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(
    page.getByRole("heading", {
      name: "Keep interesting options while you refine",
    }),
  ).toBeVisible();
  await page
    .getByLabel("Refine what you’re looking for")
    .fill("Make waterproofing important too");
  await page.getByRole("button", { name: "Update and search again" }).click();
  await expect(
    page.getByText("Water resistance", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Strong preference: Water resistance: yes", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(3);

  const restoredUrl = page.url();
  expect(restoredUrl).toContain("session=");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Products found for your brief" }),
  ).toBeVisible();
  await expect(
    page.getByText("Water resistance", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(3);
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
