import { describe, expect, it, vi } from "vitest";
import { atom, combine, computed } from "../src/lib/store";

describe("atom", () => {
  it("returns the initial value via get()", () => {
    const counter = atom(0);
    expect(counter.get()).toBe(0);
  });

  it("notifies subscribers on set() with the new value", () => {
    const counter = atom(0);
    const listener = vi.fn();
    counter.subscribe(listener);
    counter.set(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(1);
  });

  it("does NOT notify subscribers on Object.is-equal sets", () => {
    // Re-setting the same primitive value is a no-op for the renderer
    // — same reference for objects (an upstream `upsertNote` that
    // returned the original workspace because nothing changed) is too.
    const counter = atom(7);
    const listener = vi.fn();
    counter.subscribe(listener);

    counter.set(7);
    counter.set(7);
    expect(listener).not.toHaveBeenCalled();

    const obj = { a: 1 };
    const wrapped = atom(obj);
    const wrappedListener = vi.fn();
    wrapped.subscribe(wrappedListener);
    wrapped.set(obj);
    expect(wrappedListener).not.toHaveBeenCalled();
  });

  it("treats NaN as equal to NaN (Object.is contract)", () => {
    // Object.is(NaN, NaN) === true, unlike `===`. Subscribers
    // shouldn't fire on a NaN→NaN reassignment.
    const value = atom(Number.NaN);
    const listener = vi.fn();
    value.subscribe(listener);
    value.set(Number.NaN);
    expect(listener).not.toHaveBeenCalled();
  });

  it("returns an unsubscribe function that stops further notifications", () => {
    const counter = atom(0);
    const listener = vi.fn();
    const unsubscribe = counter.subscribe(listener);

    counter.set(1);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    counter.set(2);
    counter.set(3);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("makes unsubscribe idempotent (no error on double-unsubscribe)", () => {
    const counter = atom(0);
    const unsubscribe = counter.subscribe(vi.fn());
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });

  it("does NOT notify on subscribe (caller reads initial via get)", () => {
    // Bootstrap pattern: subscribe several listeners before any state
    // mutation. If subscribe fired immediately, every listener would
    // see the same initial value once *plus* the first real mutation,
    // doubling the cold-boot work.
    const counter = atom(42);
    const listener = vi.fn();
    counter.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it("supports many independent subscribers", () => {
    const counter = atom(0);
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    counter.subscribe(a);
    counter.subscribe(b);
    counter.subscribe(c);
    counter.set(1);
    expect(a).toHaveBeenCalledWith(1);
    expect(b).toHaveBeenCalledWith(1);
    expect(c).toHaveBeenCalledWith(1);
  });

  it("snapshots listeners during notification so subscribe-during-notify doesn't disturb the round", () => {
    // A listener that subscribes a *new* listener inside its body
    // shouldn't cause that new listener to run for the same value.
    // Otherwise add-during-iterate produces an inconsistent visit
    // count across the listener set.
    const counter = atom(0);
    const newcomer = vi.fn();
    const incumbent = vi.fn(() => {
      counter.subscribe(newcomer);
    });
    counter.subscribe(incumbent);

    counter.set(1);
    expect(incumbent).toHaveBeenCalledTimes(1);
    expect(newcomer).not.toHaveBeenCalled();

    counter.set(2);
    // Newcomer is in for the second round.
    expect(newcomer).toHaveBeenCalledTimes(1);
    expect(newcomer).toHaveBeenCalledWith(2);
  });

  it("snapshots listeners so unsubscribe-during-notify doesn't skip neighbours", () => {
    const counter = atom(0);
    const calls: string[] = [];
    let unsubscribeB: (() => void) | undefined;
    counter.subscribe(() => {
      calls.push("a");
      unsubscribeB?.();
    });
    unsubscribeB = counter.subscribe(() => {
      calls.push("b");
    });
    counter.subscribe(() => {
      calls.push("c");
    });

    counter.set(1);
    // `a` removes `b` mid-loop. With a snapshot, all three still fire
    // for this round; `b` is gone for subsequent rounds.
    expect(calls).toEqual(["a", "b", "c"]);

    calls.length = 0;
    counter.set(2);
    expect(calls).toEqual(["a", "c"]);
  });
});

describe("computed", () => {
  it("returns the derived initial value", () => {
    const counter = atom(3);
    const doubled = computed(counter, (n) => n * 2);
    expect(doubled.get()).toBe(6);
  });

  it("recomputes and notifies when the source changes", () => {
    const counter = atom(3);
    const doubled = computed(counter, (n) => n * 2);
    const listener = vi.fn();
    doubled.subscribe(listener);

    counter.set(4);
    expect(doubled.get()).toBe(8);
    expect(listener).toHaveBeenCalledWith(8);
  });

  it("does NOT notify subscribers when the derived value is unchanged", () => {
    // Source change that maps to the same output (e.g. a rename
    // that doesn't affect the count) should be invisible downstream.
    const text = atom("hello");
    const length = computed(text, (s) => s.length);
    const listener = vi.fn();
    length.subscribe(listener);

    text.set("world"); // same length
    expect(listener).not.toHaveBeenCalled();

    text.set("longer"); // different length
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(6);
  });

  it("caches the derived value (fn is not re-run per get)", () => {
    const counter = atom(1);
    const fn = vi.fn((n: number) => n * 10);
    const tenfold = computed(counter, fn);
    fn.mockClear();

    tenfold.get();
    tenfold.get();
    tenfold.get();
    expect(fn).not.toHaveBeenCalled();

    counter.set(2);
    // One recompute on source change.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("supports unsubscribe at the derived layer", () => {
    const counter = atom(0);
    const doubled = computed(counter, (n) => n * 2);
    const listener = vi.fn();
    const unsubscribe = doubled.subscribe(listener);

    counter.set(1);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    counter.set(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("combine", () => {
  it("returns the combined initial value", () => {
    const a = atom(2);
    const b = atom(3);
    const sum = combine(a, b, (x, y) => x + y);
    expect(sum.get()).toBe(5);
  });

  it("recomputes when either source changes", () => {
    const a = atom(2);
    const b = atom(3);
    const sum = combine(a, b, (x, y) => x + y);
    const listener = vi.fn();
    sum.subscribe(listener);

    a.set(10);
    expect(listener).toHaveBeenCalledWith(13);

    b.set(20);
    expect(listener).toHaveBeenCalledWith(30);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does NOT notify when the combined value is unchanged", () => {
    // Both inputs change but cancel out — no notification.
    const a = atom(5);
    const b = atom(5);
    const diff = combine(a, b, (x, y) => x - y);
    const listener = vi.fn();
    diff.subscribe(listener);

    a.set(7);
    // diff jumped from 0 to 2 — listener fires.
    expect(listener).toHaveBeenCalledTimes(1);

    listener.mockClear();
    a.set(7); // no change in a, b unchanged → diff still 2 → no fire
    expect(listener).not.toHaveBeenCalled();
  });

  it("composes with computed for chained derivations", () => {
    // The realistic shape from app.ts: combine(workspace, filterMode)
    // fed into another computed that turns into the available tag list.
    const a = atom(1);
    const b = atom(2);
    const sum = combine(a, b, (x, y) => x + y);
    const sumDoubled = computed(sum, (n) => n * 2);

    expect(sumDoubled.get()).toBe(6);
    a.set(10);
    expect(sumDoubled.get()).toBe(24);
  });
});
