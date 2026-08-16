import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    globalSetup: ["./tests/database/global-setup.ts"],
    include: ["tests/database/**/*.test.ts"],
  },
});
