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

    expect(screen.queryByText("Shortlist cleared")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Show me options now" }),
    );

    expect(
      screen.getByRole("heading", {
        name: /three caps that look genuinely light/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/added:/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText("Avoid a thick or structured crown"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/nike preferred/i)).not.toBeInTheDocument();
  });

  it("adds only the cap preference the shopper explicitly answers", () => {
    const { rerender } = render(<ShoppingPreview initialView="cap-question" />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "They feel too thick and substantial",
      }),
    );
    expect(
      screen.getByText("Avoid a thick or structured crown"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Ventilation matters most in hot weather"),
    ).not.toBeInTheDocument();

    rerender(<ShoppingPreview initialView="cap-question" key="heat-path" />);
    fireEvent.click(
      screen.getByRole("button", { name: "They trap too much heat" }),
    );
    expect(
      screen.getByText("Ventilation matters most in hot weather"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Avoid a thick or structured crown"),
    ).not.toBeInTheDocument();
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
    expect(screen.getByText("Saved 0")).toBeInTheDocument();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(
      "Nookline Three Tier set aside for this search.",
    );

    fireEvent.click(within(status).getByRole("button", { name: "Undo" }));
    expect(
      screen.getByRole("article", { name: "Nookline Three Tier" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Saved 1")).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("article", { name: "Nookline Three Tier" }),
      ).getByRole("button", { name: "Saved" }),
    ).toHaveAttribute("aria-pressed", "true");
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
      "The closest option under £25 was 54 × 28 cm. The first credible options inside 42 × 20 cm start at £36.",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Stretch the budget to £40" }),
    );
    expect(
      screen.getByRole("heading", {
        name: "The same narrow brief works once the budget reaches £40",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /dark open shelving under £40.*42 cm.*20 cm.*no wall fixing/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Maximum £40")).toBeInTheDocument();
    expect(
      screen.getByText("Maximum 42 × 20 cm footprint"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Freestanding; avoid wall fixing"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Maximum £25")).not.toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("dismisses a post-result question when skipped without hiding products", () => {
    render(<ShoppingPreview initialView="headphones-results" />);

    fireEvent.click(
      screen.getByRole("button", { name: "Show me options now" }),
    );

    expect(
      screen.queryByRole("heading", {
        name: /which compromise would bother you more/i,
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/changed:|kept:/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("dismisses a same-view post-result answer and shows its explicit effect", () => {
    render(<ShoppingPreview initialView="headphones-results" />);

    fireEvent.click(
      screen.getByRole("button", { name: "Hearing more of the train" }),
    );

    expect(
      screen.queryByRole("heading", {
        name: /which compromise would bother you more/i,
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Kept: stronger noise cancellation remains the lead preference.",
    );
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("does not pretend unrelated refinement text changed the shortlist", () => {
    render(<ShoppingPreview initialView="headphones-results" />);

    fireEvent.change(screen.getByLabelText("Refine this shortlist"), {
      target: { value: "Only show me blue headphones" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^update/i }));

    expect(screen.getByRole("status")).toHaveTextContent(
      /can only apply the prepared comfort-with-glasses refinement/i,
    );
    expect(
      screen.getByRole("heading", {
        name: /comfort-led options, with one priority still worth settling/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("applies the one declared free-text refinement", () => {
    render(<ShoppingPreview initialView="headphones-results" />);

    fireEvent.change(screen.getByLabelText("Refine this shortlist"), {
      target: { value: "comfort with glasses matters most" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^update/i }));

    expect(
      screen.getByRole("heading", {
        name: /comfort now leads; maximum noise cancellation comes second/i,
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

  it("resets a manual brief disclosure choice for a new search", () => {
    render(<ShoppingPreview initialView="shelving-results" />);

    const brief = screen.getByText("What matters").closest("details");
    expect(brief).not.toBeNull();
    expect(brief).toHaveAttribute("open");

    if (!brief) return;
    brief.open = false;
    fireEvent(brief, new Event("toggle", { bubbles: true }));
    expect(brief).not.toHaveAttribute("open");

    fireEvent.click(screen.getByRole("button", { name: "New search" }));
    fireEvent.click(
      screen.getByRole("button", { name: /make a small corner work/i }),
    );

    expect(screen.getByText("What matters").closest("details")).toHaveAttribute(
      "open",
    );
  });
});
