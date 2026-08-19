import { defineConfig } from "vitest/config";

/**
 * Vitest auto-enables its `github-actions` reporter whenever `GITHUB_ACTIONS`
 * is set, and that reporter appends a markdown job summary on every run. Under
 * Stryker vitest runs once per mutant — ~9 700 times on this repo — so those
 * appends pile up past GitHub's 1 MB `$GITHUB_STEP_SUMMARY` cap and the
 * mutation job finishes with a red "upload aborted" annotation even though the
 * run itself succeeded (seen on the 2026-08-18 nightly: 1 188k).
 *
 * Inside a Stryker worker the per-mutant summary has no audience anyway, so pin
 * the plain reporter there. `STRYKER_MUTATOR_WORKER` is set on every worker
 * process by `@stryker-mutator/core` (child-process-proxy), which makes it a
 * reliable "am I a mutant run?" marker. The regular test job keeps its
 * annotations.
 */
const UNDER_STRYKER = process.env.STRYKER_MUTATOR_WORKER !== undefined;

export default defineConfig({
  // The three `__APP_*` globals are injected by `vite.config.ts` via its own
  // `define` block at build/dev time. Vitest does NOT inherit the Vite
  // config's `define` — tests run through vite-node, not the build pipeline
  // — so any test that imports a module which references these globals (most
  // notably `src/app.ts`'s `formatBuildStamp` call) would otherwise crash
  // with `__APP_VERSION__ is not defined`. Stable string stubs are fine
  // here: no test cares about the *value*, only that the reference
  // resolves. If a future test asserts on the build stamp specifically,
  // override locally with `vi.stubGlobal`.
  define: {
    __APP_VERSION__: JSON.stringify("0.0.0-test"),
    __APP_BUILD_TIME__: JSON.stringify("2026-01-01T00:00:00.000Z"),
    __APP_COMMIT_HASH__: JSON.stringify("test"),
  },
  test: {
    ...(UNDER_STRYKER ? { reporters: ["default"] } : {}),
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
        statements: 82,
        branches: 76,
        functions: 84,
        lines: 82,
      },
    },
  },
});
