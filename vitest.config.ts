import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    typecheck: {
      tsconfig: "./tsconfig.vitest.json",
    },
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      // Exclude code that cannot reasonably be unit tested without a DOM:
      // bootstrap shim, vite ambient types, and the DOM renderer. Logic that
      // used to live in these files should be extracted into src/app/logic
      // or src/lib and tested there.
      exclude: [
        "src/main.ts",
        "src/vite-env.d.ts",
        "src/app/view/**",
        "src/app.ts",
      ],
      // Ratchet thresholds — set just below current values so regressions fail CI.
      // Raise these whenever the baseline climbs.
      thresholds: {
        statements: 75,
        branches: 67,
        functions: 77,
        lines: 75,
      },
    },
  },
});
