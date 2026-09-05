import { expect, test } from "@playwright/test";

test("automatically investigates, supports exact rejection, comparison, refinement and refresh", async ({
  page,
}) => {
  await page.goto("/live");
  await page
    .getByLabel("What are you looking for?")
    .fill("A light breathable cap for running in hot weather");
  await page.getByRole("button", { name: "Start looking" }).click();

  await expect(
    page.getByRole("heading", {
      name: "Why these options earned a closer look",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Current decision", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("complementary", { name: "What matters for this search" })
      .getByText("Breathability", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View at Fixture Outfitters" }).first(),
  ).toHaveAttribute("href", /^https:\/\/example\.test\/products\//);

  const decisionRegion = page.getByRole("region", {
    name: "Why these options earned a closer look",
  });
  await decisionRegion
    .getByRole("button", { name: "Save", exact: true })
    .first()
    .click();
  await expect(
    decisionRegion.getByRole("button", { name: "Saved ✓" }),
  ).toHaveCount(1);
  await decisionRegion
    .getByRole("button", { name: "Save", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "What separates your saved options" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove from saved" }),
  ).toHaveCount(2);
  await expect(page.getByText("Important unknowns")).toBeVisible();
  await expect(page.getByText("Price / purchase")).toBeVisible();

  await decisionRegion
    .getByRole("button", { name: "Not for me" })
    .first()
    .click();
  const rejected = page.locator("details").filter({ hasText: /^Rejected/ });
  await expect(rejected).toBeVisible();
  await rejected.locator("summary").click();
  await expect(
    rejected.getByText(/does not teach Consider a new preference/i),
  ).toBeVisible();
  await rejected.getByRole("button", { name: "Undo" }).click();
  await expect(rejected).toHaveCount(0);
  await expect(
    decisionRegion.getByRole("button", { name: "Saved ✓" }),
  ).toHaveCount(1);

  await decisionRegion
    .getByRole("button", { name: "Save", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "What separates your saved options" }),
  ).toBeVisible();

  await page
    .getByLabel("Refine what you’re looking for")
    .fill("Make waterproofing important too");
  await page.getByRole("button", { name: "Update my priorities" }).click();
  await expect(
    page
      .getByRole("complementary", { name: "What matters for this search" })
      .getByText("Water resistance", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Strong preference: Water resistance: yes", { exact: true }),
  ).toBeVisible();
  const evolution = page.getByRole("region", {
    name: "What changed",
    exact: true,
  });
  await expect(evolution).toBeVisible();
  await expect(evolution).toContainText("Water resistance");
  await evolution.getByText("See the change in context").click();
  await expect(evolution).toContainText(
    "Your other priorities stayed the same",
  );
  const comparison = page.getByRole("region", {
    name: "What separates your saved options",
  });
  await comparison
    .getByText("See the full criterion-by-criterion evidence")
    .click();
  await expect(comparison.getByRole("table")).toContainText("Water resistance");

  const restoredUrl = page.url();
  expect(restoredUrl).toContain("session=");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "What changed", exact: true }),
  ).toContainText("Water resistance");
  await expect(
    page
      .getByRole("complementary", { name: "What matters for this search" })
      .getByText("Water resistance", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What separates your saved options" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/\d+% match|\d+\/10/i);
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});

test("keeps unresolved must-haves honest and reject/undo usable on mobile", async ({
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
    page.getByRole("heading", {
      name: "Why these options earned a closer look",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Current decision", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Not enough evidence")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Buy from|Check current offers/ }),
  ).toHaveCount(0);
  await expect(page.getByText("Needs verification").first()).toBeVisible();
  await expect(page.getByText("Must-haves to verify").first()).toBeVisible();
  await expect(
    page.getByText("Maximum width", { exact: true }).first(),
  ).toBeVisible();

  const decisionRegion = page.getByRole("region", {
    name: "Why these options earned a closer look",
  });
  await decisionRegion
    .getByRole("button", { name: "Not for me" })
    .first()
    .click();
  const rejected = page.locator("details").filter({ hasText: /^Rejected/ });
  await rejected.locator("summary").click();
  await rejected.getByRole("button", { name: "Undo" }).click();
  await expect(
    decisionRegion.getByText("Needs verification").first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});
