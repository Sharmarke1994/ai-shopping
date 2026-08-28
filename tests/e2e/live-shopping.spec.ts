import { expect, test } from "@playwright/test";

test("researches strongest options, compares saves, refines, and restores the task", async ({
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
  await expect(page.getByText("Breathability", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View at Fixture Outfitters" }).first(),
  ).toHaveAttribute("href", /^https:\/\/example\.test\/products\//);

  await page
    .getByRole("button", { name: "Investigate strongest options" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Which products are actually supported?",
    }),
  ).toBeVisible();
  await expect(page.getByText("Strongest-supported so far")).toBeVisible();
  await expect(page.getByText("Why it fits").first()).toBeVisible();

  const researchedOptions = page.getByRole("region", {
    name: "Which products are actually supported?",
  });
  await researchedOptions
    .getByRole("button", { name: "Save", exact: true })
    .first()
    .click();
  await expect(
    researchedOptions.getByRole("button", { name: "Saved ✓" }),
  ).toHaveCount(1);
  await researchedOptions
    .getByRole("button", { name: "Save", exact: true })
    .first()
    .click();
  await expect(
    researchedOptions.getByRole("button", { name: "Saved ✓" }),
  ).toHaveCount(2);
  await expect(
    page.getByRole("heading", {
      name: "Trade-offs against today’s brief",
    }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toContainText("Breathability");

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
  await page
    .getByRole("button", { name: "Investigate strongest options" })
    .click();
  await expect(page.getByRole("table")).toContainText("Water resistance");

  const restoredUrl = page.url();
  expect(restoredUrl).toContain("session=");
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Which products are actually supported?",
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("complementary", { name: "What matters for this search" })
      .getByText("Water resistance", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Trade-offs against today’s brief" }),
  ).toBeVisible();
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
  await expect(page.getByText("Maximum width", { exact: true })).toBeVisible();
  await expect(page.getByText("maximum 60 cm")).toBeVisible();
  await page
    .getByRole("button", { name: "Investigate strongest options" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Which products are actually supported?",
    }),
  ).toBeVisible();
  await expect(page.getByText(/attributable source/).first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
