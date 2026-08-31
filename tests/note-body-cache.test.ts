import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTE_BODY_CACHE_CAPACITY,
  createNoteBodyCache,
} from "../src/app/logic/note-body-cache";
import type { SutraPadDocument } from "../src/types";

function doc(id: string): SutraPadDocument {
  return {
    id,
    title: id,
    body: `body-${id}`,
    urls: [],
    tags: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
}

describe("createNoteBodyCache", () => {
  it("stores and returns a body by id", () => {
    const cache = createNoteBodyCache(3);
    cache.set("a", doc("a"));
    expect(cache.get("a")?.body).toBe("body-a");
    expect(cache.has("a")).toBe(true);
    expect(cache.get("missing")).toBeUndefined();
    expect(cache.has("missing")).toBe(false);
  });

  it("evicts the least-recently-used entry when over capacity", () => {
    const cache = createNoteBodyCache(2);
    cache.set("a", doc("a"));
    cache.set("b", doc("b"));
    cache.set("c", doc("c")); // evicts "a" (LRU)
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
    expect(cache.size).toBe(2);
  });

  it("get() marks an entry most-recently-used so it survives the next eviction", () => {
    const cache = createNoteBodyCache(2);
    cache.set("a", doc("a"));
    cache.set("b", doc("b"));
    // Touch "a" so "b" becomes the LRU.
    expect(cache.get("a")?.id).toBe("a");
    cache.set("c", doc("c")); // evicts "b", not "a"
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
  });

  it("re-setting an existing id refreshes recency without growing size", () => {
    const cache = createNoteBodyCache(2);
    cache.set("a", doc("a"));
    cache.set("b", doc("b"));
    cache.set("a", { ...doc("a"), body: "updated" }); // "a" now MRU, size still 2
    expect(cache.size).toBe(2);
    expect(cache.get("a")?.body).toBe("updated");
    cache.set("c", doc("c")); // evicts "b" (LRU), not the refreshed "a"
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
  });

  it("has() does not change recency", () => {
    const cache = createNoteBodyCache(2);
    cache.set("a", doc("a"));
    cache.set("b", doc("b"));
    expect(cache.has("a")).toBe(true); // must NOT promote "a"
    cache.set("c", doc("c")); // "a" is still LRU → evicted
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
  });

  it("delete() drops an entry", () => {
    const cache = createNoteBodyCache(3);
    cache.set("a", doc("a"));
    cache.delete("a");
    expect(cache.has("a")).toBe(false);
    expect(cache.size).toBe(0);
    cache.delete("missing"); // no throw
  });

  it("clamps a non-positive capacity to 1 (still caches the open note)", () => {
    const cache = createNoteBodyCache(0);
    cache.set("a", doc("a"));
    expect(cache.has("a")).toBe(true);
    cache.set("b", doc("b"));
    expect(cache.has("a")).toBe(false);
    expect(cache.size).toBe(1);
  });

  it("exposes a sane default capacity", () => {
    expect(DEFAULT_NOTE_BODY_CACHE_CAPACITY).toBeGreaterThan(1);
  });
});

// --- Gap-closing block, 2026-08-29 ------------------------------------------

describe("createNoteBodyCache: the touch in set()", () => {
  it("re-setting an existing id moves it to the MRU end", () => {
    // `set` deletes before inserting because `Map.set` on an existing key
    // updates the value **without moving the key** — insertion order is fixed
    // at first insert. Drop the delete and a refreshed body keeps its old
    // position, so the note the user just re-hydrated is the next one evicted.
    //
    // The existing "re-setting an existing id refreshes recency" test cannot
    // see this: it calls `cache.get("a")` to check the new body, and `get`
    // performs its own touch, which restores the recency the missing delete
    // failed to give. Presence is checked with `has` here for exactly that
    // reason — it is the one accessor documented not to change recency.
    const cache = createNoteBodyCache(2);
    cache.set("a", doc("a"));
    cache.set("b", doc("b"));
    cache.set("a", { ...doc("a"), body: "updated" });

    cache.set("c", doc("c"));

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
    // Read the refreshed body only after the eviction has been asserted, so
    // this `get` cannot prop up the recency the assertions above depend on.
    expect(cache.get("a")?.body).toBe("updated");
  });
});
