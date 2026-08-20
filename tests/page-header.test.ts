// @vitest-environment happy-dom
//
// First focused test for `src/app/view/shared/page-header.ts`. Nine pages
// build their header through it, so it was executed constantly and asserted
// only via "the eyebrow text is right" — its actual feature, the intro that
// fades away once you've seen a page eleven times, had no coverage at all.
//
// Two things make that feature easy to break invisibly:
//
//   - **The visit counter is bumped and persisted at build time**, and the
//     collapsed state is evaluated against the *freshly incremented* count.
//     Read-then-bump would render the 11th visit expanded once and fade on the
//     12th — an off-by-one nobody would notice in review.
//   - **Expanding pins the page forever.** A user who re-opens a faded intro
//     has said they want it; the auto-fade rule must never quietly take it
//     back on the next visit. That is a `pinned` flag in localStorage, which
//     only a multi-build test can observe.
//
// `AUTO_FADE_AFTER` is imported rather than hard-coded: the boundary is the
// contract, the number is a tuning knob.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPageHeader } from "../src/app/view/shared/page-header";
import { AUTO_FADE_AFTER } from "../src/app/logic/page-intro";

const STORAGE_KEY = "sp.intros.v1";

const readStore = (): Record<string, { visits: number; dismissed: boolean; pinned: boolean }> =>
  JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");

/** Builds the header `times` times, returning the last one — the app rebuilds
 * it on every render, so "visits" and "builds" are the same thing. */
function buildTimes(times: number, options: Parameters<typeof buildPageHeader>[0]) {
  let header = buildPageHeader(options);
  for (let index = 1; index < times; index += 1) header = buildPageHeader(options);
  return header;
}

const BASIC = {
  pageId: "notes",
  eyebrow: "Notes · 12 unique",
  title: { before: "A ", emphasis: "constellation", after: " of notes." },
  subtitle: "Everything you have captured.",
} as const;

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("buildPageHeader structure", () => {
  it("renders the eyebrow, title and subtitle", () => {
    const header = buildPageHeader({ ...BASIC });

    expect(header.className).toBe("page-header");
    expect(header.querySelector(".page-eyebrow-label")?.textContent).toBe("Notes · 12 unique");
    expect(header.querySelector(".page-title")?.tagName.toLowerCase()).toBe("h1");
    expect(header.querySelector(".page-title")?.textContent).toBe(
      "A constellation of notes.",
    );
    expect(header.querySelector(".page-subtitle")?.textContent).toBe(
      "Everything you have captured.",
    );
  });

  it("italicises just the emphasis word of a structured title", () => {
    const header = buildPageHeader({ ...BASIC });

    expect(header.querySelector(".page-title em")?.textContent).toBe("constellation");
  });

  it("renders a title with no trailing text", () => {
    // `before` and `after` are both optional; the header's own type requires
    // the structured form, so the plain-string branch of `appendPageTitle`
    // belongs to `page-title.ts`, not here.
    const header = buildPageHeader({ ...BASIC, title: { emphasis: "Settings" } });

    expect(header.querySelector(".page-title")?.textContent).toBe("Settings");
    expect(header.querySelector(".page-title em")?.textContent).toBe("Settings");
  });

  it("omits the subtitle when a page has none", () => {
    const header = buildPageHeader({ ...BASIC, subtitle: undefined });

    expect(header.querySelector(".page-subtitle")).toBeNull();
  });

  it("makes the whole eyebrow strip one toggle button", () => {
    const header = buildPageHeader({ ...BASIC });
    const toggle = header.querySelector<HTMLButtonElement>(".page-eyebrow-toggle");

    expect(toggle?.type).toBe("button");
    expect(toggle?.className).toBe("page-eyebrow page-eyebrow-toggle");
    // Label and chevron both inside, so there is no dead zone between them.
    expect(toggle?.querySelector(".page-eyebrow-label")).not.toBeNull();
    expect(toggle?.querySelector(".page-eyebrow-chev")).not.toBeNull();
  });

  it("draws the chevron as a decorative stroke-only glyph", () => {
    const header = buildPageHeader({ ...BASIC });
    const chevron = header.querySelector(".page-eyebrow-chev");

    expect(chevron?.getAttribute("aria-hidden")).toBe("true");
    expect(chevron?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(chevron?.getAttribute("fill")).toBe("none");
    expect(chevron?.getAttribute("stroke")).toBe("currentColor");
    expect(chevron?.querySelector("path")?.getAttribute("d")).toBe("M6 9l6 6 6-6");
    // Namespace and stroke geometry: an SVG built in the HTML namespace paints
    // nothing at all, and the round joins are what make the chevron read as a
    // hand-drawn mark rather than a mitred arrow.
    expect(chevron?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(chevron?.querySelector("path")?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(chevron?.getAttribute("width")).toBe("10");
    expect(chevron?.getAttribute("height")).toBe("10");
    expect(chevron?.getAttribute("stroke-width")).toBe("2.5");
    expect(chevron?.getAttribute("stroke-linecap")).toBe("round");
    expect(chevron?.getAttribute("stroke-linejoin")).toBe("round");
  });

  it("wraps the text block so the actions can sit opposite it", () => {
    const header = buildPageHeader({ ...BASIC });

    expect(header.querySelector(".page-header-text")).not.toBeNull();
    expect(header.querySelector(".page-header-text .page-title")).not.toBeNull();
    expect(header.querySelector(".page-header-text .page-subtitle")).not.toBeNull();
  });

  it("renders an actions slot only when the page supplies one", () => {
    expect(buildPageHeader({ ...BASIC }).querySelector(".page-header-actions")).toBeNull();

    const button = document.createElement("button");
    const header = buildPageHeader({ ...BASIC, actions: button });

    expect(header.querySelector(".page-header-actions")?.firstElementChild).toBe(button);
  });

  it("accepts several actions in order", () => {
    const first = document.createElement("button");
    first.textContent = "All";
    const second = document.createElement("button");
    second.textContent = "Clear";

    const header = buildPageHeader({ ...BASIC, actions: [first, second] });

    expect(
      [...(header.querySelector(".page-header-actions")?.children ?? [])].map(
        (child) => child.textContent,
      ),
    ).toEqual(["All", "Clear"]);
  });
});

describe("buildPageHeader intro fade", () => {
  it("counts every build as a visit and persists it immediately", () => {
    buildPageHeader({ ...BASIC });
    expect(readStore().notes.visits).toBe(1);

    buildPageHeader({ ...BASIC });
    expect(readStore().notes.visits).toBe(2);
  });

  it("keeps its counter separate per page", () => {
    buildPageHeader({ ...BASIC });
    buildPageHeader({ ...BASIC, pageId: "tags" });
    buildPageHeader({ ...BASIC, pageId: "tags" });

    expect(readStore().notes.visits).toBe(1);
    expect(readStore().tags.visits).toBe(2);
  });

  it("shows the full lockup for exactly the first AUTO_FADE_AFTER visits", () => {
    const header = buildTimes(AUTO_FADE_AFTER, { ...BASIC });

    expect(header.classList.contains("is-collapsed")).toBe(false);
    expect(header.querySelector<HTMLElement>(".page-title")?.hidden).toBe(false);
    expect(header.querySelector(".page-eyebrow-toggle")?.getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("folds the intro away on the next visit after that", () => {
    // The bump-then-evaluate order is what makes this the 11th build rather
    // than the 12th: reading before bumping would render one expanded pass too
    // many.
    const header = buildTimes(AUTO_FADE_AFTER + 1, { ...BASIC });

    expect(header.classList.contains("is-collapsed")).toBe(true);
    expect(header.querySelector<HTMLElement>(".page-title")?.hidden).toBe(true);
    expect(header.querySelector<HTMLElement>(".page-subtitle")?.hidden).toBe(true);
    expect(header.querySelector(".page-eyebrow-toggle")?.getAttribute("aria-expanded")).toBe(
      "false",
    );
    // The eyebrow chip itself stays — it is the affordance for getting the
    // intro back.
    expect(header.querySelector(".page-eyebrow-label")?.textContent).toBe(BASIC.eyebrow);
  });

  it("hides the actions along with the intro", () => {
    const actions = document.createElement("button");
    const header = buildTimes(AUTO_FADE_AFTER + 1, { ...BASIC, actions });

    expect(header.querySelector<HTMLElement>(".page-header-actions")?.hidden).toBe(true);
  });

  it("never auto-fades a page whose copy keeps changing", () => {
    // Home's greeting and daily counts are the reason `noAutoFade` exists:
    // fading them would hide content the user has not seen before.
    const header = buildTimes(AUTO_FADE_AFTER + 5, { ...BASIC, noAutoFade: true });

    expect(header.classList.contains("is-collapsed")).toBe(false);
  });

  it("titles the toggle with the action it will perform", () => {
    expect(
      buildPageHeader({ ...BASIC }).querySelector<HTMLButtonElement>(".page-eyebrow-toggle")
        ?.title,
    ).toBe("Collapse intro");
    localStorage.clear();
    expect(
      buildTimes(AUTO_FADE_AFTER + 1, { ...BASIC }).querySelector<HTMLButtonElement>(
        ".page-eyebrow-toggle",
      )?.title,
    ).toBe("Expand intro");
  });
});

describe("buildPageHeader toggle", () => {
  // The `{ noAutoFade }` option passed to `isIntroCollapsed` inside the click
  // handler is an equivalent mutant when emptied: every toggle writes either
  // `dismissed: true` or `pinned: true`, and both short-circuit ahead of the
  // visit-count rule the option guards. Only the build-time call can observe
  // it, and that one is covered above.

  it("collapses on click and records the dismissal", () => {
    const header = buildPageHeader({ ...BASIC });

    header.querySelector<HTMLButtonElement>(".page-eyebrow-toggle")?.click();

    expect(header.classList.contains("is-collapsed")).toBe(true);
    expect(header.querySelector<HTMLElement>(".page-title")?.hidden).toBe(true);
    expect(readStore().notes.dismissed).toBe(true);
  });

  it("expands again on a second click", () => {
    const header = buildPageHeader({ ...BASIC });
    const toggle = header.querySelector<HTMLButtonElement>(".page-eyebrow-toggle");

    toggle?.click();
    toggle?.click();

    expect(header.classList.contains("is-collapsed")).toBe(false);
    expect(readStore().notes.dismissed).toBe(false);
  });

  it("survives a dismissal across rebuilds", () => {
    buildPageHeader({ ...BASIC }).querySelector<HTMLButtonElement>(
      ".page-eyebrow-toggle",
    )?.click();

    const rebuilt = buildPageHeader({ ...BASIC });

    expect(rebuilt.classList.contains("is-collapsed")).toBe(true);
  });

  it("pins a re-expanded intro so the fade rule never takes it back", () => {
    // The user opened a faded intro on purpose. Auto-fading it again on the
    // next visit would read as the app fighting them.
    const faded = buildTimes(AUTO_FADE_AFTER + 1, { ...BASIC });
    expect(faded.classList.contains("is-collapsed")).toBe(true);

    faded.querySelector<HTMLButtonElement>(".page-eyebrow-toggle")?.click();
    expect(readStore().notes.pinned).toBe(true);

    const nextVisit = buildPageHeader({ ...BASIC });

    expect(nextVisit.classList.contains("is-collapsed")).toBe(false);
  });

  it("keeps the pin through a later manual collapse", () => {
    // Pinning is sticky: a user who collapses a pinned intro by hand can
    // re-expand it without the fade rule stepping back in.
    const header = buildTimes(AUTO_FADE_AFTER + 1, { ...BASIC });
    const toggle = header.querySelector<HTMLButtonElement>(".page-eyebrow-toggle");
    toggle?.click(); // expand → pins
    toggle?.click(); // collapse again by hand

    expect(readStore().notes.pinned).toBe(true);
    expect(readStore().notes.dismissed).toBe(true);
  });

  it("re-reads the store on each click so another tab is not trampled", () => {
    // Two windows on the same notebook: the toggle merges into whatever is on
    // disk now rather than overwriting with its own stale snapshot.
    const header = buildPageHeader({ ...BASIC });
    const store = readStore();
    store.tags = { visits: 3, dismissed: true, pinned: false };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));

    header.querySelector<HTMLButtonElement>(".page-eyebrow-toggle")?.click();

    expect(readStore().tags).toEqual({ visits: 3, dismissed: true, pinned: false });
    expect(readStore().notes.dismissed).toBe(true);
  });

  it("still renders when storage refuses to answer", () => {
    // Private-mode Safari throws on `getItem`; the header is chrome, so it has
    // to degrade to "always expanded" rather than take the page down.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    const header = buildPageHeader({ ...BASIC });

    expect(header.querySelector(".page-title")?.textContent).toBe("A constellation of notes.");
    expect(header.classList.contains("is-collapsed")).toBe(false);
    vi.restoreAllMocks();
  });
});
