import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { spaceFixturePhotos } from "../support/space-photos";

// Real local persistence and HTTP. No generated image or photo-fidelity claim.
for (const width of [1440, 390]) {
  test(`saved visual design survives return, at ${width}px without a provider`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const created = await request.post("/api/spaces", {
      data: { name: "Visual studio test room", roomType: "office" },
    });
    expect(created.status()).toBe(201);
    const room = await created.json();
    const images = await spaceFixturePhotos();
    const upload = await request.post(`/api/spaces/${room.id}/assets`, {
      multipart: { expectedRevision: "0", photo: images[0]! },
    });
    expect(upload.ok()).toBe(true);
    await page.goto(`/spaces/${room.id}/design`);
    await expect(
      page.getByAltText("Original uploaded view of Visual studio test room"),
    ).toBeVisible();
    await page.getByLabel("Design name").fill("Warm desk corner");
    await page
      .getByLabel("What would you change?")
      .fill(
        "Keep the desk and window. Explore a warmer palette without changing the layout.",
      );
    await page.getByRole("button", { name: "Save this design" }).click();
    await expect(page.getByText(/Rendering is not configured/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Generate this concept" }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Warm desk corner" }),
    ).toBeVisible();
    await expect(
      page.getByText(/Original uploaded image · Not a generated concept/),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await mkdir("docs/screenshots/v0-10-visual-designs", { recursive: true });
    await page.screenshot({
      path: `docs/screenshots/v0-10-visual-designs/studio-${width}.png`,
      fullPage: true,
    });
    const result = await (
      await request.get(`/api/spaces/${room.id}/visuals`)
    ).json();
    const saved = result.designs[0];
    const generated = await request.post(
      `/api/spaces/${room.id}/visuals/${saved.id}`,
      { data: { consentToImageProvider: true } },
    );
    expect(generated.status()).toBe(503);
    const other = await (
      await request.post("/api/spaces", { data: { name: "Other room" } })
    ).json();
    expect(
      (
        await request.get(`/api/spaces/${other.id}/visuals/${saved.id}/image`)
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.post(`/api/spaces/${room.id}/visuals/${saved.id}`, {
          headers: { Origin: "https://attacker.example" },
          data: { consentToImageProvider: true },
        })
      ).status(),
    ).toBe(403);
    const changed = await request.post(`/api/spaces/${room.id}`, {
      data: {
        operation: "add_item",
        expectedRevision: 1,
        label: "Desk to keep",
      },
    });
    expect(changed.ok()).toBe(true);
    await page.reload();
    await expect(page.getByText(/Earlier room version/)).toBeVisible();
  });
}
