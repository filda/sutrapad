import { describe, expect, it, vi } from "vitest";
import { runLocationBackfill } from "../src/app/lifecycle/run-location-backfill";
import type { FreshNoteDetails } from "../src/app/capture/apply-fresh-note-details";
import { createNote, createWorkspace } from "../src/lib/notebook";
import type { SutraPadDocument, SutraPadWorkspace } from "../src/types";

/**
 * `runLocationBackfill` is the second-pass backfill the consent card
 * runs after the user clicks "Allow" on a draft that already received
 * its first-pass title + capture-context backfill. The helper takes a
 * full workspace mutator harness (so the test doesn't need to spin up
 * `state-store`), and the integration risk is in three places:
 *
 *   1. The title must NOT be rewritten — `applyFreshNoteDetails` gates
 *      the title overwrite on `DEFAULT_NOTE_TITLE` being intact, and
 *      after the first-pass backfill it isn't.
 *   2. The status return must match what actually happened (the
 *      consent card branches on it).
 *   3. The mutator chain must fire: `setWorkspace`, `persistWorkspace`,
 *      `scheduleAutoSave`, `rerenderPreservingActiveEditorFocus`.
 */

const DRAFT_ID = "draft-id";
const PRE_BACKFILLED_TITLE = "5/12/2026 · afternoon";

function buildDraft(
  overrides: Partial<SutraPadDocument> = {},
): SutraPadDocument {
  return {
    ...createNote(PRE_BACKFILLED_TITLE),
    id: DRAFT_ID,
    ...overrides,
  };
}

function buildWorkspaceWithDraft(
  draft: SutraPadDocument = buildDraft(),
): SutraPadWorkspace {
  // Hand-build the workspace shape rather than going through
  // `upsertNote` — the helper only patches existing notes and there's
  // no "append on missing" branch we can lean on. Two notes, draft
  // active, mirrors the post-`+ Add` shape `handleNewNoteCreation`
  // leaves the store in.
  return {
    ...createWorkspace(),
    notes: [draft],
    activeNoteId: draft.id,
  };
}

const PRAGUE_DETAILS: FreshNoteDetails = {
  title: "5/12/2026 · afternoon · Prague",
  location: "Prague",
  coordinates: { latitude: 50.0755, longitude: 14.4378 },
  captureContext: { source: "new-note" },
};

const NO_COORDS_DETAILS: FreshNoteDetails = {
  title: "5/12/2026 · afternoon",
  // No `location`, no `coordinates` — geolocation resolved null.
  captureContext: { source: "new-note" },
};

function buildHarness(
  initial: SutraPadWorkspace = buildWorkspaceWithDraft(),
  generateDetails: () => Promise<FreshNoteDetails> = () => Promise.resolve(PRAGUE_DETAILS),
): {
  options: Parameters<typeof runLocationBackfill>[0];
  getWorkspace: () => SutraPadWorkspace;
  spies: {
    setWorkspace: ReturnType<typeof vi.fn>;
    persistWorkspace: ReturnType<typeof vi.fn>;
    scheduleAutoSave: ReturnType<typeof vi.fn>;
    rerender: ReturnType<typeof vi.fn>;
  };
} {
  let workspace = initial;
  const setWorkspace = vi.fn((next: SutraPadWorkspace) => {
    workspace = next;
  });
  const persistWorkspace = vi.fn();
  const scheduleAutoSave = vi.fn();
  const rerender = vi.fn();
  return {
    options: {
      noteId: DRAFT_ID,
      getWorkspace: () => workspace,
      setWorkspace,
      persistWorkspace,
      scheduleAutoSave,
      rerenderPreservingActiveEditorFocus: rerender,
      generateDetails,
    },
    getWorkspace: () => workspace,
    spies: {
      setWorkspace,
      persistWorkspace,
      scheduleAutoSave,
      rerender,
    },
  };
}

describe("runLocationBackfill", () => {
  it("fills location and coordinates on the existing draft and reports 'filled'", async () => {
    const harness = buildHarness();
    await expect(runLocationBackfill(harness.options)).resolves.toBe("filled");

    const patched = harness
      .getWorkspace()
      .notes.find((note) => note.id === DRAFT_ID);
    expect(patched?.location).toBe("Prague");
    expect(patched?.coordinates).toEqual({
      latitude: 50.0755,
      longitude: 14.4378,
    });
  });

  it("leaves the pre-existing title untouched (does not rebuild it with the place suffix)", async () => {
    // The first-pass backfill already produced `"5/12/2026 · afternoon"`.
    // The second pass must NOT clobber it back to a freshly-rebuilt
    // string that includes the place — that would erase any in-flight
    // user edits to the title since the first pass ran.
    const harness = buildHarness();
    await runLocationBackfill(harness.options);

    const patched = harness
      .getWorkspace()
      .notes.find((note) => note.id === DRAFT_ID);
    expect(patched?.title).toBe(PRE_BACKFILLED_TITLE);
  });

  it("invokes the mutator chain once on success", async () => {
    const harness = buildHarness();
    await runLocationBackfill(harness.options);
    expect(harness.spies.setWorkspace).toHaveBeenCalledTimes(1);
    expect(harness.spies.persistWorkspace).toHaveBeenCalledTimes(1);
    expect(harness.spies.scheduleAutoSave).toHaveBeenCalledTimes(1);
    expect(harness.spies.rerender).toHaveBeenCalledTimes(1);
  });

  it("returns 'no-coords' and skips the mutator chain when geolocation resolves null", async () => {
    const harness = buildHarness(undefined, () => Promise.resolve(NO_COORDS_DETAILS));
    await expect(runLocationBackfill(harness.options)).resolves.toBe(
      "no-coords",
    );
    expect(harness.spies.setWorkspace).not.toHaveBeenCalled();
    expect(harness.spies.persistWorkspace).not.toHaveBeenCalled();
    expect(harness.spies.scheduleAutoSave).not.toHaveBeenCalled();
    expect(harness.spies.rerender).not.toHaveBeenCalled();
  });

  it("returns 'no-coords' when the details producer throws (and logs the specific failure prefix)", async () => {
    // `generateFreshNoteDetails` shouldn't throw in production (each
    // leg has its own try/catch) but if something genuinely surprising
    // bubbles up, the helper must not crash the consent flow. The
    // status falls through to `"no-coords"` so the card resets and
    // the user can retry. The console.warn prefix is the only hint a
    // dev gets in the field, so pin it — a Stryker mutation that
    // empties the literal must surface here.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const harness = buildHarness(undefined, () => {
      throw new Error("kaboom");
    });
    await expect(runLocationBackfill(harness.options)).resolves.toBe(
      "no-coords",
    );
    expect(harness.spies.setWorkspace).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "Location backfill failed:",
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it("returns 'draft-missing' when the noteId has been purged from the workspace", async () => {
    // Active draft purged (user navigated away → empty-draft sweep
    // removed it) between the consent click and the backfill resolving.
    const harness = buildHarness(createWorkspace());
    await expect(runLocationBackfill(harness.options)).resolves.toBe(
      "draft-missing",
    );
    expect(harness.spies.setWorkspace).not.toHaveBeenCalled();
  });

  it("returns 'filled' as a no-op when every slot is already populated on the draft", async () => {
    // User had typed something or a prior backfill already populated
    // every slot `applyFreshNoteDetails` knows how to fill (title is
    // already non-default; location, coordinates, captureContext all
    // present). `applyFreshNoteDetails` returns the same reference
    // and the helper short-circuits without touching the workspace.
    const harness = buildHarness(
      buildWorkspaceWithDraft(
        buildDraft({
          location: "Old place",
          coordinates: { latitude: 1, longitude: 2 },
          captureContext: { source: "new-note" },
        }),
      ),
    );
    await expect(runLocationBackfill(harness.options)).resolves.toBe("filled");
    expect(harness.spies.setWorkspace).not.toHaveBeenCalled();
    expect(harness.spies.rerender).not.toHaveBeenCalled();
    // The pre-existing data must survive.
    const patched = harness
      .getWorkspace()
      .notes.find((note) => note.id === DRAFT_ID);
    expect(patched?.location).toBe("Old place");
  });
});
