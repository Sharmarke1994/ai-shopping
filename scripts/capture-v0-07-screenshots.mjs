import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.PREVIEW_URL ?? "http://127.0.0.1:3100";
const outputDirectory = path.resolve("docs/screenshots/v0-07");
const request = "A light breathable cap for running in hot weather";
const capturePartial = process.env.V0_07_CAPTURE_PARTIAL === "1";

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

async function startSearch(page) {
  await page.goto(`${baseUrl}/live`, { waitUntil: "networkidle" });
  await page.getByLabel("What are you looking for?").fill(request);
  await page.getByRole("button", { name: "Start looking" }).click();
  await page
    .getByRole("heading", { name: "Products found for your brief" })
    .waitFor();
}

async function research(page) {
  await page
    .getByRole("button", { name: "Investigate strongest options" })
    .click();
  await page
    .getByRole("heading", {
      name: "Which products are actually supported?",
    })
    .waitFor();
}

async function saveTwo(page) {
  const region = page.getByRole("region", {
    name: "Which products are actually supported?",
  });
  await region
    .getByRole("button", { name: "Save", exact: true })
    .first()
    .click();
  await region.getByRole("button", { name: "Saved ✓" }).first().waitFor();
  await region
    .getByRole("button", { name: "Save", exact: true })
    .first()
    .click();
  await region.getByRole("button", { name: "Saved ✓" }).nth(1).waitFor();
  await page
    .getByRole("heading", { name: "Trade-offs against today’s brief" })
    .waitFor();
}

async function screenshot(page, name, fullPage) {
  await assertNoOverflow(page, name);
  await page.screenshot({
    path: path.join(outputDirectory, name),
    fullPage,
  });
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch(
  process.platform === "darwin" ? { channel: "chrome" } : {},
);

try {
  if (capturePartial) {
    const partial = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const partialPage = await partial.newPage();
    await startSearch(partialPage);
    await research(partialPage);
    await partialPage
      .getByText("Best-supported from partial research", { exact: true })
      .waitFor();
    await screenshot(partialPage, "fixture-desktop-partial.png", true);
    await partial.close();
  } else {
    const desktop = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const desktopPage = await desktop.newPage();
    await startSearch(desktopPage);
    await screenshot(desktopPage, "fixture-desktop-search.png", true);
    await research(desktopPage);
    await screenshot(desktopPage, "fixture-desktop-research.png", true);
    await saveTwo(desktopPage);
    await screenshot(desktopPage, "fixture-desktop-comparison.png", true);
    await desktop.close();

    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const mobilePage = await mobile.newPage();
    await startSearch(mobilePage);
    await research(mobilePage);
    await mobilePage
      .getByRole("heading", {
        name: "Which products are actually supported?",
      })
      .scrollIntoViewIfNeeded();
    await screenshot(mobilePage, "fixture-mobile-top-options.png", false);
    await saveTwo(mobilePage);
    await mobilePage
      .getByRole("heading", { name: "Trade-offs against today’s brief" })
      .scrollIntoViewIfNeeded();
    await screenshot(mobilePage, "fixture-mobile-comparison.png", false);
    await mobile.close();
  }
} finally {
  await browser.close();
}

console.log(
  capturePartial
    ? "Captured the V0-07 partial-research screenshot without horizontal overflow."
    : "Captured 5 V0-07 responsive screenshots without horizontal overflow.",
);
