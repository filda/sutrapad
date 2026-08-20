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

    // App-level wiring with a dedicated test. `state-store.ts` got
    // `tests/state-store.test.ts` on 2026-08-19 — route/preference seeding,
    // the workspace→indexes subscription, every persist subscriber, dispose,
    // and the `renderingAtoms` contract — which is what promoted it out of
    // `DEFERRED_FROM_MUTATION`. Of its siblings only `silent-capture-runner.ts`
    // is still smoke-test-only. `render-callbacks.ts` followed
    // on 2026-08-19 with `tests/render-callbacks.test.ts` — the callback bag
    // is a pure function of its 35 injected callbacks, so every handler is
    // reachable with spies; the `replace*` fakes apply the updater they get
    // so the writer closures are asserted too, not just call counts.
    "src/app/state-store.ts",
    "src/app/render-callbacks.ts",
    // `sync-helpers.ts` / `render-helpers.ts` promoted the same day. Both were
    // already executed indirectly by `render-callbacks.test.ts` (URL writes,
    // focus-preserving renders); the dedicated suites add the branches no
    // handler reaches — the stale `?view=` strip and the "wrote nothing"
    // early outs in sync-helpers, the hero-title / outside-the-editor focus
    // paths in render-helpers.
    "src/app/sync-helpers.ts",
    "src/app/render-helpers.ts",

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
    // 2026-08-19: `tag-filter-bar.ts` and `capture-page.ts` promoted with
    // dedicated suites. Both were smoke-test-only, and in both cases the
    // smoke pass only ever saw one state — the filter bar never focused
    // (so its dropdown and the whole keyboard contract never ran) and the
    // capture page never switched platform.
    // 2026-08-19, fourth batch: the chrome that frames the static pages.
    // `account-bar` is the one with real behaviour — a click-toggled menu
    // whose outside-click listener is registered in the capture phase
    // *during* the opening click, and removed again on close because the
    // topbar is rebuilt on most state changes.
    "src/app/view/chrome/account-bar.ts",
    "src/app/view/chrome/site-footer.ts",
    "src/app/view/chrome/static-page-shell.ts",
    "src/app/view/chrome/tag-filter-bar.ts",
    // 2026-08-20: `topbar.ts` and `hint-banner.ts` — the two files in the
    // small-chrome batch with real behaviour (the rest of it is static copy
    // pages). The topbar's own logic is the slot order, the `add` skip in the
    // nav loop and the sync pill's two metadata channels; everything else it
    // renders now belongs to a module with its own suite. `hint-banner.ts`
    // rotates a dismissible hint through localStorage: impressions are
    // recorded *before* the builder runs, so a throwing builder still
    // advances the rotation instead of wedging on one hint forever.
    "src/app/view/chrome/topbar.ts",
    "src/app/view/shared/hint-banner.ts",
    // Same batch, the two remaining non-copy files. `editor-sidebar.ts` is
    // mostly composition, but it owns the per-tag confidence lookup that puts
    // the `NN%` badge on a `weather:*` pill and leaves `year:*` clean — and a
    // guard that turns out to be unreachable (see the comment in the file:
    // `deriveAutoTags` always emits a `tasks:*` facet, so the auto card can
    // never be empty). `update-notification.ts` had never executed at all —
    // the smoke test never has a waiting service worker — and its `setBusy`
    // has to be reversible or a failed reload strands the user on a disabled
    // "Reloading…" button.
    "src/app/view/shared/editor-sidebar.ts",
    "src/app/view/update-notification.ts",
    "src/app/view/pages/capture-page.ts",
    // `tags-page.ts` + `empty-state.ts` followed the same day. The Tags page
    // has four states the smoke test never reaches (first-run, no-selection,
    // filtered-with-matches, filtered-with-nothing) and three stacked
    // narrowing mechanisms; `empty-state.ts` carries the copy table both of
    // them render. NB `empty-state.ts` holds ~350 lines of hand-tuned SVG
    // path data behind a `// Stryker disable all` comment in the file — data,
    // not logic, same call as the `lexicon/stoplist.ts` exclusion below.
    "src/app/view/pages/tags-page.ts",
    "src/app/view/shared/empty-state.ts",
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
    // 2026-08-19, third batch: the shared primitives every page composes.
    // `tag-pill` and `page-header` were the two files the deferred list
    // excused as "asserted indirectly" — six suites executed them and none
    // asserted a hue, an element type or the intro-fade counter. `kind-chip`
    // joined them: it deliberately mutates itself in place instead of
    // rebuilding (the editor must not lose caret state), which nothing else
    // could observe.
    "src/app/view/shared/kind-chip.ts",
    "src/app/view/shared/page-header.ts",
    "src/app/view/shared/tag-pill.ts",
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
    // Ratcheted 2026-08-19 (third pass) from 85/88/90, now that the condition
    // the previous note set is met: **no file in scope is under 80 %** any
    // more. `active-page` was the last one at 78.1 %, and it got there by
    // deleting redundant guards rather than by adding tests — every arm of its
    // funnel returned `DEFAULT_MENU_ITEM`, so the branches were unkillable by
    // construction (78.1 → 97.9 with one new test and two guards gone).
    //
    // The day's other work: eight previously unmeasured modules promoted into
    // scope with dedicated suites (state-store, render-callbacks,
    // sync-helpers, render-helpers, tag-filter-bar, capture-page, tags-page,
    // empty-state) and capture-context lifted 84.7 → 96.1. Scope is 117 files.
    //
    // Composite overall: **93.9 %**. That number is arithmetic — the
    // 2026-08-17 full run plus every focused re-measurement since, not a fresh
    // end-to-end run. The method is trustworthy: the 2026-08-18 nightly
    // reported 92.18 % against a 92.20 % estimate for the same commit. The
    // nightly `Daily Mutation Testing` workflow stays the confirmation; if it
    // reports materially lower, walk `break` back rather than leaving CI red.
    //
    // `break: 88` keeps ~6 pp of headroom (run-to-run drift is well under
    // 1 pp). `low: 90` puts a yellow warning just below the current level,
    // `high: 92` stays reachable without being permanent-green.
    //
    // Next ratchet wants the two remaining 80–85 % files (workspace-io 81.3,
    // note-primary-url 83.3) and the last big unmeasured modules
    // (`view/render-app.ts` 939 LOC, `silent-capture-runner.ts` 552) — the
    // latter will *lower* the overall when promoted, so ratchet after that,
    // not before. See `project_sutrapad_mutation_2026_08.md` (auto-memory).
    high: 92,
    low: 90,
    break: 88,
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
