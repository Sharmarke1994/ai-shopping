import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.PREVIEW_URL ?? "http://127.0.0.1:3100";
const outputDirectory = path.resolve("docs/screenshots/v0-08");
const captureFailure = process.env.V0_08_CAPTURE_FAILURE === "1";

async function assertNoOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  if (metrics.documentWidth > metrics.viewportWidth) {
    throw new Error(
      `${label} overflows horizontally: ${metrics.documentWidth}px > ${metrics.viewportWidth}px`,
    );
  }
}

async function screenshot(page, name, fullPage = true) {
  await assertNoOverflow(page, name);
  await page.screenshot({
    path: path.join(outputDirectory, name),
    fullPage,
  });
}

async function start(page, request) {
  await page.goto(`${baseUrl}/live`);
  await page.getByLabel("What are you looking for?").fill(request);
  await page.getByRole("button", { name: "Start looking" }).click();
}

async function waitForDecision(page) {
  await page
    .getByRole("heading", {
      name: /The options with the strongest current evidence|No product has cleared every must-have yet/,
    })
    .waitFor({ timeout: 120_000 });
}

async function saveTwo(page) {
  const decision = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: /The options with the strongest current evidence|No product has cleared every must-have yet/,
    }),
  });
  await decision
    .getByRole("button", { name: "Save", exact: true })
    .first()
    .click();
  await decision.getByRole("button", { name: "Saved ✓" }).first().waitFor();
  await decision
    .getByRole("button", { name: "Save", exact: true })
    .first()
    .click();
  await page
    .getByRole("heading", { name: "What separates your saved options" })
    .waitFor();
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch(
  process.platform === "darwin" ? { channel: "chrome" } : {},
);

try {
  if (captureFailure) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    await start(page, "A light breathable cap for running in hot weather");
    await page
      .getByText("Supported from partial research", { exact: true })
      .waitFor({ timeout: 120_000 });
    await screenshot(page, "fixture-desktop-partial-research.png");
    await context.close();
  } else {
    const desktop = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const desktopPage = await desktop.newPage();
    let releaseResearch;
    const researchGate = new Promise((resolve) => {
      releaseResearch = resolve;
    });
    let heldResearch = false;
    await desktopPage.route("**/api/live-shopping", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && !heldResearch) {
        const body = request.postDataJSON();
        if (body?.operation === "research") {
          heldResearch = true;
          await researchGate;
        }
      }
      await route.continue();
    });
    await start(
      desktopPage,
      "A light breathable cap for running in hot weather",
    );
    await desktopPage
      .getByRole("heading", { name: "Products found for your brief" })
      .waitFor();
    await desktopPage
      .getByText("Checking the strongest options against your brief")
      .waitFor();
    await screenshot(desktopPage, "fixture-desktop-automatic-research.png");
    releaseResearch();
    await waitForDecision(desktopPage);
    await desktopPage
      .getByText("Checking the gaps that could change the decision")
      .waitFor({ state: "hidden", timeout: 120_000 })
      .catch(() => undefined);
    await screenshot(desktopPage, "fixture-desktop-decision-support.png");
    await saveTwo(desktopPage);
    await screenshot(desktopPage, "fixture-desktop-comparison.png");

    const decision = desktopPage.getByRole("region", {
      name: /The options with the strongest current evidence|No product has cleared every must-have yet/,
    });
    await decision.getByRole("button", { name: "Not for me" }).first().click();
    const rejected = desktopPage
      .locator("details")
      .filter({ hasText: /^Rejected/ });
    await rejected.locator("summary").click();
    await screenshot(desktopPage, "fixture-desktop-rejected.png");
    await rejected.getByRole("button", { name: "Undo" }).click();

    await desktopPage
      .getByLabel("Refine what you’re looking for")
      .fill("Make waterproofing important too");
    await desktopPage
      .getByRole("button", { name: "Update my priorities" })
      .click();
    await desktopPage
      .getByText("Water resistance", { exact: true })
      .first()
      .waitFor({ timeout: 120_000 });
    await waitForDecision(desktopPage);
    await screenshot(desktopPage, "fixture-desktop-refined.png");
    await desktop.close();

    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const mobilePage = await mobile.newPage();
    await start(
      mobilePage,
      "A visually light shelving unit for a narrow alcove",
    );
    await mobilePage
      .getByRole("heading", {
        name: "What is the maximum width that will fit?",
      })
      .waitFor();
    await mobilePage.getByRole("button", { name: "Up to 60 cm" }).click();
    await waitForDecision(mobilePage);
    await mobilePage
      .getByText("Must-haves to verify")
      .first()
      .scrollIntoViewIfNeeded();
    await screenshot(mobilePage, "fixture-mobile-verification.png", false);
    const mobileDecision = mobilePage.getByRole("region", {
      name: "No product has cleared every must-have yet",
    });
    await mobileDecision
      .getByRole("button", { name: "Not for me" })
      .first()
      .click();
    const mobileRejected = mobilePage
      .locator("details")
      .filter({ hasText: /^Rejected/ });
    await mobileRejected.locator("summary").click();
    await mobileRejected.scrollIntoViewIfNeeded();
    await screenshot(mobilePage, "fixture-mobile-rejected.png", false);
    await mobile.close();
  }
} finally {
  await browser.close();
}

process.stdout.write(
  captureFailure
    ? "Captured the V0-08 partial-research state without overflow.\n"
    : "Captured seven V0-08 founder-loop states without overflow.\n",
);
