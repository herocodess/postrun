import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests import @postrun/core straight from its TypeScript source, so they never depend on
// core/dist having been built (it isn't, on a fresh clone).
const core = fileURLToPath(new URL("../../core/src/", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@postrun\/core\/server\/api$/, replacement: `${core}server/api.ts` },
      { find: /^@postrun\/core\/(report|schema|store|export)$/, replacement: `${core}$1/index.ts` },
    ],
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
