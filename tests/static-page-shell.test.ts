// @vitest-environment happy-dom
//
// First focused test for `src/app/view/chrome/static-page-shell.ts` — the
// wrapper Privacy / About / Terms / Shortcuts render inside. Every one of its
// five header slots is optional and each is its own branch, which is exactly
// the shape a smoke test can't cover: it visits one page, in one
// configuration, and the other four combinations never run.
//
// The load-bearing parts:
//   - the landmark structure (`<section class="static-page">` → `<header>` +
//     `<article class="prose">`), because the prose typography CSS keys off
//     `.prose` and would otherwise bleed into the topbar;
//   - the optional back link, which must appear only when *both* `backTo` and
//     `backLabel` are given and must route through the shared
//     `onSelectMenuItem` rather than inventing its own navigation;
//   - that titles are built from DOM nodes, never `innerHTML`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildStaticPageShell } from "../src/app/view/chrome/static-page-shell";

function paragraph(text: string): HTMLElement {
  const node = document.createElement("p");
  node.textContent = text;
  return node;
}

function mount(overrides: Partial<Parameters<typeof buildStaticPageShell>[0]> = {}) {
  const onSelectMenuItem = vi.fn();
  const page = buildStaticPageShell({
    title: { before: "Your ", emphasis: "privacy", after: "." },
    content: [paragraph("First paragraph.")],
    onSelectMenuItem,
    ...overrides,
  });
  document.body.append(page);
  return { page, onSelectMenuItem };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("buildStaticPageShell structure", () => {
  it("wraps the prose in its own landmark under a header", () => {
    const { page } = mount();

    expect(page.tagName.toLowerCase()).toBe("section");
    expect(page.className).toBe("static-page");
    expect([...page.children].map((child) => child.tagName.toLowerCase())).toEqual([
      "header",
      "article",
    ]);
    expect(page.querySelector("header")?.className).toBe("static-page-header");
    // `.prose` is what the long-form typography rules target; losing it makes
    // the page render in app-chrome type sizes.
    expect(page.querySelector("article")?.className).toBe("prose");
  });

  it("puts the caller's content inside the prose article, in order", () => {
    const first = paragraph("One.");
    const second = paragraph("Two.");
    const { page } = mount({ content: [first, second] });

    expect([...(page.querySelector(".prose")?.children ?? [])]).toEqual([first, second]);
  });

  it("renders an empty prose article when a page has no content yet", () => {
    const { page } = mount({ content: [] });

    expect(page.querySelector(".prose")?.children).toHaveLength(0);
  });

  it("italicises the emphasis word of a structured title", () => {
    const { page } = mount();
    const heading = page.querySelector(".static-page-title");

    expect(heading?.tagName.toLowerCase()).toBe("h1");
    expect(heading?.textContent).toBe("Your privacy.");
    expect(heading?.querySelector("em")?.textContent).toBe("privacy");
  });

  it("takes a plain-string title as text", () => {
    const { page } = mount({ title: "Terms of use" });

    expect(page.querySelector(".static-page-title")?.textContent).toBe("Terms of use");
    expect(page.querySelector(".static-page-title em")).toBeNull();
  });

  it("never parses a title as markup", () => {
    // Titles can carry user-adjacent strings; the shell builds text nodes
    // only, so a tag stays visible text instead of becoming an element.
    const { page } = mount({ title: "<img src=x onerror=alert(1)>" });

    expect(page.querySelector(".static-page-title")?.textContent).toBe(
      "<img src=x onerror=alert(1)>",
    );
    expect(page.querySelector(".static-page-title img")).toBeNull();
  });

  it("still renders the heading element for a page with no title", () => {
    // The `<h1>` is a landmark, not decoration — the CSS grid and the
    // document outline both expect it.
    const { page } = mount({ title: undefined });

    expect(page.querySelector(".static-page-title")?.textContent).toBe("");
  });
});

describe("buildStaticPageShell optional header slots", () => {
  it("omits every optional slot by default", () => {
    const { page } = mount();

    expect(page.querySelector(".static-page-eyebrow")).toBeNull();
    expect(page.querySelector(".static-page-subtitle")).toBeNull();
    expect(page.querySelector(".static-page-meta")).toBeNull();
    expect(page.querySelector(".static-page-back")).toBeNull();
  });

  it("renders the eyebrow, subtitle and stamp when given", () => {
    const { page } = mount({
      eyebrow: "About · Sutrapad",
      subtitle: "What the app does and does not do.",
      lastUpdated: "April 2026",
    });

    expect(page.querySelector(".static-page-eyebrow")?.textContent).toBe("About · Sutrapad");
    expect(page.querySelector(".static-page-subtitle")?.textContent).toBe(
      "What the app does and does not do.",
    );
    // The label is the shell's, only the date comes from the caller.
    expect(page.querySelector(".static-page-meta")?.textContent).toBe(
      "Last updated · April 2026",
    );
  });

  it("orders the header slots eyebrow → title → subtitle → stamp", () => {
    const { page } = mount({
      eyebrow: "About · Sutrapad",
      subtitle: "Sub.",
      lastUpdated: "April 2026",
      backTo: "settings",
      backLabel: "Settings",
    });

    expect([...(page.querySelector("header")?.children ?? [])].map((c) => c.className)).toEqual([
      "static-page-back is-link",
      "static-page-eyebrow",
      "static-page-title",
      "static-page-subtitle",
      "static-page-meta",
    ]);
  });

  it("keeps an empty-string slot rather than treating it as absent", () => {
    // The branches test `!== undefined`, so a deliberate empty subtitle still
    // reserves its space in the layout.
    const { page } = mount({ subtitle: "", eyebrow: "" });

    expect(page.querySelector(".static-page-subtitle")?.textContent).toBe("");
    expect(page.querySelector(".static-page-eyebrow")?.textContent).toBe("");
  });
});

describe("buildStaticPageShell back link", () => {
  it("routes back through the shared navigation callback", () => {
    const { page, onSelectMenuItem } = mount({ backTo: "settings", backLabel: "Settings" });
    const back = page.querySelector<HTMLButtonElement>(".static-page-back");

    expect(back?.type).toBe("button");
    expect(back?.className).toBe("static-page-back is-link");
    // Plain-text arrow so the control is readable before the icon font loads.
    expect(back?.textContent).toBe("← Back to Settings");

    back?.click();
    expect(onSelectMenuItem).toHaveBeenCalledExactlyOnceWith("settings");
  });

  it("needs both the destination and the label", () => {
    // A half-configured back link would either read "← Back to undefined" or
    // navigate nowhere.
    expect(mount({ backTo: "settings" }).page.querySelector(".static-page-back")).toBeNull();
    expect(mount({ backLabel: "Settings" }).page.querySelector(".static-page-back")).toBeNull();
  });

  it("sends the user wherever the caller pointed it", () => {
    const { page, onSelectMenuItem } = mount({ backTo: "home", backLabel: "Home" });

    page.querySelector<HTMLButtonElement>(".static-page-back")?.click();

    expect(onSelectMenuItem).toHaveBeenCalledExactlyOnceWith("home");
  });
});
