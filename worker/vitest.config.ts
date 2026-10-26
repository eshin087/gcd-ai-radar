import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** The Worker's tests live with the site's under tests/worker and test the pure functions only. */
export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  test: {
    include: ["tests/worker/**/*.test.ts"],
    environment: "node",
  },
});
