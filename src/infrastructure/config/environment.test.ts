import { describe, expect, it } from "vitest";
import {
  requireDatabaseEnvironment,
  requireMigrationEnvironment,
  requireOpenAIEnvironment,
  requireTestDatabaseEnvironment,
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

  it("keeps migration configuration service-scoped", () => {
    expect(
      requireMigrationEnvironment({
        DIRECT_DATABASE_URL:
          "postgresql://localhost:5432/ai-shopping-migrations",
      }),
    ).toEqual({
      DIRECT_DATABASE_URL: "postgresql://localhost:5432/ai-shopping-migrations",
    });
  });

  it("accepts only a visibly test-specific integration database", () => {
    expect(
      requireTestDatabaseEnvironment({
        TEST_DATABASE_URL: "postgresql://localhost:5432/ai_shopping_test",
      }),
    ).toEqual({
      TEST_DATABASE_URL: "postgresql://localhost:5432/ai_shopping_test",
    });
    expect(() =>
      requireTestDatabaseEnvironment({
        TEST_DATABASE_URL: "postgresql://localhost:5432/ai_shopping",
      }),
    ).toThrow(/test-only/);
  });

  it("rejects non-PostgreSQL URLs for database services", () => {
    expect(() =>
      requireDatabaseEnvironment({ DATABASE_URL: "https://example.com/db" }),
    ).toThrow(/PostgreSQL/);
  });
});
