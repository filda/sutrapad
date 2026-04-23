import { describe, expect, it } from "vitest";
import { TAG_CLASS_IDS, type TagClassId } from "../src/app/logic/tag-class";
import {
  defaultVisibleTagClasses,
  isTagClassId,
  loadStoredVisibleTagClasses,
  persistVisibleTagClasses,
  resolveInitialVisibleTagClasses,
  toggleTagClassVisibility,
} from "../src/app/logic/visible-tag-classes";

/**
 * In-memory Storage stand-in so we can exercise the load/save round-trip
 * without dragging `window.localStorage` into these tests. Only the two
 * methods the module actually calls are implemented.
 */
function createStorage(initial: Record<string, string> = {}): Pick<
  Storage,
  "getItem" | "setItem"
> {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
  };
}

const STORAGE_KEY = "sutrapad-visible-tag-classes";

describe("isTagClassId", () => {
  it("accepts each of the seven known class ids", () => {
    for (const id of TAG_CLASS_IDS) {
      expect(isTagClassId(id)).toBe(true);
    }
  });

  it("rejects strings that aren't class ids", () => {
    expect(isTagClassId("")).toBe(false);
    expect(isTagClassId("TOPIC")).toBe(false); // case matters
    expect(isTagClassId("unknown")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isTagClassId(null)).toBe(false);
    expect(isTagClassId(undefined)).toBe(false);
    expect(isTagClassId(42)).toBe(false);
    expect(isTagClassId({})).toBe(false);
    expect(isTagClassId([])).toBe(false);
  });
});

describe("defaultVisibleTagClasses", () => {
  it("returns all seven classes", () => {
    expect([...defaultVisibleTagClasses()].sort()).toEqual(
      [...TAG_CLASS_IDS].sort(),
    );
  });

  it("returns a fresh Set on every call (no shared mutable template)", () => {
    const a = defaultVisibleTagClasses();
    const b = defaultVisibleTagClasses();
    a.delete("topic");
    expect(b.has("topic")).toBe(true);
  });
});

describe("loadStoredVisibleTagClasses", () => {
  it("returns null when nothing is stored (first-run signal)", () => {
    expect(loadStoredVisibleTagClasses(createStorage())).toBeNull();
  });

  it("returns an empty set when the stored value is an empty string", () => {
    // Deliberately distinct from the null case above: the user unchecked
    // every class — we must not silently re-enable them.
    const storage = createStorage({ [STORAGE_KEY]: "" });
    const loaded = loadStoredVisibleTagClasses(storage);
    expect(loaded).not.toBeNull();
    expect(loaded?.size).toBe(0);
  });

  it("parses a CSV of class ids in any order", () => {
    const storage = createStorage({
      [STORAGE_KEY]: "people,topic,when",
    });
    const loaded = loadStoredVisibleTagClasses(storage);
    expect(loaded).toEqual(new Set<TagClassId>(["people", "topic", "when"]));
  });

  it("trims whitespace around each id", () => {
    const storage = createStorage({
      [STORAGE_KEY]: "  topic , place  , when",
    });
    const loaded = loadStoredVisibleTagClasses(storage);
    expect(loaded).toEqual(new Set<TagClassId>(["topic", "place", "when"]));
  });

  it("drops ids that are no longer known classes", () => {
    // A stored set from before a hypothetical rename must not crash — the
    // renamed id is simply culled so the remaining live ids still paint.
    const storage = createStorage({
      [STORAGE_KEY]: "topic,legacy-class,people",
    });
    const loaded = loadStoredVisibleTagClasses(storage);
    expect(loaded).toEqual(new Set<TagClassId>(["topic", "people"]));
  });

  it("returns an empty set when every id is unknown", () => {
    const storage = createStorage({
      [STORAGE_KEY]: "foo,bar",
    });
    const loaded = loadStoredVisibleTagClasses(storage);
    expect(loaded?.size).toBe(0);
  });
});

describe("persistVisibleTagClasses", () => {
  it("writes the set in canonical TAG_CLASS_IDS order", () => {
    const storage = createStorage();
    const writes: Record<string, string> = {};
    const wrapped: Pick<Storage, "setItem"> = {
      setItem(key, value) {
        writes[key] = value;
        storage.setItem(key, value);
      },
    };
    // Deliberately pass in a non-canonical insertion order.
    const classes = new Set<TagClassId>(["when", "topic", "people"]);
    persistVisibleTagClasses(classes, wrapped);
    expect(writes[STORAGE_KEY]).toBe("topic,when,people");
  });

  it("persists an empty set as an empty string", () => {
    const writes: Record<string, string> = {};
    persistVisibleTagClasses(new Set<TagClassId>(), {
      setItem(key, value) {
        writes[key] = value;
      },
    });
    expect(writes[STORAGE_KEY]).toBe("");
  });

  it("round-trips with loadStoredVisibleTagClasses", () => {
    const storage = createStorage();
    const classes = new Set<TagClassId>(["place", "source", "device"]);
    persistVisibleTagClasses(classes, storage);
    expect(loadStoredVisibleTagClasses(storage)).toEqual(classes);
  });
});

describe("resolveInitialVisibleTagClasses", () => {
  it("falls back to the default 'all visible' set when nothing is stored", () => {
    const resolved = resolveInitialVisibleTagClasses(createStorage());
    expect([...resolved].sort()).toEqual([...TAG_CLASS_IDS].sort());
  });

  it("honours a persisted empty set (user explicitly hid everything)", () => {
    const resolved = resolveInitialVisibleTagClasses(
      createStorage({ [STORAGE_KEY]: "" }),
    );
    expect(resolved.size).toBe(0);
  });

  it("honours a persisted partial set", () => {
    const resolved = resolveInitialVisibleTagClasses(
      createStorage({ [STORAGE_KEY]: "topic,people" }),
    );
    expect(resolved).toEqual(new Set<TagClassId>(["topic", "people"]));
  });
});

describe("toggleTagClassVisibility", () => {
  it("adds a class that was previously hidden", () => {
    const current = new Set<TagClassId>(["topic"]);
    const next = toggleTagClassVisibility(current, "people");
    expect(next).toEqual(new Set<TagClassId>(["topic", "people"]));
  });

  it("removes a class that was previously visible", () => {
    const current = new Set<TagClassId>(["topic", "people"]);
    const next = toggleTagClassVisibility(current, "topic");
    expect(next).toEqual(new Set<TagClassId>(["people"]));
  });

  it("does not mutate the input set", () => {
    const current = new Set<TagClassId>(["topic"]);
    const snapshot = new Set(current);
    toggleTagClassVisibility(current, "topic");
    toggleTagClassVisibility(current, "people");
    expect(current).toEqual(snapshot);
  });

  it("returns a new Set reference each call", () => {
    const current = new Set<TagClassId>(["topic"]);
    const next = toggleTagClassVisibility(current, "topic");
    expect(next).not.toBe(current);
  });
});
