// @vitest-environment happy-dom
//
// First focused test for `src/app/lifecycle/notes-endless-scroll.ts` — 33
// lines of DOM glue over `logic/endless-scroll`, which has its own suite. The
// deferred list called it "thin wiring", and it is, but every one of its four
// lines is a gate the user feels when it goes wrong:
//
//   - **the page check.** The listener is on `window`, so it fires while the
//     user scrolls Links, Tags or a static page too. Growing the notes limit
//     from another page is invisible until they navigate back to a list that
//     has silently rendered 400 cards.
//   - **the prefetch margin.** `shouldGrow` is called with live geometry, and
//     the three arguments are easy to swap: `scrollY`/`innerHeight` reversed
//     still type-checks and still grows *sometimes*, which is the worst kind
//     of bug. The arguments are asserted by position.
//   - **`growVisible()` gating the render.** It returns `false` once the list
//     is fully shown; re-rendering anyway on every scroll event of a long
//     page is a real jank source.
//   - **the disposer.** HMR and teardown re-install; without removal the app
//     accumulates one live scroll listener per reload.
//
// `passive: true` is asserted explicitly — a non-passive scroll listener
// blocks the compositor thread on every wheel tick, and nothing else would
// catch its loss.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installNotesEndlessScroll } from "../src/app/lifecycle/notes-endless-scroll";
import {
  GROW_BATCH,
  INITIAL_LIMIT,
  PREFETCH_PX,
  currentLimit,
  resetListState,
  syncListState,
} from "../src/app/logic/endless-scroll";
import type { MenuItemId } from "../src/app/logic/menu";

/** A list long enough that the limit can grow more than once. */
const TOTAL = INITIAL_LIMIT + GROW_BATCH * 3;

function install(activeMenuItem: MenuItemId = "notes") {
  const render = vi.fn();
  const getActiveMenuItem = vi.fn(() => activeMenuItem);
  const dispose = installNotesEndlessScroll({ getActiveMenuItem, render });
  return { render, getActiveMenuItem, dispose };
}

/** Puts the viewport at the very bottom of a `documentHeight`-tall page. */
function scrollToBottom(documentHeight = 5000): void {
  Object.defineProperty(document.documentElement, "scrollHeight", {
    value: documentHeight,
    configurable: true,
  });
  window.innerHeight = 800;
  window.scrollY = documentHeight - window.innerHeight;
  window.dispatchEvent(new Event("scroll"));
}

/** Puts the viewport well above the prefetch margin. */
function scrollToTop(documentHeight = 5000): void {
  Object.defineProperty(document.documentElement, "scrollHeight", {
    value: documentHeight,
    configurable: true,
  });
  window.innerHeight = 800;
  window.scrollY = 0;
  window.dispatchEvent(new Event("scroll"));
}

beforeEach(() => {
  resetListState();
  syncListState("notes|all|cards", TOTAL);
});

afterEach(() => {
  resetListState();
});

describe("installNotesEndlessScroll growth", () => {
  it("grows the list and re-renders when the user reaches the bottom", () => {
    const { render, dispose } = install();

    scrollToBottom();

    expect(currentLimit()).toBe(INITIAL_LIMIT + GROW_BATCH);
    expect(render).toHaveBeenCalledOnce();
    dispose();
  });

  it("does nothing while the user is nowhere near the bottom", () => {
    const { render, dispose } = install();

    scrollToTop();

    expect(currentLimit()).toBe(INITIAL_LIMIT);
    expect(render).not.toHaveBeenCalled();
    dispose();
  });

  it("grows one batch per scroll that reaches the bottom", () => {
    // Three events, three batches — a mutant that grows twice per event or
    // caches the first decision shows up here and not in a single-event test.
    const { render, dispose } = install();

    scrollToBottom();
    scrollToBottom();
    scrollToBottom();

    expect(currentLimit()).toBe(INITIAL_LIMIT + GROW_BATCH * 3);
    expect(render).toHaveBeenCalledTimes(3);
    dispose();
  });

  it("stops re-rendering once the whole list is shown", () => {
    // `growVisible()` returns false at the ceiling. Without that gate every
    // further scroll event on a fully-grown list triggers a full re-render.
    const { render, dispose } = install();
    for (let i = 0; i < 3; i += 1) scrollToBottom();
    expect(currentLimit()).toBe(TOTAL);
    render.mockClear();

    scrollToBottom();

    expect(render).not.toHaveBeenCalled();
    expect(currentLimit()).toBe(TOTAL);
    dispose();
  });

  it("grows exactly at the prefetch margin, not only at the true bottom", () => {
    // The whole point of the margin is that content is ready *before* the
    // user hits the end. One pixel further from the bottom must not grow.
    const height = 5000;
    const { render, dispose } = install();
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: height,
      configurable: true,
    });
    window.innerHeight = 800;

    window.scrollY = height - 800 - PREFETCH_PX - 1;
    window.dispatchEvent(new Event("scroll"));
    expect(render).not.toHaveBeenCalled();

    window.scrollY = height - 800 - PREFETCH_PX;
    window.dispatchEvent(new Event("scroll"));
    expect(render).toHaveBeenCalledOnce();
    dispose();
  });

  it("passes the live geometry in the order shouldGrow expects", () => {
    // `scrollY` and `innerHeight` are both numbers, so a swapped pair type-
    // checks and still grows on some pages. Asymmetric values pin the order.
    const height = 5000;
    const { render, dispose } = install();
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: height,
      configurable: true,
    });
    // Swapped, these two would sum the same — so the discriminator is a
    // viewport that alone cannot reach the margin.
    window.innerHeight = 100;
    window.scrollY = height - 100 - PREFETCH_PX;

    window.dispatchEvent(new Event("scroll"));

    expect(render).toHaveBeenCalledOnce();
    dispose();
  });
});

describe("installNotesEndlessScroll page gate", () => {
  it("ignores scrolling on any page other than Notes", () => {
    // The listener is global; the Links page scrolls too.
    const { render, dispose } = install("links");

    scrollToBottom();

    expect(render).not.toHaveBeenCalled();
    expect(currentLimit()).toBe(INITIAL_LIMIT);
    dispose();
  });

  it("re-reads the active page on every scroll", () => {
    // The getter is a closure over live state, not a value captured at
    // install time — navigating to Notes must arm the growth without a
    // re-install.
    let page: MenuItemId = "tags";
    const render = vi.fn();
    const dispose = installNotesEndlessScroll({
      getActiveMenuItem: () => page,
      render,
    });

    scrollToBottom();
    expect(render).not.toHaveBeenCalled();

    page = "notes";
    scrollToBottom();
    expect(render).toHaveBeenCalledOnce();
    dispose();
  });

  it("checks the page before touching the document geometry", () => {
    // Cheapest gate first: on a non-Notes page the handler must return
    // without reading layout, which is a forced reflow on every scroll tick.
    const getActiveMenuItem = vi.fn((): MenuItemId => "settings");
    const dispose = installNotesEndlessScroll({
      getActiveMenuItem,
      render: vi.fn(),
    });

    scrollToBottom();

    expect(getActiveMenuItem).toHaveBeenCalledOnce();
    dispose();
  });
});

describe("installNotesEndlessScroll listener lifecycle", () => {
  it("registers one passive scroll listener on the window", () => {
    // Non-passive scroll handlers block the compositor on every wheel tick;
    // nothing but this assertion would notice the flag disappearing.
    const add = vi.spyOn(window, "addEventListener");

    const dispose = install().dispose;

    expect(add).toHaveBeenCalledExactlyOnceWith("scroll", expect.any(Function), {
      passive: true,
    });
    add.mockRestore();
    dispose();
  });

  it("detaches the same listener on dispose", () => {
    // HMR re-installs on every save; a leak stacks one live handler per
    // reload for the rest of the session.
    const remove = vi.spyOn(window, "removeEventListener");
    const { render, dispose } = install();

    dispose();
    scrollToBottom();

    expect(remove).toHaveBeenCalledExactlyOnceWith("scroll", expect.any(Function));
    expect(render).not.toHaveBeenCalled();
    remove.mockRestore();
  });

  it("leaves a second installation working after the first is disposed", () => {
    const first = install();
    const second = install();

    first.dispose();
    scrollToBottom();

    expect(first.render).not.toHaveBeenCalled();
    expect(second.render).toHaveBeenCalledOnce();
    second.dispose();
  });
});
