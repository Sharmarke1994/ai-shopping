import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

Object.defineProperty(window, "scrollTo", {
  configurable: true,
  value: vi.fn(),
  writable: true,
});
