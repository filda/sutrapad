import { describe, expect, it } from "vitest";
import {
  isWithinCooldown,
  loadHintStore,
  persistHintStore,
  recordDismissed,
  recordShown,
  resetAllHints,
  selectHint,
  type HintCandidate,
  type HintContext,
  type HintStore,
} from "../src/app/logic/hints";
import type { SutraPadWorkspace } from "../src/types";

/**
 * Minimal in-memory storage stand-in. Mirrors the pattern used by
 * `visible-tag-classes.test.ts` and `page-intro.test.ts` so every
 * logic-module test exercises the same Storage-shim surface.
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

const STORAGE_KEY = "sp.hints.v1";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Builds a minimal HintContext for engine tests. The engine itself
 * never reads the workspace / profile / etc. — only candidates do —
 * so the fields are stub values. Tests of specific candidates
 * (`hint-candidates.test.ts`) supply richer contexts.
 */
function ctx(): HintContext {
  return {
    workspace: { notes: [] } as unknown as SutraPadWorkspace,
    profile: null,
    dismissedTagAliases: new Set(),
    tasksOneThingKey: null,
    tagAliasSuggestions: [],
    openTaskCount: 0,
    hasEverCapturedExternally: false,
    callbacks: {
      openCapture: () => {},
      openSettings: () => {},
      openTasks: () => {},
    },
  };
}

/** Builds a candidate with overridable fields. */
function candidate(overrides: Partial<HintCandidate> & { id: string }): HintCandidate {
  return {
    id: overrides.id,
    priority: overrides.priority ?? 50,
    cooldownDays: overrides.cooldownDays ?? 7,
    isApplicable: overrides.isApplicable ?? (() => true),
    build:
      overrides.build ??
      (() => ({
        eyebrow: "e",
        title: "t",
        body: "b",
        ctaLabel: "go",
        onCta: () => {},
      })),
  };
}

describe("isWithinCooldown", () => {
  it("returns false for a hint that's never been dismissed (entry undefined)", () => {
    expect(isWithinCooldown(undefined, 7, 1_000_000)).toBe(false);
  });

  it("returns false when dismissedAt is 0 (entry exists but never dismissed)", () => {
    expect(
      isWithinCooldown({ lastShownAt: 100, dismissedAt: 0 }, 7, 1_000_000),
    ).toBe(false);
  });

  it("returns true within the cooldown window", () => {
    const dismissed = 1_000_000;
    const now = dismissed + 3 * DAY_MS;
    expect(
      isWithinCooldown({ lastShownAt: 0, dismissedAt: dismissed }, 7, now),
    ).toBe(true);
  });

  it("uses subtraction (now - dismissedAt), not addition", () => {
    // Belt-and-braces against an arithmetic-operator mutation that flips
    // `-` to `+`. With small ms-epoch values like 1e6 the two operations
    // happen to land on the same side of the cooldown threshold, masking
    // the mutation; a realistic Date.now()-scale timestamp (~1.7e12)
    // makes the wrong operator overflow well past any sane cooldown
    // window and the gate would always read "not in cooldown."
    const dismissed = 1_700_000_000_000;
    const now = dismissed + 2 * DAY_MS;
    expect(
      isWithinCooldown({ lastShownAt: 0, dismissedAt: dismissed }, 7, now),
    ).toBe(true);
  });

  it("returns false exactly at the boundary (cooldown is strictly less-than)", () => {
    const dismissed = 1_000_000;
    const now = dismissed + 7 * DAY_MS;
    expect(
      isWithinCooldown({ lastShownAt: 0, dismissedAt: dismissed }, 7, now),
    ).toBe(false);
  });

  it("returns false past the cooldown window", () => {
    const dismissed = 1_000_000;
    const now = dismissed + 30 * DAY_MS;
    expect(
      isWithinCooldown({ lastShownAt: 0, dismissedAt: dismissed }, 7, now),
    ).toBe(false);
  });

  it("supports fractional cooldowns (sub-day, e.g. 0.5 days = 12 hours)", () => {
    const dismissed = 1_000_000;
    expect(
      isWithinCooldown(
        { lastShownAt: 0, dismissedAt: dismissed },
        0.5,
        dismissed + 6 * 60 * 60 * 1000,
      ),
    ).toBe(true);
    expect(
      isWithinCooldown(
        { lastShownAt: 0, dismissedAt: dismissed },
        0.5,
        dismissed + 13 * 60 * 60 * 1000,
      ),
    ).toBe(false);
  });
});

describe("selectHint", () => {
  it("returns null when no candidates are registered", () => {
    expect(selectHint([], ctx(), {}, 0)).toBeNull();
  });

  it("returns null when every candidate is inapplicable", () => {
    const c = candidate({ id: "a", isApplicable: () => false });
    expect(selectHint([c], ctx(), {}, 0)).toBeNull();
  });

  it("returns null when every applicable candidate is in cooldown", () => {
    const c = candidate({ id: "a", cooldownDays: 7 });
    const store: HintStore = {
      a: { lastShownAt: 0, dismissedAt: 1_000_000 },
    };
    expect(selectHint([c], ctx(), store, 1_000_000 + DAY_MS)).toBeNull();
  });

  it("returns the only applicable candidate when nothing competes", () => {
    const c = candidate({ id: "solo" });
    expect(selectHint([c], ctx(), {}, 0)?.id).toBe("solo");
  });

  it("picks the highest-priority applicable candidate", () => {
    const low = candidate({ id: "low", priority: 10 });
    const high = candidate({ id: "high", priority: 100 });
    expect(selectHint([low, high], ctx(), {}, 0)?.id).toBe("high");
  });

  it("priority dominates regardless of registration order", () => {
    const high = candidate({ id: "high", priority: 100 });
    const low = candidate({ id: "low", priority: 10 });
    // High first.
    expect(selectHint([high, low], ctx(), {}, 0)?.id).toBe("high");
    // Low first — same answer.
    expect(selectHint([low, high], ctx(), {}, 0)?.id).toBe("high");
  });

  it("skips a higher-priority candidate that's in cooldown and falls through to a lower-priority one", () => {
    const high = candidate({ id: "high", priority: 100, cooldownDays: 7 });
    const low = candidate({ id: "low", priority: 10 });
    const store: HintStore = {
      high: { lastShownAt: 0, dismissedAt: 1_000_000 },
    };
    const now = 1_000_000 + DAY_MS;
    expect(selectHint([high, low], ctx(), store, now)?.id).toBe("low");
  });

  it("rotates within a priority tier by least-recently-shown", () => {
    const a = candidate({ id: "a", priority: 50 });
    const b = candidate({ id: "b", priority: 50 });
    // a was shown more recently → b wins next time.
    const store: HintStore = {
      a: { lastShownAt: 200, dismissedAt: 0 },
      b: { lastShownAt: 100, dismissedAt: 0 },
    };
    expect(selectHint([a, b], ctx(), store, 1_000)?.id).toBe("b");
  });

  it("treats a candidate that has never been shown (no entry) as oldest in the rotation", () => {
    const seen = candidate({ id: "seen", priority: 50 });
    const fresh = candidate({ id: "fresh", priority: 50 });
    const store: HintStore = {
      seen: { lastShownAt: 200, dismissedAt: 0 },
    };
    expect(selectHint([seen, fresh], ctx(), store, 1_000)?.id).toBe("fresh");
  });

  it("does not mutate the candidates array (sort works on a copy)", () => {
    const a = candidate({ id: "a", priority: 10 });
    const b = candidate({ id: "b", priority: 100 });
    const list = [a, b];
    const snapshot = [...list];
    selectHint(list, ctx(), {}, 0);
    expect(list).toEqual(snapshot);
  });

  it("does not mutate the store", () => {
    const a = candidate({ id: "a" });
    const store: HintStore = { a: { lastShownAt: 100, dismissedAt: 0 } };
    const snapshot: HintStore = JSON.parse(JSON.stringify(store));
    selectHint([a], ctx(), store, 1_000);
    expect(store).toEqual(snapshot);
  });
});

describe("recordShown", () => {
  it("creates a fresh entry when the id is new (dismissedAt stays 0)", () => {
    const next = recordShown({}, "a", 1_500);
    expect(next.a).toEqual({ lastShownAt: 1_500, dismissedAt: 0 });
  });

  it("updates lastShownAt and preserves dismissedAt on an existing entry", () => {
    const start: HintStore = {
      a: { lastShownAt: 100, dismissedAt: 50 },
    };
    const next = recordShown(start, "a", 999);
    expect(next.a).toEqual({ lastShownAt: 999, dismissedAt: 50 });
  });

  it("does not touch other ids in the store", () => {
    const start: HintStore = {
      a: { lastShownAt: 1, dismissedAt: 0 },
      b: { lastShownAt: 2, dismissedAt: 0 },
    };
    const next = recordShown(start, "a", 999);
    expect(next.b).toEqual(start.b);
  });

  it("does not mutate the input store", () => {
    const start: HintStore = { a: { lastShownAt: 1, dismissedAt: 0 } };
    const snapshot: HintStore = JSON.parse(JSON.stringify(start));
    recordShown(start, "a", 999);
    expect(start).toEqual(snapshot);
  });
});

describe("recordDismissed", () => {
  it("creates a fresh entry with both timestamps set", () => {
    const next = recordDismissed({}, "a", 2_000);
    expect(next.a).toEqual({ lastShownAt: 2_000, dismissedAt: 2_000 });
  });

  it("overwrites both timestamps on an existing entry", () => {
    const start: HintStore = {
      a: { lastShownAt: 50, dismissedAt: 25 },
    };
    const next = recordDismissed(start, "a", 999);
    expect(next.a).toEqual({ lastShownAt: 999, dismissedAt: 999 });
  });

  it("does not touch other ids", () => {
    const start: HintStore = {
      a: { lastShownAt: 1, dismissedAt: 0 },
      b: { lastShownAt: 2, dismissedAt: 1 },
    };
    const next = recordDismissed(start, "a", 999);
    expect(next.b).toEqual(start.b);
  });

  it("does not mutate the input store", () => {
    const start: HintStore = { a: { lastShownAt: 1, dismissedAt: 0 } };
    const snapshot: HintStore = JSON.parse(JSON.stringify(start));
    recordDismissed(start, "a", 999);
    expect(start).toEqual(snapshot);
  });
});

describe("loadHintStore", () => {
  it("returns an empty store on first run", () => {
    expect(loadHintStore(createStorage())).toEqual({});
  });

  it("returns an empty store on JSON parse error", () => {
    expect(loadHintStore(createStorage({ [STORAGE_KEY]: "{not json" }))).toEqual(
      {},
    );
  });

  it("returns an empty store when top-level value isn't an object", () => {
    expect(loadHintStore(createStorage({ [STORAGE_KEY]: "[]" }))).toEqual({});
    expect(loadHintStore(createStorage({ [STORAGE_KEY]: "42" }))).toEqual({});
    expect(loadHintStore(createStorage({ [STORAGE_KEY]: "null" }))).toEqual({});
  });

  it("parses a well-formed store", () => {
    const stored: HintStore = {
      a: { lastShownAt: 100, dismissedAt: 200 },
      b: { lastShownAt: 0, dismissedAt: 0 },
    };
    expect(
      loadHintStore(createStorage({ [STORAGE_KEY]: JSON.stringify(stored) })),
    ).toEqual(stored);
  });

  it("drops entries that fail the structural guard", () => {
    const raw = JSON.stringify({
      good: { lastShownAt: 1, dismissedAt: 2 },
      missingFields: { lastShownAt: 1 },
      wrongTypes: { lastShownAt: "soon", dismissedAt: 0 },
      // Both fields independently must be non-negative — a negative
      // dismissedAt would compute a never-expiring cooldown window with
      // any positive `now`, so the guard rejects it even when
      // lastShownAt is fine.
      negativeShown: { lastShownAt: -1, dismissedAt: 0 },
      negativeDismiss: { lastShownAt: 0, dismissedAt: -1 },
      nullEntry: null,
      stringEntry: "hi",
      numericEntry: 42,
    });
    expect(loadHintStore(createStorage({ [STORAGE_KEY]: raw }))).toEqual({
      good: { lastShownAt: 1, dismissedAt: 2 },
    });
  });

  it("rejects non-finite numbers (NaN, Infinity)", () => {
    // JSON.stringify renders these as `null`, but a hand-crafted payload
    // could embed them as numeric tokens via a non-standard serialiser.
    const raw =
      '{"a":{"lastShownAt":null,"dismissedAt":0},"b":{"lastShownAt":1e999,"dismissedAt":0}}';
    expect(loadHintStore(createStorage({ [STORAGE_KEY]: raw }))).toEqual({});
  });

  it("returns an empty store when getItem throws (private mode etc.)", () => {
    const failing: Pick<Storage, "getItem"> = {
      getItem() {
        throw new Error("blocked");
      },
    };
    expect(loadHintStore(failing)).toEqual({});
  });
});

describe("persistHintStore", () => {
  it("writes the store as JSON under the canonical key", () => {
    const writes: Record<string, string> = {};
    const storage: Pick<Storage, "setItem"> = {
      setItem(key, value) {
        writes[key] = value;
      },
    };
    const store: HintStore = {
      a: { lastShownAt: 1, dismissedAt: 0 },
    };
    persistHintStore(store, storage);
    expect(writes[STORAGE_KEY]).toBe(JSON.stringify(store));
  });

  it("round-trips with loadHintStore", () => {
    const storage = createStorage();
    const store: HintStore = {
      a: { lastShownAt: 5, dismissedAt: 3 },
      b: { lastShownAt: 9, dismissedAt: 0 },
    };
    persistHintStore(store, storage);
    expect(loadHintStore(storage)).toEqual(store);
  });

  it("silently swallows quota-exceeded and similar setItem failures", () => {
    const failing: Pick<Storage, "setItem"> = {
      setItem() {
        throw new Error("quota");
      },
    };
    expect(() => persistHintStore({}, failing)).not.toThrow();
  });
});

describe("resetAllHints", () => {
  it("removes the storage slot so the next load starts empty", () => {
    const storage = createStorage({
      [STORAGE_KEY]: JSON.stringify({
        a: { lastShownAt: 1, dismissedAt: 2 },
      }),
    });
    resetAllHints(storage);
    expect(loadHintStore(storage)).toEqual({});
  });

  it("silently swallows removeItem failures", () => {
    const failing: Pick<Storage, "removeItem"> = {
      removeItem() {
        throw new Error("blocked");
      },
    };
    expect(() => resetAllHints(failing)).not.toThrow();
  });
});

describe("selectHint + recordShown integration", () => {
  it("rotates two equally-prioritised candidates across consecutive renders", () => {
    const a = candidate({ id: "a", priority: 50 });
    const b = candidate({ id: "b", priority: 50 });
    let store: HintStore = {};
    let now = 1_000;
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const picked = selectHint([a, b], ctx(), store, now);
      if (picked === null) throw new Error("expected a pick");
      seen.push(picked.id);
      store = recordShown(store, picked.id, now);
      now += 1_000;
    }
    // Either order is acceptable on the first pick (both have lastShownAt
    // = 0 in the empty store), but after the first pick the rotation must
    // alternate. So the sequence must be A,B,A,B or B,A,B,A.
    expect(new Set(seen.slice(0, 2))).toEqual(new Set(["a", "b"]));
    expect(seen[0]).toBe(seen[2]);
    expect(seen[1]).toBe(seen[3]);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it("respects cooldown across re-renders after a dismiss", () => {
    const a = candidate({ id: "a", priority: 100, cooldownDays: 7 });
    const b = candidate({ id: "b", priority: 50 });
    let store: HintStore = {};
    let now = 1_000;
    // First render: a wins (higher priority).
    expect(selectHint([a, b], ctx(), store, now)?.id).toBe("a");
    store = recordDismissed(store, "a", now);
    now += DAY_MS;
    // a is in cooldown, b takes over.
    expect(selectHint([a, b], ctx(), store, now)?.id).toBe("b");
    // Push past cooldown — a wins again.
    now += 7 * DAY_MS;
    expect(selectHint([a, b], ctx(), store, now)?.id).toBe("a");
  });
});
