import { describe, expect, it } from "vitest";
import {
  AUTO_FADE_AFTER,
  emptyIntroEntry,
  getIntroEntry,
  isIntroCollapsed,
  loadIntroStore,
  persistIntroStore,
  recordVisit,
  resetAllPageIntros,
  toggleIntroCollapse,
  type IntroEntry,
  type IntroStore,
} from "../src/app/logic/page-intro";

/**
 * In-memory Storage stand-in. Same pattern as `visible-tag-classes.test.ts`.
 * Only the methods the module actually calls are implemented; everything
 * else stays out of the test surface.
 */
function createStorage(initial: Record<string, string> = {}): Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
> {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

const STORAGE_KEY = "sp.intros.v1";

describe("AUTO_FADE_AFTER", () => {
  it("matches the v3 prototype's threshold so dismiss memory survives the port", () => {
    // Hard-coded so a future bump shows up in this test as a deliberate
    // change rather than silently shifting when users see the fade.
    expect(AUTO_FADE_AFTER).toBe(10);
  });
});

describe("emptyIntroEntry", () => {
  it("starts with zero visits, not dismissed, not pinned", () => {
    expect(emptyIntroEntry()).toEqual({
      visits: 0,
      dismissed: false,
      pinned: false,
    });
  });

  it("returns a fresh object each call (no shared mutable template)", () => {
    const a = emptyIntroEntry();
    const b = emptyIntroEntry();
    a.visits = 99;
    expect(b.visits).toBe(0);
  });
});

describe("getIntroEntry", () => {
  it("returns the stored entry when present", () => {
    const stored: IntroEntry = { visits: 5, dismissed: true, pinned: false };
    const store: IntroStore = { tags: stored };
    expect(getIntroEntry(store, "tags")).toBe(stored);
  });

  it("returns a zero entry for an unknown page-id", () => {
    expect(getIntroEntry({}, "tasks")).toEqual(emptyIntroEntry());
  });
});

describe("recordVisit", () => {
  it("creates a fresh entry with visits=1 on first visit", () => {
    const next = recordVisit({}, "notes");
    expect(next.notes).toEqual({ visits: 1, dismissed: false, pinned: false });
  });

  it("increments an existing entry's visit count", () => {
    const start: IntroStore = {
      notes: { visits: 4, dismissed: true, pinned: true },
    };
    const next = recordVisit(start, "notes");
    expect(next.notes).toEqual({ visits: 5, dismissed: true, pinned: true });
  });

  it("doesn't touch other pages' entries", () => {
    const start: IntroStore = {
      notes: { visits: 2, dismissed: false, pinned: false },
      tags: { visits: 7, dismissed: true, pinned: false },
    };
    const next = recordVisit(start, "notes");
    expect(next.tags).toEqual(start.tags);
  });

  it("does not mutate the input store", () => {
    const start: IntroStore = {
      notes: { visits: 1, dismissed: false, pinned: false },
    };
    const snapshot: IntroStore = JSON.parse(JSON.stringify(start));
    recordVisit(start, "notes");
    expect(start).toEqual(snapshot);
  });
});

describe("isIntroCollapsed", () => {
  it("expands a freshly-visited entry", () => {
    expect(isIntroCollapsed({ visits: 1, dismissed: false, pinned: false })).toBe(
      false,
    );
  });

  it("expands an entry that has been visited exactly the threshold count", () => {
    // visits === AUTO_FADE_AFTER must still render expanded — the strict
    // greater-than means the fade kicks in on the *next* visit, not this one.
    expect(
      isIntroCollapsed({
        visits: AUTO_FADE_AFTER,
        dismissed: false,
        pinned: false,
      }),
    ).toBe(false);
  });

  it("collapses an entry one past the threshold", () => {
    expect(
      isIntroCollapsed({
        visits: AUTO_FADE_AFTER + 1,
        dismissed: false,
        pinned: false,
      }),
    ).toBe(true);
  });

  it("collapses on dismiss regardless of visit count", () => {
    expect(isIntroCollapsed({ visits: 0, dismissed: true, pinned: false })).toBe(
      true,
    );
  });

  it("dismiss wins even when the entry is pinned", () => {
    // Re-dismissing a pinned intro is a deliberate user action; the pin
    // only prevents the *auto* fade, not the manual one.
    expect(isIntroCollapsed({ visits: 99, dismissed: true, pinned: true })).toBe(
      true,
    );
  });

  it("expands a high-visit entry that the user pinned", () => {
    expect(
      isIntroCollapsed({
        visits: AUTO_FADE_AFTER + 50,
        dismissed: false,
        pinned: true,
      }),
    ).toBe(false);
  });

  it("respects noAutoFade by skipping the visit-count rule", () => {
    expect(
      isIntroCollapsed(
        { visits: AUTO_FADE_AFTER + 1, dismissed: false, pinned: false },
        { noAutoFade: true },
      ),
    ).toBe(false);
  });

  it("noAutoFade does not override an explicit dismiss", () => {
    expect(
      isIntroCollapsed(
        { visits: 1, dismissed: true, pinned: false },
        { noAutoFade: true },
      ),
    ).toBe(true);
  });

  it("empty options object defaults to applying the auto-fade rule", () => {
    expect(
      isIntroCollapsed(
        { visits: AUTO_FADE_AFTER + 1, dismissed: false, pinned: false },
        {},
      ),
    ).toBe(true);
  });
});

describe("toggleIntroCollapse", () => {
  it("dismisses an entry that's currently expanded", () => {
    const start: IntroStore = {
      notes: { visits: 3, dismissed: false, pinned: false },
    };
    const next = toggleIntroCollapse(start, "notes", false);
    expect(next.notes.dismissed).toBe(true);
    expect(next.notes.pinned).toBe(false);
  });

  it("expanding an entry pins it so auto-fade won't re-collapse it", () => {
    const start: IntroStore = {
      notes: { visits: AUTO_FADE_AFTER + 5, dismissed: true, pinned: false },
    };
    const next = toggleIntroCollapse(start, "notes", true);
    expect(next.notes.dismissed).toBe(false);
    expect(next.notes.pinned).toBe(true);
  });

  it("re-dismissing a pinned entry preserves the pin", () => {
    // Once expanded post-fade, the pin is sticky. Subsequent dismiss does
    // not clear it — a future expand should not need to re-set the pin.
    const start: IntroStore = {
      notes: { visits: 99, dismissed: false, pinned: true },
    };
    const next = toggleIntroCollapse(start, "notes", false);
    expect(next.notes).toEqual({ visits: 99, dismissed: true, pinned: true });
  });

  it("creates a new entry for an unknown page-id", () => {
    const next = toggleIntroCollapse({}, "tasks", false);
    expect(next.tasks).toEqual({ visits: 0, dismissed: true, pinned: false });
  });

  it("does not mutate the input store", () => {
    const start: IntroStore = {
      notes: { visits: 1, dismissed: false, pinned: false },
    };
    const snapshot: IntroStore = JSON.parse(JSON.stringify(start));
    toggleIntroCollapse(start, "notes", false);
    expect(start).toEqual(snapshot);
  });

  it("doesn't touch other pages' entries when toggling one", () => {
    const start: IntroStore = {
      notes: { visits: 1, dismissed: false, pinned: false },
      tags: { visits: 4, dismissed: true, pinned: true },
    };
    const next = toggleIntroCollapse(start, "notes", false);
    expect(next.tags).toEqual(start.tags);
  });
});

describe("loadIntroStore", () => {
  it("returns an empty store on first run (slot empty)", () => {
    expect(loadIntroStore(createStorage())).toEqual({});
  });

  it("returns an empty store when the slot contains invalid JSON", () => {
    expect(
      loadIntroStore(createStorage({ [STORAGE_KEY]: "not-json{" })),
    ).toEqual({});
  });

  it("returns an empty store when the parsed shape isn't an object", () => {
    // Anything other than `{...}` (arrays, primitives, null) is treated as
    // tampered storage — recover silently rather than throwing.
    expect(loadIntroStore(createStorage({ [STORAGE_KEY]: "[]" }))).toEqual({});
    expect(loadIntroStore(createStorage({ [STORAGE_KEY]: "42" }))).toEqual({});
    expect(
      loadIntroStore(createStorage({ [STORAGE_KEY]: '"hello"' })),
    ).toEqual({});
    expect(loadIntroStore(createStorage({ [STORAGE_KEY]: "null" }))).toEqual({});
  });

  it("parses a well-formed store", () => {
    const stored: IntroStore = {
      notes: { visits: 3, dismissed: false, pinned: false },
      tags: { visits: 12, dismissed: true, pinned: true },
    };
    expect(
      loadIntroStore(createStorage({ [STORAGE_KEY]: JSON.stringify(stored) })),
    ).toEqual(stored);
  });

  it("drops entries that fail the structural guard", () => {
    // The good entry survives even when a sibling is corrupt — partial
    // recovery beats throwing the whole store away over a single key.
    const raw = JSON.stringify({
      notes: { visits: 3, dismissed: false, pinned: false },
      bad: { visits: "lots", dismissed: false, pinned: false },
      partial: { visits: 1 },
      negative: { visits: -1, dismissed: false, pinned: false },
    });
    expect(
      loadIntroStore(createStorage({ [STORAGE_KEY]: raw })),
    ).toEqual({
      notes: { visits: 3, dismissed: false, pinned: false },
    });
  });

  it("drops entries whose value is null (not an object)", () => {
    // An entry slot can be tampered with into a null literal; the structural
    // guard's `value === null` short-circuit must drop it instead of letting
    // the typeof-check follow on a null pointer.
    const raw = JSON.stringify({ notes: null });
    expect(loadIntroStore(createStorage({ [STORAGE_KEY]: raw }))).toEqual({});
  });

  it("drops entries whose value is a primitive (string / number / boolean)", () => {
    // The typeof check rejects everything that isn't an object. Test each
    // primitive flavour so the guard's typeof branch can't be no-op'd.
    const raw = JSON.stringify({
      stringy: "morning",
      numeric: 42,
      truthy: true,
    });
    expect(loadIntroStore(createStorage({ [STORAGE_KEY]: raw }))).toEqual({});
  });

  it("drops entries with a non-boolean dismissed field", () => {
    // The guard insists on real booleans for dismissed. A truthy string
    // wouldn't behave the same way through `if (entry.dismissed)`, so we
    // refuse to import it rather than silently coerce.
    const raw = JSON.stringify({
      notes: { visits: 1, dismissed: "no", pinned: false },
    });
    expect(loadIntroStore(createStorage({ [STORAGE_KEY]: raw }))).toEqual({});
  });

  it("drops entries with a non-boolean pinned field", () => {
    // Same rationale as the dismissed test — pin is a tri-state behaviour
    // gate (collapse vs auto-fade vs forced-show), so non-boolean values
    // would muddy the precedence logic.
    const raw = JSON.stringify({
      notes: { visits: 1, dismissed: false, pinned: 1 },
    });
    expect(loadIntroStore(createStorage({ [STORAGE_KEY]: raw }))).toEqual({});
  });

  it("treats Infinity / NaN visits as corrupt entries", () => {
    // JSON.stringify renders these as `null`, but a hand-crafted store
    // could embed them as numbers via a different serializer.
    const raw = '{"a":{"visits":null,"dismissed":false,"pinned":false}}';
    expect(loadIntroStore(createStorage({ [STORAGE_KEY]: raw }))).toEqual({});
  });

  it("returns an empty store when getItem throws (private mode etc.)", () => {
    const failing: Pick<Storage, "getItem"> = {
      getItem() {
        throw new Error("blocked");
      },
    };
    expect(loadIntroStore(failing)).toEqual({});
  });
});

describe("persistIntroStore", () => {
  it("writes the store as JSON under the expected key", () => {
    const writes: Record<string, string> = {};
    const storage: Pick<Storage, "setItem"> = {
      setItem(key, value) {
        writes[key] = value;
      },
    };
    const store: IntroStore = {
      notes: { visits: 1, dismissed: false, pinned: false },
    };
    persistIntroStore(store, storage);
    expect(writes[STORAGE_KEY]).toBe(JSON.stringify(store));
  });

  it("round-trips with loadIntroStore", () => {
    const storage = createStorage();
    const store: IntroStore = {
      notes: { visits: 7, dismissed: false, pinned: false },
      tags: { visits: 0, dismissed: true, pinned: true },
    };
    persistIntroStore(store, storage);
    expect(loadIntroStore(storage)).toEqual(store);
  });

  it("silently swallows quota-exceeded and similar setItem failures", () => {
    const failing: Pick<Storage, "setItem"> = {
      setItem() {
        throw new Error("quota exceeded");
      },
    };
    // Must not throw — the cosmetic feature falls back to an in-memory
    // counter for this session, which is acceptable.
    expect(() => persistIntroStore({}, failing)).not.toThrow();
  });
});

describe("resetAllPageIntros", () => {
  it("removes the storage slot so the next load starts empty", () => {
    const storage = createStorage({
      [STORAGE_KEY]: JSON.stringify({
        notes: { visits: 5, dismissed: true, pinned: false },
      }),
    });
    resetAllPageIntros(storage);
    expect(loadIntroStore(storage)).toEqual({});
  });

  it("silently swallows removeItem failures", () => {
    const failing: Pick<Storage, "removeItem"> = {
      removeItem() {
        throw new Error("blocked");
      },
    };
    expect(() => resetAllPageIntros(failing)).not.toThrow();
  });
});

describe("recordVisit + isIntroCollapsed integration", () => {
  it("collapses on the eleventh successive visit", () => {
    let store: IntroStore = {};
    for (let i = 1; i <= AUTO_FADE_AFTER; i++) {
      store = recordVisit(store, "notes");
      const entry = getIntroEntry(store, "notes");
      // Every visit up to and including the threshold must render expanded.
      expect(isIntroCollapsed(entry)).toBe(false);
      expect(entry.visits).toBe(i);
    }
    // The (AUTO_FADE_AFTER + 1)th visit is the first one that fades.
    store = recordVisit(store, "notes");
    expect(getIntroEntry(store, "notes").visits).toBe(AUTO_FADE_AFTER + 1);
    expect(isIntroCollapsed(getIntroEntry(store, "notes"))).toBe(true);
  });

  it("noAutoFade keeps a heavily-visited intro expanded", () => {
    let store: IntroStore = {};
    for (let i = 0; i < AUTO_FADE_AFTER * 3; i++) {
      store = recordVisit(store, "home");
    }
    expect(
      isIntroCollapsed(getIntroEntry(store, "home"), { noAutoFade: true }),
    ).toBe(false);
  });

  it("dismiss persists across re-visits", () => {
    let store: IntroStore = {};
    store = recordVisit(store, "notes");
    store = toggleIntroCollapse(store, "notes", false);
    expect(isIntroCollapsed(getIntroEntry(store, "notes"))).toBe(true);
    // A subsequent visit doesn't un-dismiss.
    store = recordVisit(store, "notes");
    expect(isIntroCollapsed(getIntroEntry(store, "notes"))).toBe(true);
  });

  it("expanding after auto-fade pins the intro forever", () => {
    let store: IntroStore = {};
    for (let i = 0; i < AUTO_FADE_AFTER + 1; i++) {
      store = recordVisit(store, "notes");
    }
    expect(isIntroCollapsed(getIntroEntry(store, "notes"))).toBe(true);
    // User clicks to expand — pin sticks.
    store = toggleIntroCollapse(store, "notes", true);
    expect(getIntroEntry(store, "notes").pinned).toBe(true);
    // Many more visits later, the auto-fade rule is suppressed.
    for (let i = 0; i < 50; i++) {
      store = recordVisit(store, "notes");
    }
    expect(isIntroCollapsed(getIntroEntry(store, "notes"))).toBe(false);
  });
});
