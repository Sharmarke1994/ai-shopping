import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.PREVIEW_URL ?? "http://127.0.0.1:3100";
const outputDirectory = path.resolve("docs/reviews/v0-02/screenshots");

const viewports = [
  { name: "desktop-1440", width: 1440, height: 1000 },
  { name: "laptop-1024", width: 1024, height: 768 },
  { name: "mobile-390", width: 390, height: 844 },
];

const states = [
  { name: "landing", path: "/" },
  { name: "question", path: "/?fixture=headphones-results" },
  { name: "results", path: "/?fixture=shelving-results" },
  { name: "refined", path: "/?fixture=headphones-refined" },
  { name: "degraded", path: "/?fixture=degraded-results" },
  { name: "no-matches", path: "/?fixture=no-matches" },
];

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch(
  process.platform === "darwin" ? { channel: "chrome" } : {},
);

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();

    for (const state of states) {
      await page.goto(`${baseUrl}${state.path}`, { waitUntil: "load" });
      await page.locator("[data-fixture-view]").waitFor();
      await page.locator("img").evaluateAll(async (images) => {
        await Promise.all(
          images.map(async (image) => {
            if (image.complete) return;
            await new Promise((resolve) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", resolve, { once: true });
            });
          }),
        );
      });
      await page.waitForTimeout(500);

      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      if (hasHorizontalOverflow) {
        throw new Error(
          `Horizontal overflow in ${state.name} at ${viewport.width}px`,
        );
      }

      await page.screenshot({
        path: path.join(outputDirectory, `${viewport.name}-${state.name}.png`),
        fullPage: true,
      });
    }

    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`Captured ${viewports.length * states.length} screenshots.`);
