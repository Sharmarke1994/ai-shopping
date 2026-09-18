import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import {
  createOpenAISpaceRenderer,
  fetchVisualProductImage,
  visualPrompt,
} from "./visual-renderer";
import type { PinnedPageRequester } from "@/features/product-understanding/page-fetch";
import { emptyRoomState } from "./contracts";
import { visualRequestSchema, type VisualBasis } from "./visual-contracts";

const basis: VisualBasis = {
  version: 1,
  name: "Warm work corner",
  direction: "Keep my desk",
  roomName: "Office",
  roomState: emptyRoomState(),
  assetIds: [randomUUID()],
  products: [],
};
const photo = () =>
  sharp({ create: { width: 24, height: 24, channels: 3, background: "beige" } })
    .png()
    .toBuffer();
afterEach(() => vi.useRealTimers());
describe("visual design boundaries", () => {
  it("requires real room photos and rejects duplicate selections/client product facts", () => {
    const input = {
      actionId: randomUUID(),
      expectedRevision: 1,
      name: "Idea",
      direction: "Warmer",
      assetIds: basis.assetIds,
      products: [],
    };
    expect(visualRequestSchema.safeParse(input).success).toBe(true);
    expect(
      visualRequestSchema.safeParse({ ...input, assetIds: [] }).success,
    ).toBe(false);
    expect(
      visualRequestSchema.safeParse({
        ...input,
        assetIds: [...basis.assetIds, ...basis.assetIds],
      }).success,
    ).toBe(false);
    expect(
      visualRequestSchema.safeParse({
        ...input,
        products: [
          { listingId: randomUUID(), placement: "Left", priceAmountMinor: 1 },
        ],
      }).success,
    ).toBe(false);
  });
  it("requests faithful viewpoint, protects keep intent and disclaims metric geometry", () => {
    const state = emptyRoomState();
    state.items.push({
      id: randomUUID(),
      factId: null,
      label: "My walnut desk",
      intent: "keep",
    });
    const prompt = visualPrompt({ ...basis, roomState: state });
    expect(prompt).toContain("My walnut desk");
    expect(prompt).toContain("FIRST room photograph");
    expect(prompt).toContain("NOT a scale drawing");
    expect(prompt).toContain("untrusted design DATA");
  });
  it("accepts a bounded decoded public product reference through a pinned address", async () => {
    const requester = vi.fn<PinnedPageRequester>(async () => ({
      statusCode: 200,
      headers: { "content-type": "image/png" },
      body: await photo(),
    }));
    const image = await fetchVisualProductImage(
      "https://merchant.example/item.png",
      {
        resolver: async () => [{ address: "93.184.216.34", family: 4 }],
        requester,
      },
    );
    expect(image.contentType).toBe("image/png");
    expect(requester.mock.calls[0]?.[0]).toMatchObject({
      address: { address: "93.184.216.34" },
      maxBytes: 4194304,
    });
  });
  it.each([
    "http://127.0.0.1/photo",
    "file:///etc/passwd",
    "https://user:secret@shop.example/x",
  ])("refuses unsafe image URL %s", async (url) => {
    const requester = vi.fn();
    await expect(fetchVisualProductImage(url, { requester })).rejects.toThrow();
    expect(requester).not.toHaveBeenCalled();
  });
  it("refuses private DNS, redirect responses and SVG masquerading as PNG", async () => {
    const requester = vi.fn();
    await expect(
      fetchVisualProductImage("https://shop.example/x", {
        resolver: async () => [{ address: "10.0.0.1", family: 4 }],
        requester,
      }),
    ).rejects.toThrow();
    expect(requester).not.toHaveBeenCalled();
    for (const status of [302, 200])
      await expect(
        fetchVisualProductImage("https://shop.example/x", {
          resolver: async () => [{ address: "93.184.216.34", family: 4 }],
          requester: async () => ({
            statusCode: status,
            headers: {
              "content-type": "image/png",
              location: "http://127.0.0.1/x",
            },
            body: Buffer.from("<svg></svg>"),
          }),
        }),
      ).rejects.toThrow();
  });
  it("bounds DNS and does not request a late-resolved reference", async () => {
    vi.useFakeTimers();
    const requester = vi.fn();
    const pending = fetchVisualProductImage("https://shop.example/x", {
      resolver: () => new Promise(() => {}),
      requester,
    });
    const assertion = expect(pending).rejects.toThrow("DNS timeout");
    await vi.advanceTimersByTimeAsync(3001);
    await assertion;
    expect(requester).not.toHaveBeenCalled();
  });
  it("sends room/product bytes in order, one high-fidelity edit, and decodes output", async () => {
    const image = await photo();
    const request = vi.fn<typeof fetch>(async () =>
      Response.json({ data: [{ b64_json: image.toString("base64") }] }),
    );
    const renderer = createOpenAISpaceRenderer(
      "test-only-not-a-secret",
      request,
    );
    const result = await renderer.render({
      basis,
      roomImages: [{ bytes: image, contentType: "image/png" }],
      productImages: [],
    });
    expect((await sharp(result).metadata()).format).toBe("png");
    const body = JSON.parse(request.mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({
      model: "gpt-image-2",
      n: 1,
      input_fidelity: "high",
    });
    expect(body.images).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not retry provider errors or accept malformed output", async () => {
    for (const response of [
      new Response("private provider error", { status: 429 }),
      Response.json({ data: [] }),
      Response.json({ data: [{ b64_json: "not an image" }] }),
    ]) {
      const request = vi.fn<typeof fetch>(async () => response);
      await expect(
        createOpenAISpaceRenderer("test", request).render({
          basis,
          roomImages: [],
          productImages: [],
        }),
      ).rejects.toThrow();
      expect(request).toHaveBeenCalledTimes(1);
    }
  });
  it("aborts a stalled provider request at the deadline without retrying", async () => {
    vi.useFakeTimers();
    const request = vi.fn<typeof fetch>(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    const pending = createOpenAISpaceRenderer("test", request).render({
      basis,
      roomImages: [],
      productImages: [],
    });
    const assertion = expect(pending).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(150001);
    await assertion;
    expect(request).toHaveBeenCalledTimes(1);
  });
});
