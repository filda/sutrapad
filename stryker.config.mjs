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
    "src/services/drive/preferences-store.ts",
    "src/services/drive/workspace-store.ts",

    // Lifecycle wiring with a dedicated test (`lifecycle-palette`).
    // The remaining lifecycle modules (capture-import, handle-new-note,
    // keyboard-shortcuts, drag-drop-import, notes-endless-scroll) only have
    // indirect coverage via the smoke test and are deferred until they get
    // focused tests. NB `tests/keyboard-shortcuts.test.ts` covers
    // `src/lib/keyboard-shortcuts.ts`, not the lifecycle module of the same
    // name — don't promote the latter on the strength of that filename.
    "src/app/lifecycle/palette.ts",
    "src/app/lifecycle/focus-refresh.ts",
    "src/app/lifecycle/hydrate-note-on-open.ts",
    "src/app/lifecycle/run-location-backfill.ts",

    // View modules with dedicated happy-dom tests. Each file below has
    // a `tests/<name>.test.ts` whose `// @vitest-environment happy-dom`
    // pragma makes it run in a real DOM. Other view files are still
    // excluded — they only render through `create-app-smoke.test.ts`,
    // which is too coarse to discriminate mutants.
    //
    // 2026-08-16: promoted every remaining view module that a test imports at
    // runtime, on the principle that an unmeasured file is worse than a
    // low-scoring one — 42 % of `src/` used to sit outside this list and
    // contributed nothing to the overall score. Files whose only coverage is
    // `create-app-smoke.test.ts` (notably `src/app.ts`, `render-app.ts`,
    // `render-callbacks.ts`, `state-store.ts`, `silent-capture-runner.ts`)
    // stay out until they get focused tests, and `src/services/drive/
    // lexicon-store.ts` stays out because `lexicon-page.test.ts` only
    // imports its *type*.
    // `src/app/view/palette.ts` — NOT in scope. `lifecycle-palette.test.ts`
    //   imports it but `vi.mock`s the whole module, so the real code never
    //   runs: a 2026-08-17 measurement put it at 0.00 % with all 166 mutants
    //   NoCoverage. "A test imports it" is not the promotion bar — check for
    //   `vi.mock` first.
    "src/app/view/chrome/app-fab.ts",
    "src/app/view/chrome/mobile-nav.ts",
    "src/app/view/pages/home-page.ts",
    // `lexicon-page.ts` had a narrow regression test for the save-status
    //   rerender bug; the typeahead UI, import card, retry-load and candidate
    //   picker still lack dedicated coverage. Promoted anyway so the gap is
    //   visible in the report instead of hidden — if it turns out to drag the
    //   overall too far, exclude it again with the measured number in hand.
    "src/app/view/pages/lexicon-page.ts",
    "src/app/view/pages/links-page.ts",
    "src/app/view/pages/notes-page.ts",
    "src/app/view/pages/privacy-page.ts",
    "src/app/view/pages/settings-page.ts",
    "src/app/view/pages/tasks-page.ts",
    "src/app/view/shared/card-header.ts",
    "src/app/view/shared/detail-stage-persona.ts",
    "src/app/view/shared/detail-topbar.ts",
    "src/app/view/shared/editor-card.ts",
    "src/app/view/shared/inline.ts",
    "src/app/view/shared/link-thumb.ts",
    "src/app/view/shared/location-consent-card.ts",
    "src/app/view/shared/microphone-consent-card.ts",
    "src/app/view/shared/notes-list.ts",
    "src/app/view/shared/page-title.ts",
    "src/app/view/shared/persona-decor.ts",
    "src/app/view/shared/tag-input.ts",

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
    // Loosened 2026-08-17 — deliberately, and temporarily.
    //
    // The mutate scope grew from 101 to 110 files that day (see the view
    // block above). On the old scope the suite measured 90.8 %; with the
    // newly-promoted pages included the same suite measures **83.1 %**.
    // Nothing got worse — the score finally covers ~9 000 mutants of view
    // code that used to be invisible. Keeping `break: 80` would leave
    // barely 3 pp of headroom, so the gate drops to 78 and the warning
    // band to 80 while the promoted pages get real tests.
    //
    // The deferred work, worst first (measured 2026-08-17):
    //   notes-page 22.9 % · lexicon-page 27.4 % · settings-page 28.4 %
    //   home-page 40.8 % · detail-topbar 55.1 % · persona-decor 57.1 %
    // Every one of those has a test file that asserts structure but almost
    // no behaviour — that's the gap, not the promotion.
    //
    // Ratchet back to `break 82 / low 85 / high 88` once those six clear
    // ~80 % each; the rest of the suite is already there (38 files at
    // 100 %, workspace-store 92.0 %, notes-list 97.3 %). See
    // `project_sutrapad_mutation_2026_08.md` (auto-memory) for the map.
    high: 85,
    low: 80,
    break: 78,
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
