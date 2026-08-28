// @vitest-environment happy-dom
//
// First focused test for `src/app/lifecycle/handle-new-note.ts` — the "+ Add"
// / `N` handler. The smoke test creates a note, so the synchronous half had
// technically executed; the async half never had, and that is where all the
// hard parts are. This module is a fire-and-forget IIFE with four separate
// ways to bail out, and every one of them is a real scenario:
//
//   - **the preference snapshot is read once, before the await.** The comment
//     is explicit that a mid-flight Settings toggle must not half-fire one
//     prompt and skip another inside the same backfill. Reading it inside the
//     async closure instead would still pass a test that never toggles.
//   - **the race guard.** Geolocation can take seconds. If the user navigates
//     away and the empty draft is purged, `find` comes back undefined and the
//     patch must drop on the floor rather than resurrect a deleted note.
//   - **the no-op guard.** `applyFreshNoteDetails` returns the *same
//     reference* when it changed nothing, and the handler leans on that
//     identity check. A mutant that drops it costs a render and a persist on
//     every `+ Add` in an offline session.
//   - **empty drafts do not reach Drive.** The backfill persists locally
//     (the prettified title is a feature and survives a refresh) but only
//     schedules an autosave when the note is no longer an empty draft. A note
//     has no business arriving on Drive because geolocation resolved two
//     seconds after a click the user already regretted.
//
// `generateFreshNoteDetails` is mocked — it reaches geolocation, Nominatim
// and open-meteo, and has its own coverage. Everything else (`notebook`,
// `applyFreshNoteDetails`, `isLocationCaptureEnabled`) is real: all pure, all
// observable, and mocking them would leave the handler asserting itself.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SutraPadDocument, SutraPadWorkspace } from "../src/types";
import type { CaptureLocationPreference } from "../src/app/logic/capture-location";

const generateFreshNoteDetails = vi.hoisted(() => vi.fn());
vi.mock("../src/app/capture/fresh-note", () => ({ generateFreshNoteDetails }));

const { handleNewNoteCreation } = await import("../src/app/lifecycle/handle-new-note");
const { DEFAULT_NOTE_TITLE } = await import("../src/lib/notebook");

const DETAILS = {
  title: "Úterý odpoledne v Praze",
  location: "Praha",
  coordinates: { latitude: 50.08, longitude: 14.42 },
  captureContext: { source: "new-note" as const },
};

const EMPTY: SutraPadWorkspace = { notes: [], activeNoteId: null };

function harness(
  preference: CaptureLocationPreference = "on",
  initial: SutraPadWorkspace = EMPTY,
) {
  let workspace = initial;
  const calls: string[] = [];
  const spies = {
    setWorkspace: vi.fn((next: SutraPadWorkspace) => {
      workspace = next;
      calls.push("setWorkspace");
    }),
    setDetailNoteId: vi.fn((id: string | null) => calls.push(`setDetailNoteId:${id === null ? "null" : "id"}`)),
    setActiveMenuItem: vi.fn((id: string) => calls.push(`setActiveMenuItem:${id}`)),
    setSyncState: vi.fn((state: string) => calls.push(`setSyncState:${state}`)),
    setLastError: vi.fn((error: string) => calls.push(`setLastError:${JSON.stringify(error)}`)),
    persistWorkspace: vi.fn(() => calls.push("persistWorkspace")),
    scheduleAutoSave: vi.fn(() => calls.push("scheduleAutoSave")),
    rerenderPreservingActiveEditorFocus: vi.fn(() => calls.push("rerender")),
    getCaptureLocationPreference: vi.fn(() => preference),
  };
  const run = () =>
    handleNewNoteCreation({
      getWorkspace: () => workspace,
      ...spies,
    });
  return {
    ...spies,
    calls,
    run,
    get workspace() {
      return workspace;
    },
    /** Lets the caller replace the live workspace mid-flight, as a nav-away would. */
    set workspace(next: SutraPadWorkspace) {
      workspace = next;
    },
  };
}

/** Drains the handler's fire-and-forget promise chain. */
async function settle(): Promise<void> {
  // oxlint-disable-next-line no-await-in-loop -- sequential yields let one `.then` run per tick
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
}

const draftIn = (workspace: SutraPadWorkspace): SutraPadDocument | undefined =>
  workspace.notes.find((note) => note.id === workspace.activeNoteId);

beforeEach(() => {
  vi.clearAllMocks();
  generateFreshNoteDetails.mockResolvedValue(DETAILS);
});

describe("handleNewNoteCreation synchronous open", () => {
  it("creates the draft, opens it and clears any stale error", async () => {
    const app = harness();

    app.run();

    expect(app.workspace.notes).toHaveLength(1);
    expect(app.calls.slice(0, 6)).toEqual([
      // Persist before publishing to the store, so a crash between the two
      // leaves the note on disk rather than only in memory.
      "persistWorkspace",
      "setWorkspace",
      "setDetailNoteId:id",
      "setActiveMenuItem:notes",
      "setSyncState:idle",
      'setLastError:""',
    ]);
    await settle();
  });

  it("opens the new note, not whatever was selected before", async () => {
    const existing: SutraPadWorkspace = {
      notes: [
        {
          id: "n-old",
          title: "Stará",
          body: "text",
          urls: [],
          createdAt: "2026-01-01T08:00:00.000Z",
          updatedAt: "2026-01-01T08:00:00.000Z",
          tags: [],
        },
      ],
      activeNoteId: "n-old",
    };
    const app = harness("on", existing);

    app.run();

    const opened = app.setDetailNoteId.mock.calls[0]?.[0];
    expect(opened).not.toBe("n-old");
    expect(opened).toBe(app.workspace.activeNoteId);
    expect(app.workspace.notes).toHaveLength(2);
    await settle();
  });

  it("starts the draft on the placeholder title", async () => {
    // The backfill below only replaces the title while it is still this
    // exact placeholder, so the starting value is load-bearing.
    const app = harness();

    app.run();

    expect(draftIn(app.workspace)?.title).toBe(DEFAULT_NOTE_TITLE);
    await settle();
  });
});

describe("handleNewNoteCreation location preference", () => {
  it("lets the real resolver run when capture is on", async () => {
    const app = harness("on");

    app.run();
    await settle();

    // No override argument: `generateFreshNoteDetails` uses its own default
    // resolver, which is the one that prompts.
    expect(generateFreshNoteDetails).toHaveBeenCalledExactlyOnceWith();
  });

  it("suppresses the prompt but keeps the rest of the backfill when off", async () => {
    const app = harness("off");

    app.run();
    await settle();

    const [now, resolveCoordinates] = generateFreshNoteDetails.mock.calls[0] ?? [];
    expect(now).toBeUndefined();
    expect(await resolveCoordinates?.()).toBeNull();
    // The note still gets its title and capture context, just no place.
    expect(draftIn(app.workspace)?.title).toBe(DETAILS.title);
  });

  it("treats an undecided user as a suppressed prompt", async () => {
    // `"unanswered"` must behave like `"off"`, not like `"on"` — the consent
    // card takes over the asking job.
    const app = harness("unanswered");

    app.run();
    await settle();

    expect(await generateFreshNoteDetails.mock.calls[0]?.[1]?.()).toBeNull();
  });

  it("reads the preference once, before the first await", async () => {
    // A mid-flight Settings toggle must not change the decision inside a
    // backfill that already started.
    const app = harness("on");

    app.run();
    app.getCaptureLocationPreference.mockReturnValue("off");
    await settle();

    expect(app.getCaptureLocationPreference).toHaveBeenCalledOnce();
    expect(generateFreshNoteDetails).toHaveBeenCalledExactlyOnceWith();
  });

  it("re-reads the preference on the next click", async () => {
    // Read at click time, not at handler-construction time, so flipping the
    // Settings switch takes effect on the very next `+ Add`.
    let preference: CaptureLocationPreference = "off";
    let workspace = EMPTY;
    const options = {
      getWorkspace: () => workspace,
      setWorkspace: (next: SutraPadWorkspace) => {
        workspace = next;
      },
      setDetailNoteId: vi.fn(),
      setActiveMenuItem: vi.fn(),
      setSyncState: vi.fn(),
      setLastError: vi.fn(),
      persistWorkspace: vi.fn(),
      scheduleAutoSave: vi.fn(),
      rerenderPreservingActiveEditorFocus: vi.fn(),
      getCaptureLocationPreference: () => preference,
    };

    handleNewNoteCreation(options);
    await settle();
    expect(generateFreshNoteDetails.mock.calls[0]).toHaveLength(2);

    preference = "on";
    handleNewNoteCreation(options);
    await settle();

    expect(generateFreshNoteDetails.mock.calls[1]).toHaveLength(0);
  });
});

describe("handleNewNoteCreation backfill", () => {
  it("patches the draft with the resolved title, place and context", async () => {
    const app = harness();

    app.run();
    await settle();

    expect(draftIn(app.workspace)).toMatchObject({
      title: DETAILS.title,
      location: "Praha",
      coordinates: DETAILS.coordinates,
      captureContext: { source: "new-note" },
    });
  });

  it("renders through the focus-preserving pass, not the atom subscriber", async () => {
    // Letting `setWorkspace`'s queued microtask render instead rebuilds the
    // editor card and drops the caret out of whatever the user is typing —
    // the exact bug this shape exists to avoid.
    const app = harness();

    app.run();
    await settle();

    expect(app.rerenderPreservingActiveEditorFocus).toHaveBeenCalledOnce();
    // And it lands last, after the workspace and the local persist.
    expect(app.calls.at(-1)).toBe("rerender");
  });

  it("persists the patch locally so a mid-compose refresh keeps the nice title", async () => {
    const app = harness();

    app.run();
    await settle();

    expect(app.persistWorkspace).toHaveBeenCalledTimes(2);
    expect(app.setWorkspace).toHaveBeenCalledTimes(2);
  });

  it("does not push an empty draft to Drive", async () => {
    // Geolocation resolving two seconds after a click the user regretted is
    // not a reason to create a permanent cloud artefact.
    const app = harness();

    app.run();
    await settle();

    expect(app.scheduleAutoSave).not.toHaveBeenCalled();
  });

  it("does schedule a save once the draft has real content", async () => {
    const app = harness();
    app.run();
    const draftId = app.workspace.activeNoteId;
    // The user typed while geolocation was still in flight.
    app.workspace = {
      ...app.workspace,
      notes: app.workspace.notes.map((note) =>
        note.id === draftId ? { ...note, body: "něco jsem napsal" } : note,
      ),
    };

    await settle();

    expect(app.scheduleAutoSave).toHaveBeenCalledOnce();
  });
});

describe("handleNewNoteCreation bail-outs", () => {
  it("drops the patch when the draft was purged while geolocation ran", async () => {
    // Nav-away purges the empty draft. Re-inserting it here would resurrect
    // a note the user already walked away from.
    const app = harness();
    app.run();
    app.workspace = EMPTY;

    await settle();

    expect(app.workspace).toBe(EMPTY);
    expect(app.setWorkspace).toHaveBeenCalledOnce();
    expect(app.rerenderPreservingActiveEditorFocus).not.toHaveBeenCalled();
  });

  it("patches the draft it created, not whatever sorts to the top", async () => {
    // The lookup is by id, and every other fixture here happens to put the
    // fresh draft first (notes sort by `updatedAt` desc). A note stamped in
    // the future outranks it — and then "find the first note" and "find my
    // note" are two different notes, with the second one's place label
    // landing on someone else's entry.
    const newer: SutraPadDocument = {
      id: "n-newer",
      title: "Novější",
      body: "text",
      urls: [],
      createdAt: "2099-01-01T08:00:00.000Z",
      updatedAt: "2099-01-01T08:00:00.000Z",
      tags: [],
    };
    const app = harness("on", { notes: [newer], activeNoteId: "n-newer" });

    app.run();
    const draftId = app.workspace.activeNoteId;
    expect(app.workspace.notes[0]?.id).toBe("n-newer");
    await settle();

    expect(draftIn(app.workspace)?.id).toBe(draftId);
    expect(draftIn(app.workspace)?.location).toBe("Praha");
    // The bystander keeps its own title and gains nothing.
    const bystander = app.workspace.notes.find((note) => note.id === "n-newer");
    expect(bystander?.title).toBe("Novější");
    expect(bystander?.location).toBeUndefined();
  });

  it("skips the render when the backfill changed nothing", async () => {
    // `applyFreshNoteDetails` returns the same reference for a no-op, and
    // the handler's identity check is what turns that into a skipped render
    // and a skipped persist.
    const app = harness();
    generateFreshNoteDetails.mockResolvedValue({ title: DEFAULT_NOTE_TITLE });

    app.run();
    await settle();

    expect(app.setWorkspace).toHaveBeenCalledOnce();
    expect(app.persistWorkspace).toHaveBeenCalledOnce();
    expect(app.rerenderPreservingActiveEditorFocus).not.toHaveBeenCalled();
  });

  it("survives a rejected backfill and leaves the draft usable", async () => {
    // Denied permission, a network blip, an aborted probe — the note keeps
    // its placeholder title and lives on.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = harness();
    const failure = new Error("permission denied");
    generateFreshNoteDetails.mockRejectedValue(failure);

    app.run();
    await settle();

    expect(draftIn(app.workspace)?.title).toBe(DEFAULT_NOTE_TITLE);
    expect(app.rerenderPreservingActiveEditorFocus).not.toHaveBeenCalled();
    // Logged, so the silent skip is at least visible in devtools.
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "Fresh note detail backfill failed:",
      failure,
    );
    warn.mockRestore();
  });

  it("never takes the no-id early return, because the notebook always sets one", async () => {
    // `if (!newNoteId) return` is unreachable today: `createNewNoteWorkspace`
    // sets `activeNoteId` to the note it just built. Asserting the invariant
    // rather than the guard means this test starts failing — and the guard
    // wakes up — if the notebook layer ever stops guaranteeing it.
    const { createNewNoteWorkspace } = await import("../src/lib/notebook");

    expect(createNewNoteWorkspace(EMPTY).activeNoteId).toEqual(expect.any(String));

    const app = harness();
    app.run();
    await settle();

    expect(generateFreshNoteDetails).toHaveBeenCalledOnce();
  });
});
