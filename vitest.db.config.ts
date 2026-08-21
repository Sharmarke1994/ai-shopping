import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDirectory = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDirectory, "src"),
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    globalSetup: ["./tests/database/global-setup.ts"],
    include: ["tests/database/**/*.test.ts"],
  },
});
