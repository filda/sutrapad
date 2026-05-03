// @ts-check

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: "vitest",
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.vitest.json",
  mutate: [
    // Pure-logic / DOM-free modules — the original mutation surface.
    "src/lib/**/*.ts",
    "src/app/logic/**/*.ts",
    "src/app/storage/**/*.ts",
    "src/app/session/**/*.ts",
    "src/app/capture/**/*.ts",

    // Services. The facade re-exports from `drive/client` and
    // `drive/workspace-store`; tests import via the facade and
    // vitest's related-test resolver picks both up transitively.
    // `drive/lexicon-store.ts` has no dedicated test yet, so it
    // stays out — mutants there would all be coverage-free
    // survivors and would tank the score artificially.
    "src/services/google-auth.ts",
    "src/services/drive-store.ts",
    "src/services/drive/client.ts",
    "src/services/drive/workspace-store.ts",

    // Lifecycle wiring with a dedicated test (`lifecycle-palette`).
    // The remaining lifecycle modules (capture-import, handle-new-note,
    // keyboard-shortcuts) only have indirect coverage via the smoke test
    // and are deferred until they get focused tests.
    "src/app/lifecycle/palette.ts",

    // View modules with dedicated happy-dom tests. Each file below has
    // a `tests/<name>.test.ts` whose `// @vitest-environment happy-dom`
    // pragma makes it run in a real DOM. Other view files are still
    // excluded — they only render through `create-app-smoke.test.ts`,
    // which is too coarse to discriminate mutants.
    "src/app/view/chrome/mobile-nav.ts",
    "src/app/view/pages/links-page.ts",
    "src/app/view/pages/privacy-page.ts",
    "src/app/view/pages/tasks-page.ts",
    "src/app/view/shared/link-thumb.ts",
    "src/app/view/shared/notes-list.ts",

    // Exclusions.
    // `*.d.ts` — declaration-only, no executable code to mutate.
    // `lexicon/stoplist.ts` — frozen Czech-stopword Set, pure data; mutating
    //   string literals here generates dozens of meaningless survivors.
    //   See `project_sutrapad_mutation_gaps.md` (auto-memory): excluding
    //   this is expected to lift overall by ~+3.34 pp by removing noise.
    // `lexicon/types.ts` — type-only module, no runtime code.
    "!src/**/*.d.ts",
    "!src/app/logic/lexicon/stoplist.ts",
    "!src/app/logic/lexicon/types.ts",
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
