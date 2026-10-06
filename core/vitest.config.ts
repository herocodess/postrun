import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Source tests only: the compiled copies in dist/ would otherwise run twice.
    include: ["src/**/*.test.ts"],
  },
});
