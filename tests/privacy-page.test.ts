// @vitest-environment happy-dom
//
// DOM tests for the Privacy static page. Runs in happy-dom for the same
// reason `notes-list-xss.test.ts` does: the rendered output is the
// product, and we want to assert against an actual parsed DOM.
//
// Coverage goals:
//   - the structural shell exists (h1 title, back button, prose article)
//   - all six top-level sections render as `<h2>` headings
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

// Hoisted out of the describe so the unicorn `consistent-function-scoping`
// rule doesn't flag them — neither helper closes over its parent scope.
function bulletsAfter(parent: ParentNode, headingText: string): string[] {
  const headings = Array.from(parent.querySelectorAll("h2,h3,h4"));
  const target = headings.find((h) => h.textContent === headingText);
  if (!target) return [];
  let next = target.nextElementSibling;
  while (next && next.tagName !== "UL") next = next.nextElementSibling;
  if (!next) return [];
  return Array.from(next.querySelectorAll(":scope > li")).map(
    (li) => li.textContent ?? "",
  );
}

function dataEntryBullets(
  page: HTMLElement,
  h3Title: string,
): { what: string[]; why: string[]; where: string[] } {
  const article = page.querySelector("article.prose");
  if (!article) throw new Error("expected article.prose");
  // Slice the article from this h3 to the next h2-or-h3 boundary.
  const all = Array.from(article.children);
  const start = all.findIndex(
    (n) => n.tagName === "H3" && n.textContent === h3Title,
  );
  if (start === -1) throw new Error(`missing h3: ${h3Title}`);
  const stop = all.findIndex(
    (n, i) => i > start && (n.tagName === "H2" || n.tagName === "H3"),
  );
  const slice = all.slice(start, stop === -1 ? undefined : stop);
  const fragment = document.createElement("div");
  for (const node of slice) fragment.append(node.cloneNode(true));
  return {
    what: bulletsAfter(fragment, "What we collect"),
    why: bulletsAfter(fragment, "Why we collect it"),
    where: bulletsAfter(fragment, "Where it is stored"),
  };
}

describe("buildPrivacyPage prose content", () => {
  // Walks the rendered DOM to extract every paragraph / heading / list
  // bullet — those are otherwise opaque StringLiteral / ArrayDeclaration
  // mutation surfaces. Pinning the literal copy keeps the privacy
  // disclosures honest: a future copy-edit must update both the source
  // and these expected arrays in the same change.

  it("opens with the two intro paragraphs explaining the client-only model and the three-category split", () => {
    const page = buildPrivacyPage({ onSelectMenuItem: vi.fn() });
    const article = page.querySelector("article.prose");
    const paragraphs = Array.from(
      article?.querySelectorAll(":scope > p.static-paragraph") ?? [],
    ).map((p) => p.textContent);
    expect(paragraphs[0]).toBe(
      "SutraPad is a client-only app that runs in your browser. We do not operate a SutraPad backend that stores your notes on our servers. Your data stays in your browser and in your own Google Drive, depending on which feature you use.",
    );
    expect(paragraphs[1]).toBe(
      "We group data into three categories so it is easier to understand what is required, what is optional, and what you can turn off or avoid.",
    );
  });

  it("stamps `static-paragraph` on every prose paragraph and `static-h{2,3,4}` on every heading", () => {
    // Pin the className helpers (lines 53, 65) — without these
    // assertions the StringLiteral mutants survive even with content
    // pinned via textContent, because the CSS-targeting class is
    // independent of the text.
    const page = buildPrivacyPage({ onSelectMenuItem: vi.fn() });
    for (const p of page.querySelectorAll("article.prose p")) {
      expect(p.classList.contains("static-paragraph")).toBe(true);
    }
    for (const h of page.querySelectorAll("article.prose h2")) {
      expect(h.classList.contains("static-h2")).toBe(true);
    }
    for (const h of page.querySelectorAll("article.prose h3")) {
      expect(h.classList.contains("static-h3")).toBe(true);
    }
    for (const h of page.querySelectorAll("article.prose h4")) {
      expect(h.classList.contains("static-h4")).toBe(true);
    }
  });

  it("stamps `static-list compact` on every bullet list", () => {
    // Pins line 75. ArrayDeclaration mutants (`[]`) elsewhere are
    // killed via the per-section bullet asserts below — but the
    // className would survive without this dedicated guard.
    const page = buildPrivacyPage({ onSelectMenuItem: vi.fn() });
    const lists = Array.from(page.querySelectorAll("article.prose ul"));
    expect(lists.length).toBeGreaterThan(0);
    for (const ul of lists) {
      expect(ul.classList.contains("static-list")).toBe(true);
      expect(ul.classList.contains("compact")).toBe(true);
    }
  });

  it("introduces section 1 (Normal data) with the 'core app experience' explainer", () => {
    const page = buildPrivacyPage({ onSelectMenuItem: vi.fn() });
    // The section-1 paragraph follows the h2 immediately.
    const article = page.querySelector("article.prose");
    const all = Array.from(article?.children ?? []);
    const h2 = all.find((n) => n.textContent === "1. Normal data");
    if (!h2) throw new Error("expected h2 1. Normal data");
    const next = h2.nextElementSibling;
    expect(next?.tagName).toBe("P");
    expect(next?.textContent).toBe(
      "This is the data required for the core app experience.",
    );
  });

  it("renders the 'Google account data' triplet with the canonical bullet content", () => {
    const page = buildPrivacyPage({ onSelectMenuItem: vi.fn() });
    const entry = dataEntryBullets(page, "Google account data");
    expect(entry.what).toEqual([
      "Name",
      "Email address",
      "Profile picture URL, if Google provides one",
      "Temporary Google access token for the current session",
    ]);
    expect(entry.why).toEqual([
      "To sign you in",
      "To show which account is currently connected",
      "To let SutraPad save and load your notes from your Google Drive",
    ]);
    expect(entry.where).toEqual([
      "In your browser local storage for session restore",
      "In Google systems as part of the Google sign-in and Google Drive flow",
    ]);
  });

  it("renders the 'Notes and note metadata' triplet with the canonical bullet content", () => {
    const page = buildPrivacyPage({ onSelectMenuItem: vi.fn() });
    const entry = dataEntryBullets(page, "Notes and note metadata");
    expect(entry.what).toEqual([
      "Note title",
      "Note body",
      "URLs found in the note",
      "Tags",
      "Created and updated timestamps",
      "Active note selection",
    ]);
    expect(entry.why).toEqual([
      "To create, edit, search, organize, and sync your notes",
      "To keep the notebook structure consistent across sessions",
    ]);
    expect(entry.where).toEqual([
      "In your Google Drive as SutraPad JSON files",
      "In your browser local storage as a local workspace cache for faster restore and offline continuity",
    ]);
  });

  it("renders the 'Local app preferences' triplet with the canonical bullet content", () => {
    const page = buildPrivacyPage({ onSelectMenuItem: vi.fn() });
    const entry = dataEntryBullets(page, "Local app preferences");
    expect(entry.what).toEqual([
      "Selected theme",
      "Notes view mode",
      "Visual persona preference",
    ]);
    expect(entry.why).toEqual([
      "To remember how you want the app to look on the current device",
    ]);
    expect(entry.where).toEqual(["In your browser local storage only"]);
  });

  it("introduces section 2 (Opt-in data) with the 'deliberately use a feature' explainer", () => {
    const page = buildPrivacyPage({ onSelectMenuItem: vi.fn() });
    const article = page.querySelector("article.prose");
    const all = Array.from(article?.children ?? []);
    const h2 = all.find((n) => n.textContent === "2. Opt-in data");
    if (!h2) throw new Error("expected h2 2. Opt-in data");
    expect(h2.nextElementSibling?.textContent).toBe(
      "This data is collected only when you deliberately use a feature that needs it, or when you grant browser-level permission.",
    );
  });

  it("renders the 'Precise location' triplet with the canonical bullet content", () => {
    const page = buildPrivacyPage({ onSelectMenuItem: vi.fn() });
    const entry = dataEntryBullets(page, "Precise location");
    expect(entry.what).toEqual([
      "Latitude and longitude from the browser Geolocation API",
      "A human-readable place label derived from those coordinates",
    ]);
    expect(entry.why).toEqual([
      "To enrich a newly created or captured note with a place label",
      "To help you remember where a note was created",
    ]);
    expect(entry.where).toEqual([
      "Coordinates and place label may be saved inside the note data in Google Drive",
      "The local cache for reverse-geocoded place labels is stored in your browser local storage",
      "Reverse geocoding requests are sent from your browser to Nominatim",
    ]);
  });

  it("renders the 'Weather derived from location' triplet with the canonical bullet content", () => {
    const page = buildPrivacyPage({ onSelectMenuItem: vi.fn() });
    const entry = dataEntryBullets(page, "Weather derived from location");
    expect(entry.what).toEqual([
      "Approximate current weather for the note location, such as temperature, wind speed, weather code, and day/night state",
    ]);
    expect(entry.why).toEqual([
      "To enrich captured note context",
      "To support note metadata and derived tags",
    ]);
    expect(entry.where).toEqual([
      "Inside the note capture metadata, which may be saved in Google Drive and cached in browser local storage",
      "Weather lookups are requested from your browser to Open-Meteo",
    ]);
  });

  it("introduces section 3 (Opt-out data) with the 'capture context' explainer", () => {
    const page = buildPrivacyPage({ onSelectMenuItem: vi.fn() });
    const article = page.querySelector("article.prose");
    const all = Array.from(article?.children ?? []);
    const h2 = all.find((n) => n.textContent === "3. Opt-out data");
    if (!h2) throw new Error("expected h2 3. Opt-out data");
    expect(h2.nextElementSibling?.textContent).toBe(
      "This data supports convenience, capture context, and device-specific behavior. It is not required to write a simple note, and you can avoid it by not using the related capture flows, by signing out, or by clearing browser site data.",
    );
  });

  it("renders the 'Capture context metadata' triplet with the canonical bullet content", () => {
    const page = buildPrivacyPage({ onSelectMenuItem: vi.fn() });
    const entry = dataEntryBullets(page, "Capture context metadata");
    expect(entry.what).toEqual([
      "Time zone and time zone offset",
      "Locale and browser languages",
      "Referrer of the captured page, if available",
      "Device type, operating system, and browser family",
      "Screen and viewport details",
      "Scroll position and scroll progress",
      "Time spent on the page before capture",
      "Page metadata such as page title, description, canonical URL, author, Open Graph fields, and published time",
      "Network status and connection quality hints",
      "Battery status, if the browser exposes it",
      "Ambient light reading from supported browsers, if available",
    ]);
    expect(entry.why).toEqual([
      "To preserve context around a captured note",
      "To generate richer metadata and better automatic tags",
      "To make later recall and filtering more useful",
    ]);
    expect(entry.where).toEqual([
      "Inside the note capture metadata in Google Drive",
      "In your browser local workspace cache when the workspace is cached locally",
    ]);
  });

  it("renders the 'Browser storage and offline support' triplet with the canonical bullet content", () => {
    const page = buildPrivacyPage({ onSelectMenuItem: vi.fn() });
    const entry = dataEntryBullets(page, "Browser storage and offline support");
    expect(entry.what).toEqual([
      "Cached app files through the service worker",
      "Local copies of workspace data needed for restore",
      "Cached place-label lookups",
    ]);
    expect(entry.why).toEqual([
      "To make the app load faster",
      "To support offline and interrupted-session recovery",
      "To reduce repeated lookups for the same location",
    ]);
    expect(entry.where).toEqual([
      "In your browser storage and browser cache only",
    ]);
  });

  it("renders the 'Third-party services' section with its intro, the four reliance bullets, and the closing browser-direct line", () => {
    const page = buildPrivacyPage({ onSelectMenuItem: vi.fn() });
    const article = page.querySelector("article.prose");
    const all = Array.from(article?.children ?? []);
    const h2Idx = all.findIndex((n) => n.textContent === "Third-party services");
    expect(h2Idx).toBeGreaterThan(-1);
    expect(all[h2Idx + 1]?.textContent).toBe(
      "SutraPad currently relies on third-party services only where the feature requires them:",
    );
    const ul = all[h2Idx + 2];
    expect(ul?.tagName).toBe("UL");
    const items = Array.from(ul?.querySelectorAll("li") ?? []).map(
      (li) => li.textContent,
    );
    expect(items).toEqual([
      "Google Identity Services for sign-in",
      "Google Drive for note storage and sync",
      "Nominatim for reverse geocoding when location-based note labels are used",
      "Open-Meteo for weather enrichment when location-based capture context is used",
    ]);
    expect(all[h2Idx + 3]?.textContent).toBe(
      "These services process requests directly from your browser.",
    );
  });

  it("renders the 'What SutraPad does not do' section with its four canonical disclaimers", () => {
    const page = buildPrivacyPage({ onSelectMenuItem: vi.fn() });
    const article = page.querySelector("article.prose");
    const all = Array.from(article?.children ?? []);
    const h2Idx = all.findIndex(
      (n) => n.textContent === "What SutraPad does not do",
    );
    expect(h2Idx).toBeGreaterThan(-1);
    const ul = all[h2Idx + 1];
    expect(ul?.tagName).toBe("UL");
    const items = Array.from(ul?.querySelectorAll("li") ?? []).map(
      (li) => li.textContent,
    );
    expect(items).toEqual([
      "SutraPad does not run its own backend for note storage.",
      "SutraPad does not store your notes on SutraPad-operated servers.",
      "SutraPad does not currently include advertising trackers or product analytics for user behavior profiling.",
      "SutraPad does not sell your note content to third parties.",
    ]);
  });

  it("renders the 'Your choices' section with its five user-control bullets", () => {
    const page = buildPrivacyPage({ onSelectMenuItem: vi.fn() });
    const article = page.querySelector("article.prose");
    const all = Array.from(article?.children ?? []);
    const h2Idx = all.findIndex((n) => n.textContent === "Your choices");
    expect(h2Idx).toBeGreaterThan(-1);
    const ul = all[h2Idx + 1];
    expect(ul?.tagName).toBe("UL");
    const items = Array.from(ul?.querySelectorAll("li") ?? []).map(
      (li) => li.textContent,
    );
    expect(items).toEqual([
      "You can use SutraPad without granting location access.",
      "You can sign out at any time.",
      "You can remove local browser data by clearing site storage in your browser.",
      "You can delete notes and related files from your Google Drive.",
      "You can avoid capture-related metadata by not using capture flows that attach extra context.",
    ]);
  });
});
