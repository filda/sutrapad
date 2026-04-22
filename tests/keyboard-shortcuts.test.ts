import { describe, expect, it } from "vitest";
import {
  G_PREFIX_TIMEOUT_MS,
  initialShortcutState,
  isEditingTarget,
  reduceShortcut,
  type ShortcutEvent,
  type ShortcutState,
} from "../src/lib/keyboard-shortcuts";

/**
 * Small builder: fills in the DOM-ish flags the reducer needs so each
 * test only has to override what actually matters to it. Defaults to
 * "user is typing nowhere, on the Today page, at t=0" which is the
 * baseline every shortcut should fire from.
 */
function event(overrides: Partial<ShortcutEvent>): ShortcutEvent {
  return {
    key: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    isEditingTarget: false,
    isDetailRoute: false,
    now: 0,
    ...overrides,
  };
}

describe("reduceShortcut — single-key shortcuts", () => {
  it("emits new-note for N and resets state", () => {
    const result = reduceShortcut(initialShortcutState, event({ key: "n" }));

    expect(result.action).toEqual({ kind: "new-note" });
    expect(result.state).toEqual(initialShortcutState);
    expect(result.preventDefault).toBe(true);
  });

  it("accepts uppercase N (shift+n) as new-note", () => {
    const result = reduceShortcut(initialShortcutState, event({ key: "N" }));

    expect(result.action).toEqual({ kind: "new-note" });
  });

  it("emits escape only on the detail route", () => {
    const offDetail = reduceShortcut(
      initialShortcutState,
      event({ key: "Escape", isDetailRoute: false }),
    );
    const onDetail = reduceShortcut(
      initialShortcutState,
      event({ key: "Escape", isDetailRoute: true }),
    );

    expect(offDetail.action).toBeNull();
    expect(offDetail.preventDefault).toBe(false);
    expect(onDetail.action).toEqual({ kind: "escape" });
    expect(onDetail.preventDefault).toBe(true);
  });
});

describe("reduceShortcut — G-prefix sequences", () => {
  it("arms the G-prefix and expects a second key", () => {
    const first = reduceShortcut(
      initialShortcutState,
      event({ key: "g", now: 100 }),
    );

    expect(first.action).toBeNull();
    expect(first.state.pending).toBe("g");
    expect(first.state.pendingExpiresAt).toBe(100 + G_PREFIX_TIMEOUT_MS);
    // Arming preventDefaults so `g` doesn't type into a button/link if
    // focus happens to be somewhere non-editable.
    expect(first.preventDefault).toBe(true);
  });

  it.each([
    ["t", "home"],
    ["n", "notes"],
    ["l", "links"],
    ["k", "tasks"],
  ] as const)("G %s → goto %s", (secondKey, expectedMenu) => {
    const armed: ShortcutState = {
      pending: "g",
      pendingExpiresAt: 1000,
    };

    const result = reduceShortcut(armed, event({ key: secondKey, now: 500 }));

    expect(result.action).toEqual({ kind: "goto", menu: expectedMenu });
    expect(result.state).toEqual(initialShortcutState);
    expect(result.preventDefault).toBe(true);
  });

  it("accepts uppercase letters after G (caps-lock users)", () => {
    const armed: ShortcutState = { pending: "g", pendingExpiresAt: 1000 };

    const result = reduceShortcut(armed, event({ key: "T", now: 500 }));

    expect(result.action).toEqual({ kind: "goto", menu: "home" });
  });

  it("drops the G-prefix when followed by an unrelated key, no action", () => {
    const armed: ShortcutState = { pending: "g", pendingExpiresAt: 1000 };

    const result = reduceShortcut(armed, event({ key: "q", now: 500 }));

    expect(result.action).toBeNull();
    expect(result.state).toEqual(initialShortcutState);
    // The stray key wasn't claimed by the shortcut, so we let the
    // browser do what it would normally do with it.
    expect(result.preventDefault).toBe(false);
  });

  it("expires the G-prefix after the timeout window and treats the next key fresh", () => {
    const armed: ShortcutState = { pending: "g", pendingExpiresAt: 1000 };

    // Fire `t` well after the expiration — should NOT navigate.
    const tooLate = reduceShortcut(armed, event({ key: "t", now: 2000 }));

    expect(tooLate.action).toBeNull();
    expect(tooLate.state).toEqual(initialShortcutState);
  });

  it("fires N cleanly even if the G-prefix has expired", () => {
    const armed: ShortcutState = { pending: "g", pendingExpiresAt: 1000 };

    const result = reduceShortcut(armed, event({ key: "n", now: 9999 }));

    expect(result.action).toEqual({ kind: "new-note" });
    expect(result.state).toEqual(initialShortcutState);
  });

  it("fires the boundary case: key arriving exactly at pendingExpiresAt still counts as armed", () => {
    const armed: ShortcutState = { pending: "g", pendingExpiresAt: 1000 };

    // `now === pendingExpiresAt` should still be inside the window —
    // the reducer expires on strict >.
    const result = reduceShortcut(armed, event({ key: "t", now: 1000 }));

    expect(result.action).toEqual({ kind: "goto", menu: "home" });
  });
});

describe("reduceShortcut — suppression rules", () => {
  it("ignores every shortcut when a modifier is held (ctrl/meta/alt)", () => {
    for (const modifier of ["metaKey", "ctrlKey", "altKey"] as const) {
      const result = reduceShortcut(
        initialShortcutState,
        event({ key: "n", [modifier]: true }),
      );
      expect(result.action).toBeNull();
      expect(result.preventDefault).toBe(false);
    }
  });

  it("ignores every shortcut while the user is typing", () => {
    for (const key of ["n", "g", "Escape"]) {
      const result = reduceShortcut(
        initialShortcutState,
        event({ key, isEditingTarget: true, isDetailRoute: true }),
      );
      expect(result.action).toBeNull();
      expect(result.preventDefault).toBe(false);
    }
  });

  it("does not arm the G-prefix while typing", () => {
    const result = reduceShortcut(
      initialShortcutState,
      event({ key: "g", isEditingTarget: true, now: 100 }),
    );

    expect(result.state.pending).toBeNull();
  });

  it("keeps an already-armed G-prefix intact when a modified key follows (ignore and move on)", () => {
    const armed: ShortcutState = { pending: "g", pendingExpiresAt: 1000 };

    // If the user starts a G sequence and then types Ctrl+T for a new
    // browser tab, the reducer should ignore the event entirely and leave
    // the G-prefix alone — the browser takes over and the prefix will
    // expire on its own.
    const result = reduceShortcut(
      armed,
      event({ key: "t", ctrlKey: true, now: 500 }),
    );

    expect(result.action).toBeNull();
    expect(result.state).toBe(armed);
  });
});

/**
 * `isEditingTarget` is duck-typed (checks the two fields that actually
 * matter), so the tests can fabricate plain objects cast through
 * `EventTarget` instead of spinning up a DOM. That matches the project's
 * DOM-free vitest setup — real browser targets exercise the same code
 * path at runtime.
 */
function fakeTarget(
  fields: Partial<{ tagName: string; isContentEditable: boolean }>,
): EventTarget {
  return fields as unknown as EventTarget;
}

describe("isEditingTarget", () => {
  it("returns false for null", () => {
    expect(isEditingTarget(null)).toBe(false);
  });

  it("returns false for a non-editable element like a button", () => {
    expect(isEditingTarget(fakeTarget({ tagName: "BUTTON" }))).toBe(false);
  });

  it.each(["INPUT", "TEXTAREA", "SELECT"])(
    "returns true for <%s>",
    (tagName) => {
      expect(isEditingTarget(fakeTarget({ tagName }))).toBe(true);
    },
  );

  it("returns true for contenteditable elements regardless of tag", () => {
    expect(
      isEditingTarget(
        fakeTarget({ tagName: "DIV", isContentEditable: true }),
      ),
    ).toBe(true);
  });

  it("returns false when contenteditable is explicitly false", () => {
    expect(
      isEditingTarget(
        fakeTarget({ tagName: "DIV", isContentEditable: false }),
      ),
    ).toBe(false);
  });

  it("returns false for targets that lack both fields (e.g. window/Document)", () => {
    expect(isEditingTarget(fakeTarget({}))).toBe(false);
  });
});
