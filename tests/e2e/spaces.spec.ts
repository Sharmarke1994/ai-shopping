import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { spaceFixturePhotos } from "../support/space-photos";

// Real HTTP routes -> application -> PostgreSQL -> filesystem, no mocked transport.
// Requires a migrated local test DB and explicit labelled fixture mode on server.
test.describe.configure({ mode: "serial" });
for (const width of [1440, 390]) {
  test(`persistent room: photos, confirmed truth, measurements and design at ${width}px`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    await mkdir("docs/screenshots/v0-10-spaces", { recursive: true });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("/spaces");
    await expect(
      page.getByRole("heading", { name: "Your spaces" }),
    ).toBeVisible();
    await expect(page.getByLabel("Space name")).toBeVisible();
    await page.screenshot({
      path: `docs/screenshots/v0-10-spaces/spaces-initial-${width}.png`,
      fullPage: true,
    });
    await page.getByLabel("Space name").fill("Bedroom");
    await page.getByLabel("Room type").selectOption("bedroom");
    await page.getByRole("button", { name: "+ Add a space" }).click();
    await page.waitForURL(/\/spaces\/[a-f0-9-]+$/);
    const url = page.url();
    const roomId = new URL(url).pathname.split("/").at(-1)!;
    await expect(
      page.getByRole("heading", { name: "Bedroom", exact: true }),
    ).toBeVisible();
    const photos = await spaceFixturePhotos();
    await page.getByLabel("Choose photos").setInputFiles(photos);
    await expect(page.getByText("3 selected · not saved yet")).toBeVisible();
    await page.getByRole("button", { name: "Save selected photos" }).click();
    await expect(page.getByText("3 / 10 photos")).toBeVisible();
    await expect(
      page.getByRole("img", { name: /Bedroom, uploaded view/ }),
    ).toHaveCount(3);
    await expect(
      page.getByText(/do not describe or analyse these photos/),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Load fictional observations" })
      .click();
    await expect(
      page.getByRole("button", { name: "Confirm Desk", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Confirm Desk", exact: true })
      .click();
    await expect(page.getByLabel("Plan for Black desk")).toBeVisible();
    await expect(page.locator("#proposals-heading")).toBeFocused();
    await page.getByText("Correct Bed", { exact: true }).click();
    await page.getByLabel("Correct value for Bed").fill("Double bed");
    await page.getByRole("button", { name: "Confirm correction" }).click();
    await expect(page.getByLabel("Plan for Double bed")).toBeVisible();
    await expect(page.locator("#proposals-heading")).toBeFocused();
    await page
      .getByRole("button", { name: "Remove Shelving", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Confirm Shelving", exact: true }),
    ).toHaveCount(0);
    await page.getByText("Add a measurement", { exact: true }).click();
    await page.getByLabel("Measurement label").fill("Desk wall width");
    await page.getByLabel("Value", { exact: true }).fill("214");
    await page.getByRole("button", { name: "Save measurement" }).click();
    await expect(page.getByText("214 cm", { exact: true })).toBeVisible();
    for (const name of ["Double bed", "Black desk"]) {
      await page.getByLabel(`Plan for ${name}`).selectOption("keep");
      await expect(page.getByLabel(`Plan for ${name}`)).toHaveValue("keep");
      await expect(page.getByLabel(`Plan for ${name}`)).toBeEnabled();
    }
    await page.getByText("Add a room item", { exact: true }).click();
    await page.getByLabel("Item name").fill("Floor lamp");
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    await page.getByLabel("Plan for Floor lamp").selectOption("replace");
    await expect(page.getByLabel("Plan for Floor lamp")).toBeEnabled();
    await page.getByText("Edit room design", { exact: true }).click();
    await page
      .getByLabel("What would you like to change?")
      .fill(
        "Make the room warmer, cleaner and more put together without replacing the desk or bed.",
      );
    await page.getByLabel(/Things to add/).fill("Rug\nWarmer lamp\nWall art");
    await page
      .getByLabel(/^Palette/)
      .fill("Cream\nBeige\nDark brown\nBlack accents");
    await page.getByRole("button", { name: "Save room design" }).click();
    await expect(
      page
        .getByRole("region", { name: "Bedroom design" })
        .getByText("Rug", { exact: true }),
    ).toBeVisible();
    const before = await (
      await page.request.get(`/api/spaces/${roomId}`)
    ).json();
    await page.reload();
    await expect(page.getByText("214 cm", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Plan for Double bed")).toHaveValue("keep");
    expect(
      await (await page.request.get(`/api/spaces/${roomId}`)).json(),
    ).toEqual(before);
    await page.screenshot({
      path: `docs/screenshots/v0-10-spaces/bedroom-${width}.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("heading", { name: "Bedroom", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "docs/screenshots/v0-10-spaces/bedroom-mobile.png",
      fullPage: true,
    });
    await page.screenshot({
      path: "docs/screenshots/v0-10-spaces/bedroom-mobile-first-screen.png",
    });
    await page.getByRole("region", { name: "Confirmed by you" }).screenshot({
      path: "docs/screenshots/v0-10-spaces/bedroom-mobile-confirmed.png",
    });
    await page.getByRole("region", { name: /Measurements/ }).screenshot({
      path: "docs/screenshots/v0-10-spaces/bedroom-mobile-measurements.png",
    });
    // A new browser context has no previous JS state or storage. Persistence is real.
    const reopened = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const tab = await reopened.newPage();
    await tab.goto(url);
    await expect(tab.getByText("214 cm", { exact: true })).toBeVisible();
    await expect(
      tab.getByRole("img", { name: /Bedroom, uploaded view/ }),
    ).toHaveCount(3);
    await expect(tab.getByLabel("Plan for Floor lamp")).toHaveValue("replace");
    await reopened.close();
    // Real CAS failure preserves the losing edit and offers an explicit reload.
    await page.getByText("Add a fit question", { exact: true }).click();
    await page
      .getByLabel("What do you still need to know?")
      .fill("My unsaved question");
    expect(
      (
        await page.request.post(`/api/spaces/${roomId}`, {
          data: {
            operation: "add_unknown",
            expectedRevision: before.currentRevision,
            label: "Another tab's question",
          },
        })
      ).ok(),
    ).toBe(true);
    await page.getByRole("button", { name: "Save question" }).click();
    await expect(
      page.getByRole("button", { name: "Reload latest room" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("What do you still need to know?"),
    ).toHaveValue("My unsaved question");
    await page.getByRole("button", { name: "Reload latest room" }).click();
    await expect(
      page.getByText("Another tab's question", { exact: true }),
    ).toBeVisible();
    await page.goto("/spaces");
    await expect(page.getByText("Open space →").first()).toBeVisible();
    await page.screenshot({
      path: "docs/screenshots/v0-10-spaces/spaces-mobile.png",
      fullPage: true,
    });
  });
}

test("spaces real API rejects unsafe assets, cross-space reads and stale operations", async ({
  request,
}) => {
  const create = async () => {
    const response = await request.post("/api/spaces", {
      data: { name: "Security test room" },
    });
    expect(response.status()).toBe(201);
    return response.json();
  };
  const a = await create(),
    b = await create();
  const [photo] = await spaceFixturePhotos();
  const result = await request.post(`/api/spaces/${a.id}/assets`, {
    multipart: {
      expectedRevision: "0",
      photo: {
        name: photo!.name,
        mimeType: photo!.mimeType,
        buffer: photo!.buffer,
      },
    },
  });
  expect(result.ok()).toBe(true);
  const uploaded = await result.json();
  const image = await request.get(uploaded.assets[0].url);
  expect(image.headers()["content-type"]).toBe("image/png");
  expect(image.headers()["x-content-type-options"]).toBe("nosniff");
  expect(image.headers()["cache-control"]).toContain("private");
  expect(
    (
      await request.get(`/api/spaces/${b.id}/assets/${uploaded.assets[0].id}`)
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.get(
        `/api/spaces/${a.id}/assets/00000000-0000-4000-8000-000000000099`,
      )
    ).status(),
  ).toBe(404);
  expect(
    (await request.get(`/api/spaces/${a.id}/assets/%2e%2e%2fsecret`)).status(),
  ).toBe(400);
  for (const [name, mimeType, buffer] of [
    [
      "photo.jpg",
      "image/jpeg",
      Buffer.from("<svg><script>bad()</script></svg>"),
    ],
    ["photo.png", "application/octet-stream", photo!.buffer],
  ] as const)
    expect(
      (
        await request.post(`/api/spaces/${a.id}/assets`, {
          multipart: {
            expectedRevision: "1",
            photo: { name, mimeType, buffer },
          },
        })
      ).status(),
    ).toBe(400);
  expect(
    (
      await request.post(`/api/spaces/${a.id}`, {
        data: { operation: "add_unknown", expectedRevision: 0, label: "Stale" },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post(`/api/spaces/${a.id}`, {
        headers: { origin: "https://evil.example" },
        data: { operation: "add_unknown", expectedRevision: 1, label: "CSRF" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.get(`/api/spaces/${a.id}`, {
        headers: { host: "evil.example" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post(`/api/spaces/${b.id}`, {
        data: {
          operation: "analyse_photos",
          expectedRevision: 0,
          assetIds: [uploaded.assets[0].id],
        },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post(`/api/spaces/${a.id}`, {
        data: {
          operation: "add_measurement",
          expectedRevision: 1,
          measurement: {
            label: "Width",
            amount: 214,
            unit: "cm",
            basis: "visual_observation",
          },
        },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post(`/api/spaces/${a.id}/assets`, {
        multipart: {
          expectedRevision: "1",
          photo: {
            name: "huge.png",
            mimeType: "image/png",
            buffer: Buffer.alloc(12 * 1024 * 1024 + 1),
          },
        },
      })
    ).status(),
  ).toBe(413);
  expect((await request.get(`/api/spaces/${a.id}`)).ok()).toBe(true);
});
