// @vitest-environment happy-dom
//
// First focused test for `src/app/view/chrome/account-bar.ts`. Two states
// (signed out / signed in) and, inside the signed-in one, a click-toggled menu
// with document-level listeners — the part of this module worth protecting is
// not the markup but the listener lifecycle:
//
//   - the panel opens on click, not on hover. The hover/focus-within version
//     it replaced was unusable on touch and opened on desktop layout grazes.
//   - the outside-click listener is registered in the **capture phase during
//     the click that opened the panel**. Listeners added mid-dispatch don't
//     fire for that same event, which is the only reason the opening click
//     doesn't immediately close the panel again. Easy to "simplify" into a
//     menu that can never be opened.
//   - both document listeners are removed on close, because the app rebuilds
//     the whole topbar on most state changes — a leak here accumulates one
//     dead listener per render for the rest of the session.
//
// The listener count is asserted directly (via spies on
// `document.addEventListener` / `removeEventListener`) since a leak is
// invisible in the DOM.
//
// Two survivors in the mutation report are equivalent: the `if (isOpen) return`
// guard in `openPanel` and the `if (!isOpen) return` guard in `closePanel`.
// Neither is reachable — the trigger's handler branches on `isOpen` before
// calling either one, and the outside-click / Escape listeners only exist
// while the panel is open. They are idempotence insurance for a future second
// caller, not live branches. (The `isOpen = false` assignment inside
// `closePanel` *is* live: see "reopens on a third click".)

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAccountBar } from "../src/app/view/chrome/account-bar";
import type { UserProfile } from "../src/types";

const PROFILE: UserProfile = {
  name: "Filip Šubr",
  email: "filip@example.com",
  picture: "https://lh3.example.com/avatar.jpg",
};

function mount(profile: UserProfile | null) {
  const onSignIn = vi.fn();
  const onSignOut = vi.fn();
  const bar = buildAccountBar({ profile, onSignIn, onSignOut });
  document.body.append(bar);
  const trigger = bar.querySelector<HTMLButtonElement>(".account-menu-trigger");
  return { bar, trigger, onSignIn, onSignOut };
}

/** Dispatches a real bubbling click so the capture-phase document listener sees it. */
function clickOn(target: EventTarget): void {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("buildAccountBar signed out", () => {
  it("offers a single sign-in button and nothing else", () => {
    const { bar, onSignIn } = mount(null);
    const button = bar.querySelector<HTMLButtonElement>(".account-sign-in");

    expect(bar.className).toBe("account-bar");
    expect(button?.type).toBe("button");
    expect(button?.className).toBe("button button-primary account-sign-in");
    expect(button?.textContent).toBe("Sign in with Google");
    // No menu at all — nothing to open when there is no account.
    expect(bar.querySelector(".account-menu")).toBeNull();

    button?.click();
    expect(onSignIn).toHaveBeenCalledOnce();
  });
});

describe("buildAccountBar signed in", () => {
  it("shows the Google avatar labelled with the account name", () => {
    const { bar } = mount(PROFILE);
    const img = bar.querySelector<HTMLImageElement>(".account-avatar");

    expect(img?.tagName.toLowerCase()).toBe("img");
    expect(img?.getAttribute("src")).toBe(PROFILE.picture);
    expect(img?.alt).toBe(PROFILE.name);
  });

  it("falls back to a monogram when there is no picture", () => {
    // The empty gradient circle this replaced was ambiguous — "whose account
    // is this?" — and the picture URL does not survive every Drive
    // share-target handoff.
    const { bar } = mount({ ...PROFILE, picture: "" });
    const fallback = bar.querySelector(".account-avatar");

    expect(fallback?.tagName.toLowerCase()).toBe("div");
    expect(fallback?.className).toBe("account-avatar avatar-fallback");
    expect(fallback?.querySelector(".avatar-fallback-initials")?.textContent).toBe("FŠ");
    // Decorative: the trigger's aria-label already reads the full name.
    expect(
      fallback?.querySelector(".avatar-fallback-initials")?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(bar.querySelector("img")).toBeNull();
  });

  it("renders a bare fallback circle when the name yields no initials", () => {
    const { bar } = mount({ ...PROFILE, picture: "", name: "   " });

    expect(bar.querySelector(".account-avatar")?.className).toBe(
      "account-avatar avatar-fallback",
    );
    expect(bar.querySelector(".avatar-fallback-initials")).toBeNull();
  });

  it("describes the trigger as a closed popup menu", () => {
    const { trigger } = mount(PROFILE);

    expect(trigger?.type).toBe("button");
    expect(trigger?.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger?.getAttribute("aria-label")).toBe("Account menu for Filip Šubr");
    // The CSS shows the panel off this attribute, so "closed" is the initial
    // state, not just an a11y nicety.
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });

  it("puts the name, email and sign-out inside a menu-role panel", () => {
    const { bar, onSignOut } = mount(PROFILE);
    const panel = bar.querySelector(".account-menu-panel");

    expect(panel?.getAttribute("role")).toBe("menu");
    expect(panel?.querySelector(".account-menu-profile strong")?.textContent).toBe(
      "Filip Šubr",
    );
    expect(panel?.querySelector(".account-menu-profile span")?.textContent).toBe(
      "filip@example.com",
    );

    const signOut = panel?.querySelector<HTMLButtonElement>(".account-menu-signout");
    expect(signOut?.className).toBe("button button-ghost account-menu-signout");
    expect(signOut?.textContent).toBe("Sign out");
    signOut?.click();
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("keeps the trigger before the panel inside the menu", () => {
    const { bar } = mount(PROFILE);

    expect([...(bar.querySelector(".account-menu")?.children ?? [])].map((c) => c.className)).toEqual([
      "account-menu-trigger",
      "account-menu-panel",
    ]);
  });
});

describe("buildAccountBar menu open and close", () => {
  it("opens on click and stays open through that same click", () => {
    // The capture-phase listener is registered *during* this dispatch, so it
    // must not see the event that added it — otherwise the menu can never be
    // opened at all.
    const { trigger } = mount(PROFILE);

    clickOn(trigger as HTMLElement);

    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes on a second click of the trigger", () => {
    const { trigger } = mount(PROFILE);

    clickOn(trigger as HTMLElement);
    clickOn(trigger as HTMLElement);

    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });

  it("reopens on a third click", () => {
    // Closing has to actually reset the internal open flag: leaving it set
    // makes every later trigger click take the close path, so the menu can
    // never be opened again for the life of that bar.
    const { trigger } = mount(PROFILE);

    clickOn(trigger as HTMLElement);
    clickOn(trigger as HTMLElement);
    clickOn(trigger as HTMLElement);

    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
  });

  it("stays open while the user clicks inside the panel", () => {
    const { bar, trigger } = mount(PROFILE);
    clickOn(trigger as HTMLElement);

    clickOn(bar.querySelector(".account-menu-profile") as HTMLElement);

    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes on a click anywhere outside the menu", () => {
    const { trigger } = mount(PROFILE);
    const elsewhere = document.createElement("div");
    document.body.append(elsewhere);
    clickOn(trigger as HTMLElement);

    clickOn(elsewhere);

    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Escape and returns focus to the trigger", () => {
    // Without the focus hand-back the keyboard user loses their place in the
    // topbar tab order after dismissing.
    const { bar, trigger } = mount(PROFILE);
    clickOn(trigger as HTMLElement);
    bar.querySelector<HTMLButtonElement>(".account-menu-signout")?.focus();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("ignores other keys while open", () => {
    const { trigger } = mount(PROFILE);
    clickOn(trigger as HTMLElement);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
  });

  it("registers no document listeners until the menu opens", () => {
    const add = vi.spyOn(document, "addEventListener");
    const { trigger } = mount(PROFILE);

    expect(add).not.toHaveBeenCalled();

    clickOn(trigger as HTMLElement);

    // Outside-click in the capture phase, plus Escape.
    expect(add).toHaveBeenCalledWith("click", expect.any(Function), true);
    expect(add).toHaveBeenCalledWith("keydown", expect.any(Function));
    add.mockRestore();
  });

  it("removes both document listeners on close", () => {
    // The topbar is rebuilt on most state changes; a listener that outlives
    // its bar accumulates one dead handler per render.
    const remove = vi.spyOn(document, "removeEventListener");
    const { trigger } = mount(PROFILE);

    clickOn(trigger as HTMLElement);
    clickOn(trigger as HTMLElement);

    expect(remove).toHaveBeenCalledWith("click", expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function));
    remove.mockRestore();
  });

  it("does not re-register listeners when already open", () => {
    const { trigger } = mount(PROFILE);
    clickOn(trigger as HTMLElement);
    const add = vi.spyOn(document, "addEventListener");

    // An inside-panel click reaches the guard, which must return early.
    clickOn(trigger?.querySelector(".account-avatar") as HTMLElement);

    expect(add).not.toHaveBeenCalled();
    add.mockRestore();
  });

  it("does not re-remove listeners when already closed", () => {
    mount(PROFILE);
    const elsewhere = document.createElement("div");
    document.body.append(elsewhere);
    const remove = vi.spyOn(document, "removeEventListener");

    clickOn(elsewhere);

    expect(remove).not.toHaveBeenCalled();
    remove.mockRestore();
  });
});

// --- Gap-closing block, 2026-08-29 ------------------------------------------

describe("account-bar: Escape is consumed, not just handled", () => {
  it("keeps the dismissing Escape from reaching the rest of the app", () => {
    // The panel's Escape handler sits on `document`, and the app has its own
    // Escape ladder above it (the tag-filter strip clears its query, then its
    // filters). Without `stopPropagation` one keypress dismisses the account
    // menu *and* wipes the user's active filters — two undo-able things for
    // one keystroke, only one of which was asked for.
    const onWindowEscape = vi.fn();
    window.addEventListener("keydown", onWindowEscape);
    try {
      const { trigger } = mount(PROFILE);
      clickOn(trigger as HTMLElement);
      onWindowEscape.mockClear();

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      expect(trigger?.getAttribute("aria-expanded")).toBe("false");
      expect(onWindowEscape).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onWindowEscape);
    }
  });

  it("lets other keys through to the app", () => {
    // The counterpart: only Escape is claimed. A `/` while the menu happens to
    // be open still has to reach the palette shortcut.
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    try {
      const { trigger } = mount(PROFILE);
      clickOn(trigger as HTMLElement);
      onWindowKey.mockClear();

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));

      expect(onWindowKey).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", onWindowKey);
    }
  });
});
