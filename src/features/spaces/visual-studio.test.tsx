import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VisualStudio } from "./visual-studio";
import { emptyRoomState, type SpaceView } from "./contracts";
import type { VisualCollection, VisualView } from "./visual-contracts";

const id = "00000000-0000-4000-8000-000000000001";
const assetId = "00000000-0000-4000-8000-000000000002";
const designId = "00000000-0000-4000-8000-000000000003";
const room: SpaceView = {
  id,
  name: "Office",
  roomType: "office",
  currentRevision: 1,
  updatedAt: "2026-09-18T12:00:00.000Z",
  state: emptyRoomState(),
  assets: [
    {
      id: assetId,
      filename: "office.png",
      contentType: "image/png",
      byteSize: 100,
      url: `/api/spaces/${id}/assets/${assetId}`,
    },
  ],
  analysisMode: "unavailable",
};
function design(): VisualView {
  return {
    id: designId,
    spaceId: id,
    roomRevision: 1,
    basis: {
      version: 1,
      name: "Warmer work corner",
      direction: "Keep my desk",
      roomName: "Office",
      roomState: emptyRoomState(),
      assetIds: [assetId],
      products: [],
    },
    status: "draft",
    failure: null,
    createdAt: room.updatedAt,
    imageUrl: null,
  };
}
let data: VisualCollection;
const request = vi.fn<typeof fetch>();
beforeEach(() => {
  data = { designs: [], products: [], generationAvailable: false };
  request.mockReset();
  request.mockImplementation(async (url) =>
    Response.json(String(url).endsWith("/visuals") ? data : room),
  );
  vi.stubGlobal("fetch", request);
});
afterEach(() => vi.unstubAllGlobals());
it("shows the actual photo and never pretends a render exists", async () => {
  render(<VisualStudio spaceId={id} />);
  expect(
    await screen.findByAltText("Original uploaded view of Office"),
  ).toHaveAttribute("src", room.assets[0]!.url);
  expect(
    screen.getByText("Original uploaded image · Not a generated concept."),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Generate this concept" }),
  ).not.toBeInTheDocument();
});
it("saves without generating and retains the selected viewpoint", async () => {
  request.mockImplementation(async (url, options) => {
    if (options?.method === "POST") {
      data.designs = [design()];
      return Response.json(design());
    }
    return Response.json(String(url).endsWith("/visuals") ? data : room);
  });
  render(<VisualStudio spaceId={id} />);
  fireEvent.change(await screen.findByLabelText("Design name"), {
    target: { value: "Warmer work corner" },
  });
  fireEvent.change(screen.getByLabelText("What would you change?"), {
    target: { value: "Keep my desk" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save this design" }));
  await screen.findByText(/Rendering is not configured/);
  const posts = request.mock.calls.filter(
    ([, init]) => init?.method === "POST",
  );
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0]![1]!.body as string)).toMatchObject({
    expectedRevision: 1,
    assetIds: [assetId],
    products: [],
  });
});
it("requires consent, labels approximate render and compares with the original", async () => {
  data = { ...data, designs: [design()], generationAvailable: true };
  request.mockImplementation(async (url, options) => {
    if (options?.method === "POST") {
      data.designs = [
        {
          ...design(),
          status: "completed",
          imageUrl: `/api/spaces/${id}/visuals/${designId}/image`,
        },
      ];
      return Response.json(data.designs[0]);
    }
    return Response.json(String(url).endsWith("/visuals") ? data : room);
  });
  render(<VisualStudio spaceId={id} />);
  const generate = await screen.findByRole("button", {
    name: "Generate this concept",
  });
  expect(generate).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(generate);
  await screen.findByText(/AI concept · Not a measured 3D model/);
  expect(screen.getByAltText(/Generated concept/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Your room" }));
  expect(screen.getByAltText("Original uploaded view of Office")).toBeVisible();
  expect(
    request.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
});
it("marks historical designs and prevents generation against changed room truth", async () => {
  data = {
    ...data,
    designs: [{ ...design(), roomRevision: 0 }],
    generationAvailable: true,
  };
  render(<VisualStudio spaceId={id} />);
  await screen.findByText(/Earlier room version/);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(
    screen.getByRole("button", { name: "Generate this concept" }),
  ).toBeDisabled();
});
it("preserves unsaved text on conflict and does not retry a failed save automatically", async () => {
  request.mockImplementation(async (url, options) =>
    options?.method === "POST"
      ? Response.json(
          { error: { message: "Room changed. Reload latest room." } },
          { status: 409 },
        )
      : Response.json(String(url).endsWith("/visuals") ? data : room),
  );
  render(<VisualStudio spaceId={id} />);
  fireEvent.change(await screen.findByLabelText("Design name"), {
    target: { value: "My draft" },
  });
  fireEvent.change(screen.getByLabelText("What would you change?"), {
    target: { value: "Keep the window" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save this design" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Design name")).toHaveValue("My draft");
  expect(
    request.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
});
it("resets draft and selected design when navigating to another room", async () => {
  const view = render(<VisualStudio spaceId={id} />);
  fireEvent.change(await screen.findByLabelText("Design name"), {
    target: { value: "Room A idea" },
  });
  view.rerender(<VisualStudio spaceId={assetId} />);
  await waitFor(() =>
    expect(screen.getByLabelText("Design name")).toHaveValue(""),
  );
});
it("includes only explicitly selected extra room photos", async () => {
  const extraId = "00000000-0000-4000-8000-000000000004";
  const extra = {
    ...room.assets[0]!,
    id: extraId,
    filename: "other-corner.png",
    url: `/api/spaces/${id}/assets/${extraId}`,
  };
  request.mockImplementation(async (url, options) => {
    if (options?.method === "POST") {
      data.designs = [design()];
      return Response.json(design());
    }
    return Response.json(
      String(url).endsWith("/visuals")
        ? data
        : { ...room, assets: [...room.assets, extra] },
    );
  });
  render(<VisualStudio spaceId={id} />);
  const reference = await screen.findByRole("checkbox", {
    name: "other-corner.png",
  });
  expect(reference).not.toBeChecked();
  fireEvent.click(reference);
  fireEvent.change(screen.getByLabelText("Design name"), {
    target: { value: "Two views" },
  });
  fireEvent.change(screen.getByLabelText("What would you change?"), {
    target: { value: "Warm light" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save this design" }));
  await screen.findByText(/Rendering is not configured/);
  const post = request.mock.calls.find(
    ([, options]) => options?.method === "POST",
  )!;
  expect(JSON.parse(post[1]!.body as string).assetIds).toEqual([
    assetId,
    extraId,
  ]);
});
