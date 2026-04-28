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
    high: 85,
    low: 70,
    break: 65,
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
