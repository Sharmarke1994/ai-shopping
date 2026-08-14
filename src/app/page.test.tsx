import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("Home", () => {
  it("identifies the foundation checkpoint without pretending the shopping UI exists", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", {
        name: "A better way to decide what to buy.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/fixture-driven shopping experience begins in V0-02/i),
    ).toBeInTheDocument();
  });
});
