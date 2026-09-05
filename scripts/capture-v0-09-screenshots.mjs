import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";

const host = "127.0.0.1";
const port = Number(process.env.V0_09_SCREENSHOT_PORT ?? "3109");
const baseUrl = `http://${host}:${port}`;
const outputDirectory = path.resolve("docs/screenshots/v0-09");
const terminalResearchStatuses = new Set(["ready", "partial", "failed"]);
const terminalDeepStatuses = new Set([
  "complete",
  "partial",
  "failed",
  "not_needed",
]);

function screenshotDatabaseUrl() {
  const raw = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (raw === undefined) {
    throw new Error(
      "Set DATABASE_URL or TEST_DATABASE_URL to a migrated local screenshot/test database.",
    );
  }
  const parsed = new URL(raw);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (
    !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
    !/(?:test|e2e|fixture|screenshot)/i.test(databaseName)
  ) {
    throw new Error(
      "V0-09 screenshots are guarded to a local database whose name contains test, e2e, fixture or screenshot.",
    );
  }
  return raw;
}

function serverProcess(databaseUrl) {
  const child = spawn(
    "pnpm",
    ["start", "--hostname", host, "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        LIVE_SHOPPING_TEST_MODE: "fixture",
        LIVE_SHOPPING_TEST_SCENARIO: "v0-09-visual",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logTail = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      logTail = `${logTail}${String(chunk)}`.slice(-20_000);
    });
  }
  return { child, logs: () => logTail };
}

async function waitForServer(server) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(
        `Production preview exited with ${server.child.exitCode}.\n${server.logs()}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/live`);
      if (response.ok) return;
    } catch {
      // The production process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Production preview did not become ready.\n${server.logs()}`);
}

async function stopServer(server) {
  if (server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.child.exitCode === null) server.child.kill("SIGKILL");
}

function sessionId(page) {
  const value = new URL(page.url()).searchParams.get("session");
  if (value === null) throw new Error("The live UI did not expose its session");
  return value;
}

async function readView(page) {
  const response = await page.request.get(
    `${baseUrl}/api/live-shopping?session=${encodeURIComponent(sessionId(page))}`,
  );
  if (!response.ok()) {
    throw new Error(`Could not inspect saved UI state (${response.status()})`);
  }
  return response.json();
}

async function waitForView(page, label, predicate, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    latest = await readView(page);
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `${label} did not appear. Last projection: ${JSON.stringify(latest)}`,
  );
}

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
  await page.evaluate(() => document.fonts.ready);
  if ((await page.locator("nextjs-portal").count()) > 0) {
    throw new Error(`${name} was rendered by a Next.js development server`);
  }
  await assertNoOverflow(page, name);
  await page.screenshot({
    path: path.join(outputDirectory, name),
    fullPage,
    animations: "disabled",
  });
}

async function start(page, request) {
  await page.goto(`${baseUrl}/live`);
  await page.getByLabel("What are you looking for?").fill(request);
  await page.getByRole("button", { name: "Start looking" }).click();
  await page.waitForURL(/\?session=/);
}

async function gateFirstOperation(page, operation, response) {
  let release;
  let markHeld;
  let held = false;
  const heldPromise = new Promise((resolve) => {
    markHeld = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/live-shopping", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && !held) {
      const body = request.postDataJSON();
      if (body?.operation === operation) {
        held = true;
        markHeld();
        if (response === undefined) {
          await gate;
          await route.continue();
        } else {
          await route.fulfill(response);
        }
        return;
      }
    }
    await route.continue();
  });
  return {
    held: heldPromise,
    release: () => release(),
  };
}

async function waitForTerminalDecision(page) {
  return waitForView(
    page,
    "terminal evidence and purchase projection",
    (view) => {
      const support = view.decisionSupport;
      if (
        support === null ||
        support.topOptions.length < 2 ||
        !terminalResearchStatuses.has(support.researchStatus) ||
        !terminalDeepStatuses.has(support.deepResearchStatus)
      ) {
        return false;
      }
      return support.topOptions.every(
        ({ listing }) => listing.purchaseState !== "checking",
      );
    },
  );
}

async function expandFetchedSource(page) {
  const region = page.getByRole("region", {
    name: "Why these options earned a closer look",
  });
  const details = region.locator("details");
  for (let index = 0; index < (await details.count()); index += 1) {
    const item = details.nth(index);
    await item.locator("summary").click();
    if (
      (await item.getByText("checked product page", { exact: false }).count()) >
      0
    ) {
      return;
    }
  }
  throw new Error("No top option exposed an attributable fetched product page");
}

async function saveTwo(page) {
  const decision = page.getByRole("region", {
    name: "Why these options earned a closer look",
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

await access(path.resolve(".next/BUILD_ID")).catch(() => {
  throw new Error("No production build exists. Run pnpm build before capture.");
});
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("V0_09_SCREENSHOT_PORT must be a valid TCP port");
}
await mkdir(outputDirectory, { recursive: true });

const server = serverProcess(screenshotDatabaseUrl());
let browser;
try {
  await waitForServer(server);
  browser = await chromium.launch(
    process.platform === "darwin" ? { channel: "chrome" } : {},
  );

  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const desktopPage = await desktop.newPage();
  const researchGate = await gateFirstOperation(desktopPage, "research");
  await start(
    desktopPage,
    "A light cap for hot-weather running where waterproofing would be useful",
  );
  await researchGate.held;
  await desktopPage
    .getByRole("heading", { name: "Products found for your brief" })
    .waitFor();
  await desktopPage
    .getByText("Checking the strongest options against your brief")
    .waitFor();
  await screenshot(desktopPage, "fixture-desktop-fast-listings.png");

  researchGate.release();
  await waitForView(
    desktopPage,
    "candidate-local progressive evidence",
    (view) =>
      view.decisionSupport?.researchStatus === "researching" &&
      view.decisionSupport.topOptions.length > 0,
  );
  await desktopPage
    .getByText("Early evidence is available; research is still running")
    .waitFor();
  await screenshot(desktopPage, "fixture-desktop-progressive-evidence.png");

  await waitForTerminalDecision(desktopPage);
  await desktopPage
    .getByText(/· Checked · source did not answer$/)
    .first()
    .waitFor();
  await desktopPage
    .getByText(/· Check could not complete$/)
    .first()
    .waitFor();
  await desktopPage
    .getByRole("link", { name: /^View at Fixture Outfitters/ })
    .first()
    .waitFor();
  await desktopPage
    .getByRole("link", { name: "View on Google Shopping" })
    .first()
    .waitFor();
  await desktopPage.getByText("Current decision", { exact: true }).waitFor();
  await screenshot(desktopPage, "fixture-desktop-current-decision.png", false);
  await expandFetchedSource(desktopPage);
  await screenshot(
    desktopPage,
    "fixture-desktop-source-depth-unknowns-purchase.png",
  );

  await saveTwo(desktopPage);
  await screenshot(desktopPage, "fixture-desktop-comparison.png");
  const comparisonSessionUrl = desktopPage.url();

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(comparisonSessionUrl);
  await mobilePage
    .getByRole("heading", { name: "What separates your saved options" })
    .waitFor();
  await mobilePage
    .getByText("Current decision", { exact: true })
    .scrollIntoViewIfNeeded();
  await screenshot(mobilePage, "fixture-mobile-current-decision.png", false);
  const mobileUnknown = mobilePage
    .getByText(/· Checked · source did not answer$/)
    .first();
  await mobileUnknown.scrollIntoViewIfNeeded();
  await screenshot(
    mobilePage,
    "fixture-mobile-source-depth-unknown.png",
    false,
  );
  await mobilePage
    .getByText("Price / purchase", { exact: true })
    .scrollIntoViewIfNeeded();
  await screenshot(mobilePage, "fixture-mobile-comparison-purchase.png", false);

  const mobileDecision = mobilePage.getByRole("region", {
    name: "Why these options earned a closer look",
  });
  await mobileDecision
    .getByRole("button", { name: "Not for me" })
    .first()
    .click();
  const rejected = mobilePage
    .locator("details")
    .filter({ hasText: /^Rejected/ });
  await rejected.locator("summary").click();
  await rejected.scrollIntoViewIfNeeded();
  await screenshot(mobilePage, "fixture-mobile-reject-undo.png", false);
  await rejected.getByRole("button", { name: "Undo" }).click();
  await rejected.waitFor({ state: "detached" });
  await desktopPage
    .getByLabel("Refine what you’re looking for")
    .fill("A breathable cap for running in hot weather");
  await desktopPage
    .getByRole("button", { name: "Update my priorities" })
    .click();
  const evolution = desktopPage.getByRole("region", {
    name: "What changed",
    exact: true,
  });
  await evolution.waitFor({ timeout: 30000 });
  await waitForTerminalDecision(desktopPage);
  await evolution.scrollIntoViewIfNeeded();
  await screenshot(
    desktopPage,
    "fixture-desktop-decision-evolution.png",
    false,
  );
  await mobilePage.goto(desktopPage.url());
  const mobileEvolution = mobilePage.getByRole("region", {
    name: "What changed",
    exact: true,
  });
  await mobileEvolution.scrollIntoViewIfNeeded();
  await screenshot(mobilePage, "fixture-mobile-decision-evolution.png", false);
  await mobilePage.reload();
  await mobileEvolution.waitFor();
  await mobile.close();
  await desktop.close();

  const targeted = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const targetedPage = await targeted.newPage();
  const deepenGate = await gateFirstOperation(targetedPage, "deepen_research", {
    status: 409,
    contentType: "application/json",
    body: JSON.stringify({
      error: {
        code: "operation_unavailable",
        message:
          "Automatic fixture deepening paused for targeted visual review.",
      },
    }),
  });
  await start(
    targetedPage,
    "A light cap for hot-weather running where waterproofing would be useful",
  );
  await deepenGate.held;
  const targetedButton = targetedPage
    .getByRole("button", { name: /Research this more|Investigate/ })
    .first();
  await targetedButton.waitFor({ timeout: 120_000 });
  const targetedResponse = targetedPage.waitForResponse((response) => {
    if (
      response.url() !== `${baseUrl}/api/live-shopping` ||
      response.request().method() !== "POST"
    ) {
      return false;
    }
    return (
      response.request().postDataJSON()?.operation === "research_candidate"
    );
  });
  await targetedButton.click();
  const response = await targetedResponse;
  if (!response.ok()) {
    throw new Error(`Targeted fixture research failed (${response.status()})`);
  }
  await targetedPage
    .getByText(
      /Focused check complete|Focused check paused|Checked · still unknown|Research paused/,
    )
    .first()
    .waitFor();
  await screenshot(targetedPage, "fixture-desktop-targeted-research.png");
  await targeted.close();
} finally {
  await browser?.close();
  await stopServer(server);
}

process.stdout.write(
  "Captured twelve V0-09 production fixture states with horizontal-overflow and no-dev-runtime assertions.\n",
);
