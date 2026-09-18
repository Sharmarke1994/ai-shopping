import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createDatabaseConnection } from "@/infrastructure/database/clients";
import { seedFounderJourney } from "../support/founder-journey";
import {
  mouseCorpus,
  chairCorpus,
  vacuumCorpus,
  coffeeCorpus,
} from "../support/founder-product-evidence";
import {
  deepenLiveShoppingResearch,
  researchLiveCandidate,
  setLiveListingRejected,
  setLiveListingSaved,
} from "@/features/live-shopping/application";

function fixtureConnection() {
  const url = process.env.TEST_DATABASE_URL;
  if (
    !url ||
    !/test/.test(new URL(url).pathname) ||
    !["localhost", "127.0.0.1"].includes(new URL(url).hostname)
  )
    throw new Error("Founder browser fixtures require a local test database");
  return createDatabaseConnection({ url, prepare: false });
}
async function routeJourney(
  page: Page,
  journey: Awaited<ReturnType<typeof seedFounderJourney>>,
) {
  // Transport seam only: every response is built by the real application from
  // PostgreSQL. No precomputed view/assessment and no context/provider calls.
  await page.route("**/api/live-shopping**", async (route) => {
    const body =
      route.request().method() === "POST"
        ? route.request().postDataJSON()
        : null;
    let view;
    if (body?.operation === "refine") view = await journey.refine(body.message);
    else if (["save_listing", "unsave_listing"].includes(body?.operation))
      view = await setLiveListingSaved({
        dependencies: journey.dependencies,
        input: body,
      });
    else if (
      ["reject_listing", "undo_reject_listing"].includes(body?.operation)
    )
      view = await setLiveListingRejected({
        dependencies: journey.dependencies,
        input: body,
      });
    else if (body?.operation === "deepen_research")
      view = await deepenLiveShoppingResearch({
        dependencies: journey.dependencies,
        input: body,
      });
    else if (body?.operation === "research_candidate")
      view = await researchLiveCandidate({
        dependencies: journey.dependencies,
        input: body,
      });
    else if (route.request().method() === "GET") view = await journey.load();
    else throw new Error(`Unexpected founder operation: ${body?.operation}`);
    await route.fulfill({ json: view });
  });
}
test("persisted differentiated mouse: tie, refinement, ready, refresh and mobile", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const connection = fixtureConnection();
  const journey = await seedFounderJourney(
    connection.db,
    "ergonomic-mouse",
    mouseCorpus,
  );
  await deepenLiveShoppingResearch({
    dependencies: journey.dependencies,
    input: { operation: "deepen_research", sessionId: journey.sessionId },
  });
  await routeJourney(page, journey);
  try {
    await page.addInitScript(
      (id) => localStorage.setItem("consider-live-session-v1", id),
      journey.sessionId,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/live");
    await expect(page.locator("#current-decision-heading")).toContainText(
      /wouldn’t choose/i,
    );
    const cards = page.getByRole("region", {
      name: "Why these options earned a closer look",
    });
    await cards
      .getByRole("button", { name: "Save", exact: true })
      .first()
      .click();
    await expect(cards.getByRole("button", { name: "Saved ✓" })).toHaveCount(1);
    await cards
      .getByRole("button", { name: "Save", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "What separates your saved options" }),
    ).toBeVisible();
    await mkdir("docs/screenshots/v0-09-founder", { recursive: true });
    await page.screenshot({
      path: "docs/screenshots/v0-09-founder/mouse-before-desktop.png",
      fullPage: true,
    });
    await page
      .getByLabel("Refine what you’re looking for")
      .fill("Reviews matter less now. Comfort for long workdays matters most.");
    await page.getByRole("button", { name: "Update my priorities" }).click();
    await expect(page.locator("#current-decision-heading")).toContainText(
      /I’d choose Mouse A/i,
    );
    const change = page.getByRole("region", { name: "What changed" });
    await expect(change).toContainText("broke the tie");
    await change.getByText("See the change in context").click();
    await expect(change).toContainText("Existing product evidence was reused");
    await expect(
      page.getByText(/Individual fit can still vary/).first(),
    ).toBeVisible();
    await page.locator("#current-decision-heading").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/screenshots/v0-09-founder/mouse-after-desktop.png",
      fullPage: true,
    });
    expect((await journey.load()).decisionSupport?.currentDecision.state).toBe(
      "ready_to_choose",
    );
    expect(
      (await journey.load()).decisionSupport?.currentDecision.frontier,
    ).toBeNull();
    await expect(
      page.getByRole("heading", { name: "A sensible alternative" }),
    ).toHaveCount(0);
    await page.reload();
    await expect(page.locator("#current-decision-heading")).toContainText(
      /I’d choose Mouse A/i,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#current-decision-heading").scrollIntoViewIfNeeded();
    await expect(page.locator("body")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "docs/screenshots/v0-09-founder/mouse-after-mobile.png",
      fullPage: true,
    });
    await page
      .getByRole("article", { name: mouseCorpus[0]!.title })
      .first()
      .getByRole("button", { name: "Not for me" })
      .click();
    await expect(page.locator("#current-decision-heading")).not.toContainText(
      "I’d choose Mouse A",
    );
    const rejected = page.locator("details").filter({ hasText: /^Rejected/ });
    await rejected.locator("summary").click();
    await rejected.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("#current-decision-heading")).toContainText(
      "I’d choose Mouse A",
    );
    await page.reload();
    await expect(page.locator("#current-decision-heading")).toContainText(
      "I’d choose Mouse A",
    );
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await connection.client.end({ timeout: 5 });
  }
});

for (const [name, products, expected] of [
  ["office-chair", chairCorpus, "leader_with_tradeoff"],
  ["cordless-vacuum", vacuumCorpus, "leader_needs_verification"],
  ["compact-coffee-machine", coffeeCorpus, "ready_to_choose"],
] as const)
  test(`founder ${name}: decision-specific actions and mobile hierarchy`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const connection = fixtureConnection();
    const journey = await seedFounderJourney(connection.db, name, products);
    await deepenLiveShoppingResearch({
      dependencies: journey.dependencies,
      input: { operation: "deepen_research", sessionId: journey.sessionId },
    });
    await routeJourney(page, journey);
    try {
      await page.addInitScript(
        (id) => localStorage.setItem("consider-live-session-v1", id),
        journey.sessionId,
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto("/live");
      const hero = page.locator(
        'section[aria-labelledby="current-decision-heading"]',
      );
      await expect(hero).toBeVisible();
      expect(
        (await journey.load()).decisionSupport?.currentDecision.state,
      ).toBe(expected);
      if (name === "cordless-vacuum") {
        await expect(hero.getByRole("link", { name: /Buy from/ })).toHaveCount(
          0,
        );
        // This page starts after the bounded deepening has finished. Do not
        // offer another identical paid check when the source did not answer.
        await expect(hero).toContainText("Noise level");
        await expect(hero).toContainText("Checked · still unresolved");
      } else
        await expect(
          hero.getByRole("link", { name: /Buy from/ }),
        ).toHaveAttribute("href", /^https:\/\/example\.test\//);
      if (name === "office-chair") {
        await expect(hero).toContainText("above your £250 target");
        const frontier = hero.getByRole("region", {
          name: "A sensible alternative",
        });
        await expect(frontier).toContainText("Chair A Workseat 100");
        await expect(frontier).toContainText("£245.00");
        await expect(frontier).toContainText("£5 below your £250 target");
        await expect(frontier).toContainText("saves £85");
        await expect(frontier).toContainText("lower-back support");
        const beforeBridge = await journey.load();
        await frontier
          .getByRole("link", {
            name: "Explore this trade-off in your priorities",
          })
          .focus();
        await page.keyboard.press("Enter");
        await expect(
          page.getByLabel("Refine what you’re looking for"),
        ).toBeFocused();
        await expect(
          page.getByLabel("Refine what you’re looking for"),
        ).toHaveValue("");
        expect((await journey.load()).brief).toEqual(beforeBridge.brief);
      } else {
        await expect(
          hero.getByRole("heading", { name: "A sensible alternative" }),
        ).toHaveCount(0);
        expect(
          (await journey.load()).decisionSupport?.currentDecision.frontier,
        ).toBeNull();
      }
      const view = await journey.load();
      if (view.action.kind !== "search" || view.action.search === null)
        throw new Error("Expected persisted founder search results");
      for (const option of view.action.search.listings)
        await setLiveListingSaved({
          dependencies: journey.dependencies,
          input: {
            operation: "save_listing",
            sessionId: journey.sessionId,
            candidateListingId: option.candidateListingId,
          },
        });
      await page.reload();
      await expect(
        page.getByRole("heading", {
          name: "What separates your saved options",
        }),
      ).toBeVisible();
      if (name === "office-chair") {
        await hero
          .getByRole("link", { name: "Compare the evidence for both" })
          .click();
        await expect(
          page.getByRole("heading", {
            name: "What separates your saved options",
          }),
        ).toBeFocused();
        await mkdir("docs/screenshots/v0-09-frontier", { recursive: true });
        await hero.screenshot({
          path: "docs/screenshots/v0-09-frontier/chair-desktop.png",
        });
      }
      await mkdir("docs/screenshots/v0-09-founder", { recursive: true });
      await page.locator("#current-decision-heading").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `docs/screenshots/v0-09-founder/${name}-desktop.png`,
        fullPage: false,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      if (name === "office-chair") {
        await hero.screenshot({
          path: "docs/screenshots/v0-09-frontier/chair-mobile.png",
        });
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.locator("#current-decision-heading").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `docs/screenshots/v0-09-founder/${name}-mobile.png`,
        fullPage: false,
      });
      expect(
        (await journey.load()).decisionSupport?.currentDecision.state,
      ).toBe(expected);
    } finally {
      await page.unrouteAll({ behavior: "wait" });
      await connection.client.end({ timeout: 5 });
    }
  });
