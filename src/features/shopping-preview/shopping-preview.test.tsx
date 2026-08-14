import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShoppingPreview } from "./shopping-preview";

describe("ShoppingPreview", () => {
  it("states the prepared-journey limit instead of pretending arbitrary input was searched", () => {
    render(<ShoppingPreview initialView="landing" />);

    fireEvent.change(screen.getByLabelText("What are you looking for?"), {
      target: { value: "Find me a toaster" },
    });
    fireEvent.click(screen.getByRole("button", { name: /start looking/i }));

    expect(
      screen.getByText(/this design prototype uses prepared journeys/i),
    ).toBeInTheDocument();
  });

  it("allows a worthwhile question to be skipped without inventing an answer", () => {
    render(<ShoppingPreview initialView="cap-question" />);

    fireEvent.click(
      screen.getByRole("button", { name: "Show me options now" }),
    );

    expect(
      screen.getByRole("heading", {
        name: /three caps that look genuinely light/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/added:/i)).not.toBeInTheDocument();
  });

  it("supports a zero-question exact lookup", () => {
    render(<ShoppingPreview initialView="exact-results" />);

    expect(
      screen.getByRole("heading", { name: "The exact model you asked for" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Worth asking")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Refine this shortlist"),
    ).not.toBeInTheDocument();
  });

  it("keeps save and conservative rejection as separate reversible actions", () => {
    render(<ShoppingPreview initialView="shelving-results" />);

    const firstCard = screen.getByRole("article", {
      name: "Nookline Three Tier",
    });
    fireEvent.click(within(firstCard).getByRole("button", { name: "Save" }));
    expect(screen.getByText("Saved 1")).toBeInTheDocument();

    fireEvent.click(
      within(firstCard).getByRole("button", { name: "Not for me" }),
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(
      "Nookline Three Tier set aside for this search.",
    );

    fireEvent.click(within(status).getByRole("button", { name: "Undo" }));
    expect(
      screen.getByRole("article", { name: "Nookline Three Tier" }),
    ).toBeInTheDocument();
  });

  it("shows an intentional no-credible-match state with a refinement path", () => {
    render(<ShoppingPreview initialView="no-matches" />);

    expect(
      screen.getByRole("heading", {
        name: /nothing we'd confidently put in front of you yet/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("article")).toHaveLength(0);

    fireEvent.click(
      screen.getByRole("button", { name: "Show closest dimensions" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "The closest credible unit is 54 × 28 cm—12 cm wider and 8 cm deeper than your limit.",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Stretch the budget to £40" }),
    );
    expect(
      screen.getByRole("heading", {
        name: "Slim shelving without the visual weight",
      }),
    ).toBeInTheDocument();
  });

  it("keeps a saved item while applying a prepared refinement", () => {
    render(<ShoppingPreview initialView="headphones-results" />);

    const hushArc = screen.getByRole("article", { name: "Hush Arc One" });
    fireEvent.click(within(hushArc).getByRole("button", { name: "Save" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Pressure around my glasses" }),
    );

    expect(
      screen.getByRole("heading", {
        name: /comfort now leads; maximum noise cancellation comes second/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Saved 1")).toBeInTheDocument();
    expect(
      within(screen.getByRole("article", { name: "Hush Arc One" })).getByRole(
        "button",
        { name: "Saved" },
      ),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("renders missing imagery and partial evidence deliberately", () => {
    render(<ShoppingPreview initialView="degraded-results" />);

    expect(screen.getByText("Image unavailable")).toBeInTheDocument();
    expect(
      screen.getByText(/some sources could not be reached/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/clamp pressure remains unknown/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      screen.getByRole("heading", {
        name: /comfort-led options, with one priority still worth settling/i,
      }),
    ).toBeInTheDocument();
  });

  it("lets a shopper remove and restore a line in what matters", () => {
    render(<ShoppingPreview initialView="shelving-results" />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove No more than 60 cm wide from the preview brief",
      }),
    );
    expect(
      screen.queryByText("No more than 60 cm wide"),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Undo removing “No more than 60 cm wide”",
      }),
    );
    expect(screen.getByText("No more than 60 cm wide")).toBeInTheDocument();
  });
});
