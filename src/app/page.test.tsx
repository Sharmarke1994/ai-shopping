import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("Home", () => {
  it("renders the fixture-driven consumer landing without pretending a search occurred", async () => {
    const page = await Home({ searchParams: Promise.resolve({}) });
    render(page);

    expect(
      screen.getByRole("heading", {
        name: "Find the thing that fits your life—not just your search.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/fictional products and prepared journeys/i),
    ).toBeInTheDocument();
  });

  it("falls back to the landing for an inherited object key", async () => {
    const page = await Home({
      searchParams: Promise.resolve({ fixture: "toString" }),
    });
    render(page);

    expect(
      screen.getByRole("heading", {
        name: "Find the thing that fits your life—not just your search.",
      }),
    ).toBeInTheDocument();
  });
});
