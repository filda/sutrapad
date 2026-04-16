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
    },
  },
});
