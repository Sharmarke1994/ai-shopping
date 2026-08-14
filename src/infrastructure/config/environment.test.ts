import { describe, expect, it } from "vitest";
import {
  requireDatabaseEnvironment,
  requireOpenAIEnvironment,
} from "./environment";

describe("service-scoped environment validation", () => {
  it("does not require unrelated credentials", () => {
    expect(
      requireOpenAIEnvironment({ OPENAI_API_KEY: "test-openai-key" }),
    ).toEqual({ OPENAI_API_KEY: "test-openai-key" });
  });

  it("fails clearly when the requested service secret is absent", () => {
    expect(() => requireOpenAIEnvironment({})).toThrow();
  });

  it("accepts valid database configuration independently", () => {
    expect(
      requireDatabaseEnvironment({
        DATABASE_URL: "postgresql://localhost:5432/ai-shopping",
      }),
    ).toEqual({
      DATABASE_URL: "postgresql://localhost:5432/ai-shopping",
    });
  });
});
