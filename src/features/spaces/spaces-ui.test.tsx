import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyRoomState, type SpaceView } from "./contracts";
import { SpacePage, SpacesPage } from "./spaces-ui";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const id = "00000000-0000-4000-8000-000000000001",
  assetId = "00000000-0000-4000-8000-000000000002",
  factId = "00000000-0000-4000-8000-000000000003";
function room(): SpaceView {
  return {
    id,
    name: "Bedroom",
    roomType: "bedroom",
    currentRevision: 1,
    updatedAt: "2026-09-18T12:00:00.000Z",
    assets: [],
    analysisMode: "unavailable",
    state: emptyRoomState(),
  };
}
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
function serve(value: unknown) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(value), { status: 200 }),
  );
}
describe("founder spaces interface", () => {
  it("offers broad space types without domestic-only onboarding", async () => {
    serve({ spaces: [] });
    render(<SpacesPage />);
    await screen.findByLabelText("Space name");
    expect(screen.getByLabelText(/Space type/)).toBeVisible();
    for (const name of [
      "office",
      "workspace",
      "warehouse",
      "hallway",
      "studio",
      "workshop",
      "outdoor",
    ])
      expect(screen.getByRole("option", { name })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Room type/)).not.toBeInTheDocument();
  });
  it("resets room identity and revision when navigating to a different room", async () => {
    const first = { ...room(), currentRevision: 10 };
    serve(first);
    const rendered = render(<SpacePage spaceId={id} />);
    await screen.findByRole("heading", { name: "Bedroom" });
    const second = {
      ...room(),
      id: assetId,
      name: "Office",
      currentRevision: 0,
    };
    serve(second);
    rendered.rerender(<SpacePage spaceId={assetId} />);
    expect(
      await screen.findByRole("heading", { name: "Office" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Bedroom" }),
    ).not.toBeInTheDocument();
  });
  it("explains an empty space list and does not ask for dimensions", async () => {
    serve({ spaces: [] });
    render(<SpacesPage />);
    expect(
      await screen.findByText("Make room for better decisions."),
    ).toBeVisible();
    expect(screen.getByLabelText("Space name")).toBeVisible();
    expect(screen.queryByLabelText(/width/i)).not.toBeInTheDocument();
  });
  it("links a persisted space and its honest counts", async () => {
    serve({ spaces: [room()] });
    render(<SpacesPage />);
    expect(
      await screen.findByText("0 confirmed facts · 0 measurements"),
    ).toBeVisible();
    expect(screen.getByText("Open space →").closest("a")).toHaveAttribute(
      "href",
      `/spaces/${id}`,
    );
  });
  it("shows unavailable analysis honestly while retaining manual controls", async () => {
    serve(room());
    render(<SpacePage spaceId={id} />);
    expect(
      await screen.findByText(/Automatic photo analysis is not available yet/),
    ).toBeVisible();
    expect(screen.getByText("Add a space fact")).toBeVisible();
    expect(screen.getByText("Add a measurement")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Load fictional observations" }),
    ).not.toBeInTheDocument();
  });
  it("renders a real photo gallery without raw storage keys", async () => {
    const s = room();
    s.assets = [
      {
        id: assetId,
        filename: "room.png",
        contentType: "image/png",
        byteSize: 100,
        url: `/api/spaces/${id}/assets/${assetId}`,
      },
    ];
    serve(s);
    render(<SpacePage spaceId={id} />);
    expect(
      await screen.findByAltText("Bedroom, uploaded view 1"),
    ).toHaveAttribute("src", s.assets[0]!.url);
    expect(screen.getByText("1 / 10 photos")).toBeVisible();
  });
  it("keeps proposed, confirmed and measured provenance distinct", async () => {
    const s = room();
    s.state.facts = [
      {
        id: factId,
        kind: "existing_item",
        label: "Bed",
        value: "King bed",
        basis: "visual_observation",
        origin: "photo_analysis",
        status: "proposed",
        sourceAssetIds: [assetId],
      },
      {
        id: "00000000-0000-4000-8000-000000000004",
        kind: "material",
        label: "Floor",
        value: "Oak",
        basis: "user_explicit",
        origin: "user",
        status: "confirmed",
        sourceAssetIds: [],
      },
    ];
    s.state.measurements = [
      {
        id: "00000000-0000-4000-8000-000000000005",
        label: "Desk wall width",
        amount: 214,
        unit: "cm",
        millimetres: 2140,
        basis: "user_measured",
      },
    ];
    serve(s);
    render(<SpacePage spaceId={id} />);
    expect(await screen.findByText("Proposed · not confirmed")).toBeVisible();
    expect(screen.getByText("Entered by you")).toBeVisible();
    expect(screen.getByText("Measured by you")).toBeVisible();
    expect(screen.getByText("214 cm")).toBeVisible();
  });
  it("labels fictional analysis, never claiming it read the uploaded photos", async () => {
    const s = room();
    s.analysisMode = "fictional_fixture";
    serve(s);
    render(<SpacePage spaceId={id} />);
    expect(
      await screen.findByText(/They do not describe or analyse these photos/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Load fictional observations" }),
    ).toBeDisabled();
  });
  it("shows design, inventory and explicit unknowns", async () => {
    const s = room();
    s.state.design = {
      ...s.state.design,
      goal: "A warmer bedroom",
      add: ["Rug"],
      palette: ["Cream"],
    };
    s.state.items = [
      { id: factId, label: "Bed", factId: null, intent: "keep" },
    ];
    s.state.unknowns = [
      {
        id: assetId,
        label: "Rug footprint",
        basis: "user_explicit",
        origin: "user",
        sourceAssetIds: [],
      },
    ];
    serve(s);
    render(<SpacePage spaceId={id} />);
    expect(
      await screen.findByRole("heading", { name: "Bedroom design" }),
    ).toBeVisible();
    expect(screen.getByText("Rug", { selector: "li" })).toBeVisible();
    expect(screen.getByLabelText("Plan for Bed")).toHaveValue("keep");
    expect(screen.getByText("Rug footprint")).toBeVisible();
  });
  it("submits measurements only as explicit user input with current revision", async () => {
    serve(room());
    render(<SpacePage spaceId={id} />);
    await screen.findByText("Add a measurement");
    const user = userEvent.setup();
    await user.click(screen.getByText("Add a measurement"));
    await user.type(
      screen.getByLabelText("Measurement label"),
      "Desk wall width",
    );
    await user.type(screen.getByLabelText("Value"), "214");
    await user.click(screen.getByRole("button", { name: "Save measurement" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({
      operation: "add_measurement",
      expectedRevision: 1,
      measurement: { label: "Desk wall width", amount: 214, unit: "cm" },
    });
  });
  it("keeps a failed stale edit visible and offers explicit reload", async () => {
    serve(room());
    render(<SpacePage spaceId={id} />);
    await screen.findByText("Add a space item");
    const user = userEvent.setup();
    await user.click(screen.getByText("Add a space item"));
    await user.type(screen.getByLabelText("Item name"), "Lamp");
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "stale_revision",
            message: "This room changed in another tab.",
          },
        }),
        { status: 409 },
      ),
    );
    await user.click(screen.getByRole("button", { name: "Add item" }));
    expect(
      await screen.findByRole("button", { name: "Reload latest space" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Item name")).toHaveValue("Lamp");
  });
  it("rejects unsupported upload selection with a clear error", async () => {
    serve(room());
    render(<SpacePage spaceId={id} />);
    const input = await screen.findByLabelText("Choose photos");
    fireEvent.change(input, {
      target: {
        files: [new File(["svg"], "photo.svg", { type: "image/svg+xml" })],
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose JPEG, PNG or WebP",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("requires a deliberate confirmation action for visual facts", async () => {
    const s = room();
    s.state.facts = [
      {
        id: factId,
        kind: "existing_item",
        label: "Bed",
        value: "King bed",
        basis: "visual_observation",
        origin: "photo_analysis",
        status: "proposed",
        sourceAssetIds: [assetId],
      },
    ];
    serve(s);
    render(<SpacePage spaceId={id} />);
    const region = await screen.findByRole("region", { name: "From photos" });
    await userEvent.click(
      within(region).getByRole("button", { name: "Confirm Bed" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({
      operation: "confirm_fact",
      expectedRevision: 1,
      factId,
    });
  });
  it("labels saved fictional proposals even with analysis now unavailable", async () => {
    const s = room();
    s.state.facts = [
      {
        id: factId,
        kind: "existing_item",
        label: "Bed",
        value: "King bed",
        origin: "fictional_fixture",
        basis: "visual_observation",
        status: "proposed",
        sourceAssetIds: [assetId],
      },
    ];
    serve(s);
    render(<SpacePage spaceId={id} />);
    expect(
      await screen.findByText(/1 source photo · Fictional fixture/),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Load fictional observations" }),
    ).not.toBeInTheDocument();
  });
});
