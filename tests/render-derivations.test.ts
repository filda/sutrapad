// @vitest-environment happy-dom
//
// Tests for `src/app/logic/render-derivations.ts` — the four value
// derivations extracted out of `renderAppPage` on 2026-08-29.
//
// `tests/render-app.test.ts` already covers their *effects* through the
// router (which page got the persona options, how the chip is styled, what
// the crumb says). It passed unchanged across the extraction, which is what
// proved the move was behaviour-preserving. This file covers the same four
// functions directly, and earns its place by reaching the cases the router
// cannot cheaply set up:
//
//   - **`auto` theme resolution**, which needs a stubbed `matchMedia` rather
//     than a concrete theme id.
//   - **the `tasks:*` facet correction** for a placeholder note whose body is
//     not resident — the one auto-tag facet that cannot be derived from a
//     summary, and the reason the task index is threaded in at all.
//   - **the crumb's day boundary**, which needs two frozen clocks.
//
// Everything here is pure, so there is no DOM to build and no fake to apply.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAutoTagLookup,
  deriveRenderPersonaOptions,
  deriveSyncCrumb,
  deriveTopbarNote,
} from "../src/app/logic/render-derivations";
import { buildNoteSummary } from "../src/lib/note-card-meta";
import { buildTaskIndex } from "../src/lib/tasks";
import type {
  SutraPadDocument,
  SutraPadTaskIndex,
  SutraPadWorkspace,
  UserProfile,
} from "../src/types";

const NOW = new Date("2026-04-21T10:00:00.000Z");

const PROFILE: UserProfile = {
  name: "Filip",
  email: "f@example.com",
  picture: "",
};

const note = (overrides: Partial<SutraPadDocument> = {}): SutraPadDocument => ({
  id: "n-1",
  title: "První",
  body: "tělo",
  urls: [],
  createdAt: "2026-04-21T08:00:00.000Z",
  updatedAt: "2026-04-21T08:00:00.000Z",
  tags: ["praha"],
  ...overrides,
});

const workspaceOf = (notes: SutraPadDocument[]): SutraPadWorkspace => ({
  notes,
  activeNoteId: notes[0]?.id ?? null,
});

const summariesOf = (workspace: SutraPadWorkspace) =>
  workspace.notes.map((entry) => buildNoteSummary(entry));

/** Stubs `matchMedia` so the `auto` theme resolves to a known answer. */
function stubPrefersDark(matches: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      media: "(prefers-color-scheme: dark)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("deriveRenderPersonaOptions", () => {
  const summaries = summariesOf(workspaceOf([note(), note({ id: "n-2" })]));

  it("stays undefined for the opted-out user", () => {
    // `undefined`, not an object with `allNotes: []` — the view layer treats
    // the absence as "render flat cards", and an empty object would turn the
    // persona layer on with no population to drive it.
    expect(
      deriveRenderPersonaOptions({
        personaPreference: "off",
        currentTheme: "sand",
        noteSummaries: summaries,
      }),
    ).toBeUndefined();
  });

  it("hands over the whole population for the opted-in user", () => {
    // Recurrence stickers need to see how often a place or topic repeats, so
    // the population is every summary, not the filtered list.
    const options = deriveRenderPersonaOptions({
      personaPreference: "on",
      currentTheme: "sand",
      noteSummaries: summaries,
    });

    expect(options?.allNotes).toHaveLength(2);
    expect(options?.allNotes.map((entry) => entry.id)).toEqual(["n-1", "n-2"]);
  });

  it("rebuilds documents from the summaries rather than passing them through", () => {
    // The summaries are index rows, not notes; the persona derivation wants
    // documents. Body-less is fine — it reads tags and facets only.
    const options = deriveRenderPersonaOptions({
      personaPreference: "on",
      currentTheme: "sand",
      noteSummaries: summaries,
    });

    expect(options?.allNotes[0]).toMatchObject({ id: "n-1", tags: ["praha"] });
    expect(options?.allNotes[0]).not.toBe(summaries[0]);
  });

  it("classifies each concrete theme as light or dark", () => {
    const classified = (
      ["sand", "paper", "parchment", "dark", "midnight", "parchment-dark"] as const
    ).map((currentTheme) => {
      const options = deriveRenderPersonaOptions({
        personaPreference: "on",
        currentTheme,
        noteSummaries: summaries,
      });
      return `${currentTheme}: ${options?.dark}`;
    });

    expect(classified).toEqual([
      "sand: false",
      "paper: false",
      "parchment: false",
      "dark: true",
      "midnight: true",
      "parchment-dark: true",
    ]);
  });

  it("resolves an auto theme against the OS preference", () => {
    // This is why the resolution happens per render rather than at
    // preference-write time: the session can outlive a system light/dark
    // switch, and the next re-render has to re-paper the cards.
    stubPrefersDark(true);
    expect(
      deriveRenderPersonaOptions({
        personaPreference: "on",
        currentTheme: "auto",
        noteSummaries: summaries,
      })?.dark,
    ).toBe(true);

    stubPrefersDark(false);
    expect(
      deriveRenderPersonaOptions({
        personaPreference: "on",
        currentTheme: "auto",
        noteSummaries: summaries,
      })?.dark,
    ).toBe(false);
  });

  it("copes with an empty notebook", () => {
    const options = deriveRenderPersonaOptions({
      personaPreference: "on",
      currentTheme: "sand",
      noteSummaries: [],
    });

    expect(options).toEqual({ allNotes: [], dark: false });
  });
});

describe("buildAutoTagLookup", () => {
  it("collects the derived tags and leaves the user's own out", () => {
    // The lookup exists to tell a chip "you are derived"; a user tag in it
    // would render `#praha` in the auto style.
    const workspace = workspaceOf([note()]);
    const lookup = buildAutoTagLookup(workspace, buildTaskIndex(workspace), NOW);

    expect(lookup.has("praha")).toBe(false);
    expect([...lookup].every((tag) => tag.includes(":"))).toBe(true);
    expect(lookup.has("year:2026")).toBe(true);
  });

  it("takes the tasks facet from the index, not the body", () => {
    // The one facet that needs a note's body. A placeholder note (Phase 2
    // resident model) has none, so the index supplies it — reading the body
    // here would report `tasks:none` for a note that has open work.
    const withTasks = note({ id: "t-1", body: "- [ ] jedna\n- [ ] dva" });
    const workspace = workspaceOf([withTasks]);
    const taskIndex = buildTaskIndex(workspace);
    // Same index, but the note arrives body-less — as it does after a
    // summaries-only load.
    const placeholder = workspaceOf([{ ...withTasks, body: "" }]);

    const fromBody = buildAutoTagLookup(workspace, taskIndex, NOW);
    const fromIndex = buildAutoTagLookup(placeholder, taskIndex, NOW);

    expect(fromBody.has("tasks:open")).toBe(true);
    expect(fromIndex.has("tasks:open")).toBe(true);
    expect(fromIndex.has("tasks:none")).toBe(false);
  });

  it("reports no open tasks when the index says so", () => {
    const workspace = workspaceOf([note()]);
    const lookup = buildAutoTagLookup(workspace, buildTaskIndex(workspace), NOW);

    expect(lookup.has("tasks:none")).toBe(true);
    expect(lookup.has("tasks:open")).toBe(false);
  });

  it("dates the tags from the clock it is given", () => {
    // The `now` parameter is injectable so the caller (and this test) can pin
    // "today" without touching globals; the router passes the real clock.
    const workspace = workspaceOf([note({ createdAt: "2026-04-21T08:00:00.000Z" })]);
    const taskIndex = buildTaskIndex(workspace);

    const sameDay = buildAutoTagLookup(workspace, taskIndex, NOW);
    const muchLater = buildAutoTagLookup(
      workspace,
      taskIndex,
      new Date("2027-04-21T10:00:00.000Z"),
    );

    expect(sameDay.has("date:today")).toBe(true);
    expect(muchLater.has("date:today")).toBe(false);
  });

  it("defaults to the current clock", () => {
    const workspace = workspaceOf([note({ createdAt: NOW.toISOString() })]);

    expect(buildAutoTagLookup(workspace, buildTaskIndex(workspace)).has("date:today")).toBe(
      true,
    );
  });

  it("returns an empty set for an empty notebook", () => {
    const empty: SutraPadWorkspace = { notes: [], activeNoteId: null };
    const emptyIndex = buildTaskIndex(empty) satisfies SutraPadTaskIndex;

    expect([...buildAutoTagLookup(empty, emptyIndex, NOW)]).toEqual([]);
  });
});

describe("deriveTopbarNote", () => {
  const current = note({ id: "current" });

  it("prefers the note that matched", () => {
    const matched = note({ id: "matched" });

    expect(
      deriveTopbarNote({
        note: matched,
        currentNote: current,
        selectedTagFilters: ["praha"],
      }),
    ).toBe(matched);
  });

  it("falls back to the active note when nothing is filtered", () => {
    expect(
      deriveTopbarNote({ note: null, currentNote: current, selectedTagFilters: [] }),
    ).toBe(current);
  });

  it("describes nothing when a filter matched nothing", () => {
    // Showing the active note's last-edit time here would be a lie about what
    // is on screen — the editor is displaying an empty state, not that note.
    expect(
      deriveTopbarNote({
        note: null,
        currentNote: current,
        selectedTagFilters: ["nic"],
      }),
    ).toBeNull();
  });

  it("keeps the matched note even when several filters are active", () => {
    const matched = note({ id: "matched" });

    expect(
      deriveTopbarNote({
        note: matched,
        currentNote: current,
        selectedTagFilters: ["praha", "cesty"],
      }),
    ).toBe(matched);
  });
});

describe("deriveSyncCrumb", () => {
  it("says synced for a signed-in user", () => {
    const crumb = deriveSyncCrumb(note({ updatedAt: "2026-04-21T09:30:00.000Z" }), PROFILE);

    expect(crumb).toContain("synced");
    expect(crumb).not.toContain("local");
  });

  it("says local for a drafter", () => {
    // Nothing has left the device, so "synced" would be untrue.
    const crumb = deriveSyncCrumb(note({ updatedAt: "2026-04-21T09:30:00.000Z" }), null);

    expect(crumb).toContain("local");
    expect(crumb).not.toContain("synced");
  });

  it("appends the date once the edit is no longer today", () => {
    const today = deriveSyncCrumb(note({ updatedAt: "2026-04-21T09:30:00.000Z" }), PROFILE);
    const earlier = deriveSyncCrumb(note({ updatedAt: "2026-04-18T09:30:00.000Z" }), PROFILE);

    expect(earlier).not.toBe(today);
    expect((earlier ?? "").length).toBeGreaterThan((today ?? "").length);
  });

  it("has nothing to say without a note", () => {
    expect(deriveSyncCrumb(null, PROFILE)).toBeNull();
    expect(deriveSyncCrumb(null, null)).toBeNull();
  });
});
