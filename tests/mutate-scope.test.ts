// Guard against the failure mode that hid 42 % of `src/` from mutation
// testing until 2026-08-17: a new module lands, nobody adds it to
// `stryker.config.mjs`, and the overall score keeps looking healthy because
// the file simply isn't measured.
//
// AGENTS.md already says "new source files are not done until they're under
// mutation pressure". This turns that sentence into a failing test, and adds
// the two traps we walked into while widening the scope:
//
//   1. a file listed in `mutate:` whose only test `vi.mock`s it (that was
//      `view/palette.ts` — 166 mutants, all NoCoverage, score 0.00 %);
//   2. a stale explicit path left behind by a rename.
//
// Adding a module to `DEFERRED_FROM_MUTATION` is a legitimate answer — it
// just has to be a deliberate one with a reason, visible in review.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// `stryker.config.mjs` is plain JS with JSDoc types and ships no `.d.ts`, so
// `tsc` can't resolve a type for it. Reading the config itself is the point of
// this suite — a copy of the pattern list here would drift from the real one.
// @ts-expect-error -- untyped .mjs config import
import strykerConfig from "../stryker.config.mjs";

const SRC_ROOT = "src";

/**
 * Modules deliberately left outside the mutate scope, each with the reason.
 * Anything here is a promise, not a parking lot: the entry should disappear
 * once the module gets a focused test.
 */
const DEFERRED_FROM_MUTATION: Readonly<Record<string, string>> = {
  "src/app.ts": "composition root; only the smoke test touches it",
  "src/main.ts": "bootstrap entry point; no seams to assert against yet",
  "src/types.ts": "type declarations only",
  "src/fonts.ts": "static font registration",
  "src/app/silent-capture-runner.ts": "background runner; needs a focused test first",
  "src/app/lifecycle/capture-import.ts": "only covered via the smoke test",
  "src/app/lifecycle/handle-new-note.ts": "only covered via the smoke test",
  "src/app/lifecycle/keyboard-shortcuts.ts":
    "tests/keyboard-shortcuts.test.ts covers src/lib/keyboard-shortcuts.ts, not this module",
  "src/app/lifecycle/drag-drop-import.ts": "only covered via the smoke test",
  "src/app/lifecycle/notes-endless-scroll.ts": "thin wiring over logic/endless-scroll",
  "src/app/view/render-app.ts": "largest untested surface; decision-heavy logic should move out first",
  "src/app/view/palette.ts": "lifecycle-palette.test.ts vi.mocks it — zero real coverage",
  "src/app/view/palette-types.ts": "type declarations only",
  "src/app/view/pages/about-page.ts": "static copy page; no dedicated test yet",
  "src/app/view/pages/placeholder-page.ts": "static stub",
  "src/app/view/pages/shortcuts-page.ts": "static copy page; no dedicated test yet",
  "src/app/view/pages/terms-page.ts": "static copy page; no dedicated test yet",
  "src/app/view/chrome/topbar.ts": "no dedicated test yet",
  "src/app/view/shared/editor-sidebar.ts": "no dedicated test yet",
  "src/app/view/shared/hint-banner.ts": "no dedicated test yet",
  "src/app/view/shared/icons.ts": "icon path data; asserted indirectly by its consumers",
  "src/app/view/update-notification.ts": "no dedicated test yet",
  "src/services/drive/lexicon-store.ts":
    "lexicon-page.test.ts imports only its type, so mutants would be coverage-free",
};

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

/**
 * Minimal glob matcher for the `**` / `*` patterns the config uses. `/**\/`
 * matches zero or more directory levels, so `src/lib/**\/*.ts` covers both
 * `src/lib/store.ts` and `src/lib/nested/store.ts` — the same semantics
 * Stryker's own matcher gives them.
 */
function matches(pattern: string, file: string): boolean {
  const escaped = pattern.replaceAll(/[.+^${}()|[\]\\]/gu, String.raw`\$&`);
  const source = escaped
    .replaceAll("/**/", "/(?:.*/)?")
    .replaceAll("**", ".*")
    .replaceAll("*", "[^/]*")
    // The zero-level replacement above leaves `(?:.*/)?` with its `*`
    // rewritten; restore that one group.
    .replaceAll("(?:[^/]*/)?", "(?:.*/)?");
  return new RegExp(`^${source}$`, "u").test(file);
}

// The config is plain `.mjs`, so its shape arrives untyped here.
const patterns = (strykerConfig.mutate ?? []) as string[];
const includes = patterns.filter((pattern) => !pattern.startsWith("!"));
const excludes = patterns
  .filter((pattern) => pattern.startsWith("!"))
  .map((pattern) => pattern.slice(1));

/** True when a `!` pattern in the config names this file — a decision on record. */
function isExplicitlyExcluded(file: string): boolean {
  return excludes.some((pattern) => matches(pattern, file));
}

function isInScope(file: string): boolean {
  if (isExplicitlyExcluded(file)) return false;
  return includes.some((pattern) => matches(pattern, file));
}

const sourceFiles = walk(SRC_ROOT).filter((file) => !file.endsWith(".d.ts"));
const testSources = fs
  .readdirSync("tests")
  .filter((name) => name.endsWith(".ts"))
  .map((name) => ({ name, body: fs.readFileSync(path.posix.join("tests", name), "utf8") }));

/**
 * Modules a test executes without importing their path directly. The Drive
 * store is the case: `services/drive-store.ts` re-exports the concrete
 * classes and the suites import the facade, which is exactly the plumbing the
 * app uses too.
 */
const EXECUTED_VIA: Readonly<Record<string, string>> = {
  "src/services/drive/preferences-store.ts":
    "drive-preferences-store.test.ts imports GoogleDrivePreferencesStore through the src/services/drive-store facade",
};

/** Test files that import the module at runtime — not as a type, not mocked. */
function runtimeImporters(file: string): string[] {
  const specifier = `../${file.replace(/\.ts$/u, "")}`;
  return testSources
    .filter(({ body }) => {
      const lines = body.split("\n");
      const referencing = lines.filter((line) => line.includes(`"${specifier}"`));
      if (referencing.length === 0) return false;
      // `import type { X } from …` and `vi.mock("…")` both leave the module
      // unexecuted, so neither counts as coverage.
      return referencing.some(
        (line) => !line.includes("import type") && !line.includes("vi.mock("),
      );
    })
    .map(({ name }) => name);
}

describe("stryker mutate scope covers every source module", () => {
  it("classifies every src/**/*.ts as either mutated or explicitly deferred", () => {
    const unclassified = sourceFiles.filter(
      (file) =>
        !isInScope(file) &&
        !isExplicitlyExcluded(file) &&
        !(file in DEFERRED_FROM_MUTATION),
    );

    // A new module has to be a decision, and there are three legitimate ones:
    // it falls under a `mutate:` glob, it carries a `!` exclusion in
    // stryker.config.mjs (pure data / types), or it is listed in
    // DEFERRED_FROM_MUTATION above with a reason. Silently unmeasured is the
    // single option this test removes.
    expect(unclassified).toEqual([]);
  });

  it("keeps the deferred list free of modules that are already mutated", () => {
    const stale = Object.keys(DEFERRED_FROM_MUTATION).filter((file) => isInScope(file));
    expect(stale).toEqual([]);
  });

  it("keeps the deferred list free of modules that no longer exist", () => {
    const missing = Object.keys(DEFERRED_FROM_MUTATION).filter(
      (file) => !sourceFiles.includes(file),
    );
    expect(missing).toEqual([]);
  });

  it("gives every deferred module a reason", () => {
    const reasonless = Object.entries(DEFERRED_FROM_MUTATION)
      .filter(([, reason]) => reason.trim().length < 10)
      .map(([file]) => file);
    expect(reasonless).toEqual([]);
  });
});

describe("stryker mutate scope stays honest", () => {
  it("lists no explicit path that has been renamed away", () => {
    const explicit = includes.filter((pattern) => !pattern.includes("*"));
    const missing = explicit.filter((file) => !fs.existsSync(file));
    expect(missing).toEqual([]);
  });

  it("keeps the indirect-execution map limited to modules that are in scope", () => {
    const stale = Object.keys(EXECUTED_VIA).filter((file) => !isInScope(file));
    expect(stale).toEqual([]);
  });

  it("only mutates explicitly-listed modules that a test actually executes", () => {
    // The `view/palette.ts` lesson: `lifecycle-palette.test.ts` imports it and
    // `vi.mock`s it, so every one of its 166 mutants came back NoCoverage and
    // the file scored 0.00 %. A type-only import has the same effect.
    const explicit = includes.filter((pattern) => !pattern.includes("*"));
    const unexecuted = explicit.filter(
      (file) => runtimeImporters(file).length === 0 && !(file in EXECUTED_VIA),
    );
    expect(unexecuted).toEqual([]);
  });
});
