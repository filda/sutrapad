import { afterEach, describe, expect, it } from "vitest";
import {
  GROW_BATCH,
  INITIAL_LIMIT,
  currentLimit,
  growVisible,
  hasMore,
  resetListState,
  shouldGrow,
  syncListState,
} from "../src/app/logic/endless-scroll";

afterEach(() => resetListState());

describe("syncListState", () => {
  it("starts a fresh list at the initial batch (capped by total)", () => {
    expect(syncListState("notes", 1000)).toBe(INITIAL_LIMIT);
    expect(syncListState("small", 10)).toBe(10); // total < INITIAL_LIMIT
  });

  it("keeps the grown limit when the signature is unchanged", () => {
    syncListState("notes", 1000);
    growVisible();
    const limit = currentLimit();
    expect(syncListState("notes", 1000)).toBe(limit); // not reset
  });

  it("resets to the initial batch when the signature changes", () => {
    syncListState("notes", 1000);
    growVisible();
    expect(syncListState("notes|tag:x", 500)).toBe(INITIAL_LIMIT);
  });

  it("clamps the limit down when the total shrank (e.g. after a delete)", () => {
    syncListState("notes", 1000);
    growVisible(); // limit = INITIAL_LIMIT + GROW_BATCH = 100
    expect(syncListState("notes", 25)).toBe(25);
  });
});

describe("growVisible", () => {
  it("adds one batch and reports that it changed", () => {
    syncListState("notes", 1000);
    expect(growVisible()).toBe(true);
    expect(currentLimit()).toBe(INITIAL_LIMIT + GROW_BATCH);
  });

  it("stops (returns false) once everything is shown", () => {
    syncListState("notes", INITIAL_LIMIT + 5);
    expect(growVisible()).toBe(true); // 60 -> 65 (capped at total)
    expect(currentLimit()).toBe(INITIAL_LIMIT + 5);
    expect(growVisible()).toBe(false);
  });

  it("returns false with no active list", () => {
    expect(growVisible()).toBe(false);
  });
});

describe("hasMore", () => {
  it("is true while cards remain hidden and false once all are shown", () => {
    syncListState("notes", INITIAL_LIMIT + 1);
    expect(hasMore()).toBe(true);
    growVisible();
    expect(hasMore()).toBe(false);
  });

  it("is false with no active list", () => {
    expect(hasMore()).toBe(false);
  });
});

describe("shouldGrow", () => {
  it("is true within the prefetch margin of the bottom", () => {
    // docHeight 10000, viewport 800, prefetch 800: threshold at scrollY 8400
    expect(shouldGrow(8400, 800, 10000, 800)).toBe(true);
    expect(shouldGrow(9999, 800, 10000, 800)).toBe(true);
  });

  it("is false when far from the bottom", () => {
    expect(shouldGrow(0, 800, 10000, 800)).toBe(false);
    expect(shouldGrow(8399, 800, 10000, 800)).toBe(false);
  });
});
