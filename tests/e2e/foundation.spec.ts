import { expect, test } from "@playwright/test";

test("moves from the consumer landing into a prepared question and results", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "Find the thing that fits your life—not just your search.",
    }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Consider — working shopping prototype");

  await page
    .getByRole("button", { name: /running, without the bulk/i })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "What normally makes a running cap feel wrong?",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Show me options now" }).click();
  await expect(
    page.getByRole("heading", {
      name: /three caps that look genuinely light/i,
    }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(3);
});

test("supports direct zero-question and honest no-match states", async ({
  page,
}) => {
  await page.goto("/?fixture=exact-results");
  await expect(
    page.getByRole("heading", { name: "The exact model you asked for" }),
  ).toBeVisible();
  await expect(page.getByText("Worth asking")).toHaveCount(0);

  await page.goto("/?fixture=no-matches");
  await expect(
    page.getByRole("heading", {
      name: /nothing we'd confidently put in front of you yet/i,
    }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Stretch the budget to £40" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Stretch the budget to £40" }).click();
  await expect(
    page.getByRole("heading", {
      name: "The same narrow brief works once the budget reaches £40",
    }),
  ).toBeVisible();
  await expect(page.getByText("Maximum 42 × 20 cm footprint")).toBeVisible();
  await expect(page.getByText("Freestanding; avoid wall fixing")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);
});

test("resolves a post-result question even when the view key stays the same", async ({
  page,
}) => {
  const question = page.getByRole("heading", {
    name: "Which compromise would bother you more on a long commute?",
  });

  await page.goto("/?fixture=headphones-results");
  await page.getByRole("button", { name: "Show me options now" }).click();
  await expect(question).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(3);

  await page.goto("/?fixture=headphones-results");
  await page.getByRole("button", { name: "Hearing more of the train" }).click();
  await expect(question).toHaveCount(0);
  await expect(
    page.getByText(
      "Kept: stronger noise cancellation remains the lead preference.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(3);
});

test("preserves a save through refinement and keeps rejection reversible", async ({
  page,
}) => {
  await page.goto("/?fixture=headphones-results");

  const card = page.getByRole("article", { name: "Hush Arc One" });
  await card.getByRole("button", { name: "Save" }).click();
  await page
    .getByRole("button", { name: "Pressure around my glasses" })
    .click();
  await expect(page.getByText("Saved 1")).toBeVisible();
  await expect(
    page
      .getByRole("article", { name: "Hush Arc One" })
      .getByRole("button", { name: "Saved" }),
  ).toHaveAttribute("aria-pressed", "true");

  const refinedCard = page.getByRole("article", { name: "Softline Commute" });
  await refinedCard.getByRole("button", { name: "Not for me" }).click();
  await expect(refinedCard).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(
    page.getByRole("article", { name: "Softline Commute" }),
  ).toBeVisible();
});

test("keeps the primary request path keyboard-operable with reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const request = page.getByLabel("What are you looking for?");
  await request.fill("I need a light breathable cap for running in this heat.");
  await request.focus();
  await page.keyboard.press("Tab");

  const submit = page.getByRole("button", { name: /start looking/i });
  await expect(submit).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", {
      name: "What normally makes a running cap feel wrong?",
    }),
  ).toBeVisible();
});

test("keeps the server-rendered compact brief closed before hydration", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();

  try {
    await page.goto("/?fixture=shelving-results");
    await expect(page.locator("details summary")).toBeVisible();
    await expect(page.locator("details ul")).toBeHidden();
  } finally {
    await context.close();
  }
});
