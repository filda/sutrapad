// @ts-check

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: "vitest",
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.vitest.json",
  mutate: [
    "src/lib/**/*.ts",
    "src/app/logic/**/*.ts",
    "src/app/storage/**/*.ts",
    "src/app/session/**/*.ts",
    "src/app/capture/**/*.ts",
    "!src/**/*.d.ts",
  ],
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: {
    fileName: "reports/mutation/mutation.html",
  },
  jsonReporter: {
    // Stryker's standard mutation-testing JSON schema (mutationtestingelementsschema.json).
    // One file per run; rewritten on each `stryker run`. Use this for
    // programmatic analysis — html is for humans.
    fileName: "reports/mutation/mutation.json",
  },
  thresholds: {
    // Ratcheted 2026-04-28 after persona pass (55 → 84 %) lifted
    // overall from 77.6 % to 81.25 %. New `break: 75` leaves
    // ~6 pp headroom — small regressions still pass, but a slip back
    // to pre-pass levels (~77 %) now fails CI instead of sliding by
    // unnoticed. `low: 78` lets the warning band hug the actual
    // current floor more tightly so a dip toward 78 % surfaces as
    // yellow before turning red. Hold `high: 85` until the cheap
    // notebook-persona leftovers and the next batch
    // (capture-context-sanitize.ts, og-image.ts, theme.ts) land —
    // see `project_sutrapad_mutation_gaps.md` (auto-memory) for the
    // sequenced plan.
    high: 85,
    low: 78,
    break: 75,
  },
  vitest: {
    configFile: "vitest.config.ts",
    related: true,
  },
  typescriptChecker: {
    prioritizePerformanceOverAccuracy: true,
  },
};

export default config;
