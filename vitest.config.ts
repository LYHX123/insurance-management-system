import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // jsdom (not "node") so *.test.tsx component-rendering tests get a real
    // DOM (document/window) — the existing *.test.ts unit tests don't touch
    // those globals so they run unaffected under jsdom too.
    environment: "jsdom",
    include: ["src/**/__tests__/**/*.test.ts", "src/**/__tests__/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
    // Full-suite runs (106+ files) contend for CPU under jsdom's heavier
    // per-file setup; the default 5000ms per-test timeout is comfortably
    // enough for any single test in isolation but flakes under that
    // contention. Not related to this phase's changes — pre-existing since
    // the jsdom migration.
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
