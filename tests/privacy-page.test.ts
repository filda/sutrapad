// @vitest-environment happy-dom
//
// DOM tests for the Privacy static page. Runs in happy-dom for the same
// reason `notes-list-xss.test.ts` does: the rendered output is the
// product, and we want to assert against an actual parsed DOM.
//
// Coverage goals:
//   - the structural shell exists (h1 title, back button, prose article)
//   - all six top-level sections from `privacy-page-draft.md` render as
//     `<h2>` headings
//   - the back button routes through `onSelectMenuItem("settings")`
//     (Settings is the natural up-route — Privacy is reached from there)
//   - text content is set via `textContent`, not innerHTML interpolation
//     (regression guard for the no-innerHTML-interpolation invariant
//     the rest of the view layer keeps)

import { describe, expect, it, vi } from "vitest";
import { buildPrivacyPage } from "../src/app/view/pages/privacy-page";

describe("buildPrivacyPage", () => {
  it("renders the static-page shell with the Privacy title and a back link", () => {
    const onSelectMenuItem = vi.fn();
    const page = buildPrivacyPage({ onSelectMenuItem });

    expect(page).toBeInstanceOf(HTMLElement);
    expect(page.classList.contains("static-page")).toBe(true);

    const h1 = page.querySelector("h1");
    expect(h1?.textContent).toBe("Privacy");

    const back = page.querySelector(".static-page-back");
    expect(back).toBeInstanceOf(HTMLButtonElement);
    expect(back?.textContent).toBe("← Back to Settings");
  });

  it("routes the back link through onSelectMenuItem to settings", () => {
    const onSelectMenuItem = vi.fn();
    const page = buildPrivacyPage({ onSelectMenuItem });

    const back = page.querySelector<HTMLButtonElement>(".static-page-back");
    if (!back) throw new Error("expected back button");
    back.click();

    expect(onSelectMenuItem).toHaveBeenCalledTimes(1);
    expect(onSelectMenuItem).toHaveBeenCalledWith("settings");
  });

  it("renders every top-level section heading from the draft", () => {
    const page = buildPrivacyPage({ onSelectMenuItem: vi.fn() });

    // The eight section headings track the draft's structure verbatim.
    // If the draft moves on (e.g. adds a "Retention" section), this list
    // and the privacy-page module must move together — that's the
    // "single-source-of-truth" invariant called out in the module's
    // top-of-file comment.
    const h2Texts = Array.from(page.querySelectorAll("h2")).map(
      (h) => h.textContent ?? "",
    );
    expect(h2Texts).toEqual([
      "1. Normal data",
      "2. Opt-in data",
      "3. Opt-out data",
      "Third-party services",
      "What SutraPad does not do",
      "Your choices",
    ]);
  });

  it("renders each data category's three subsections (What/Why/Where)", () => {
    const page = buildPrivacyPage({ onSelectMenuItem: vi.fn() });

    // Five `<h3>` data categories: Google account data, Notes, Local
    // preferences, Precise location, Weather, Capture context, Browser
    // storage. Each has three `<h4>` subsections.
    const h3Texts = Array.from(page.querySelectorAll("h3")).map(
      (h) => h.textContent ?? "",
    );
    expect(h3Texts).toContain("Google account data");
    expect(h3Texts).toContain("Notes and note metadata");
    expect(h3Texts).toContain("Precise location");
    expect(h3Texts).toContain("Weather derived from location");
    expect(h3Texts).toContain("Capture context metadata");

    const h4Texts = Array.from(page.querySelectorAll("h4")).map(
      (h) => h.textContent ?? "",
    );
    // Each data entry contributes the same triplet — count the
    // sub-headings to confirm none was dropped.
    expect(h4Texts.filter((t) => t === "What we collect").length).toBe(7);
    expect(h4Texts.filter((t) => t === "Why we collect it").length).toBe(7);
    expect(h4Texts.filter((t) => t === "Where it is stored").length).toBe(7);
  });

  it("treats interpolated content as text (no innerHTML escape hatch)", () => {
    // Belt-and-braces: any `<script>` or `<img>` injected into the
    // rendered page would only show up if a future contributor swapped
    // `textContent` for `innerHTML`. We don't pass attacker-controlled
    // strings here, but we do want a single grep-able guard that the
    // page never grew an HTML interpreter on its content.
    const page = buildPrivacyPage({ onSelectMenuItem: vi.fn() });

    expect(page.querySelectorAll("script")).toHaveLength(0);
    expect(page.querySelectorAll("img")).toHaveLength(0);
    expect(page.querySelectorAll("iframe")).toHaveLength(0);
  });

  it("wraps prose content in an article container so CSS can target prose typography", () => {
    const page = buildPrivacyPage({ onSelectMenuItem: vi.fn() });
    const article = page.querySelector("article.prose");
    expect(article).toBeInstanceOf(HTMLElement);
    // The article should hold the section headings, not the page-level title.
    expect(article?.querySelector("h1")).toBeNull();
    expect(article?.querySelector("h2")).toBeInstanceOf(HTMLElement);
  });
});
