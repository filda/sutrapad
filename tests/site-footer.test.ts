// @vitest-environment happy-dom
//
// First focused test for `src/app/view/chrome/site-footer.ts` — the four-column
// footer. Static-looking, and that is the risk: the only thing standing between
// this file and a broken external link is the link table itself, which no test
// read. Three things carry real weight:
//
//   - **internal vs external links are different elements.** Internal ones are
//     `<button>`s routed through the shared `onSelectMenuItem`; external ones
//     are `<a target="_blank">` with `rel="noopener noreferrer"`. Dropping the
//     rel is a tabnabbing hole, and turning an internal link into an anchor
//     would full-page-reload the SPA.
//   - **the copyright year resolves at render time**, so a session that
//     survives New Year's Eve flips on its own. Frozen time is the only way to
//     assert that without the test rotting each January.
//   - **no `innerHTML` anywhere** — the module's own header says a grep should
//     keep showing zero hits, so the build stamp goes in as text.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSiteFooter } from "../src/app/view/chrome/site-footer";

const STAMP = "v0.3.0 • abc1234 • 2026-04-21 10:00";

function mount() {
  const onSelectMenuItem = vi.fn();
  const footer = buildSiteFooter({ buildStamp: STAMP, onSelectMenuItem });
  document.body.append(footer);
  return { footer, onSelectMenuItem };
}

const columnHeads = (footer: HTMLElement): Array<string | null> =>
  [...footer.querySelectorAll(".site-footer-col-head")].map((node) => node.textContent);

/** Link labels inside one footer column, in render order. */
const labelsIn = (column: Element): Array<string | null> =>
  [...column.querySelectorAll("li .site-footer-link")].map((link) => link.textContent);

/** `label → element` for every link in the footer, in render order. */
const links = (footer: HTMLElement): HTMLElement[] =>
  [...footer.querySelectorAll<HTMLElement>(".site-footer-link")];

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-21T10:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildSiteFooter layout", () => {
  it("renders the brand block, four columns, a rule and the base row", () => {
    const { footer } = mount();

    expect(footer.tagName.toLowerCase()).toBe("footer");
    expect(footer.className).toBe("site-footer");
    expect([...footer.children].map((child) => child.className)).toEqual([
      "site-footer-inner",
      "site-footer-rule",
      "site-footer-base",
    ]);
    expect(
      [...(footer.querySelector(".site-footer-inner")?.children ?? [])].map(
        (child) => child.className,
      ),
    ).toEqual([
      "site-footer-brand",
      "site-footer-col",
      "site-footer-col",
      "site-footer-col",
      "site-footer-col",
    ]);
  });

  it("hides the decorative rule from screen readers", () => {
    const { footer } = mount();
    const rule = footer.querySelector(".site-footer-rule");

    expect(rule?.tagName.toLowerCase()).toBe("hr");
    expect(rule?.getAttribute("aria-hidden")).toBe("true");
  });

  it("carries the wordmark and the tagline", () => {
    const { footer } = mount();

    expect(footer.querySelector(".site-footer-wordmark")?.textContent).toBe("Sutrapad");
    expect(footer.querySelector(".site-footer-tagline")?.textContent).toBe(
      "A notebook for the way you already think — by hand, by place, by mood. " +
        "Save everything to your own drive. Never the system of record.",
    );
  });

  it("names the four columns in order", () => {
    const { footer } = mount();

    expect(columnHeads(footer)).toEqual(["Sutrapad", "Use", "Sources", "Legal"]);
  });

  it("lists every link as a list item under its column", () => {
    const { footer } = mount();
    const perColumn = [...footer.querySelectorAll(".site-footer-col")].map((column) =>
      labelsIn(column),
    );

    expect(perColumn).toEqual([
      ["About"],
      ["Capture setup", "Shortcuts"],
      ["GitHub repository", "OpenStreetMap", "Nominatim"],
      ["Privacy", "Terms"],
    ]);
    expect(footer.querySelectorAll(".site-footer-col-list")).toHaveLength(4);
  });
});

describe("buildSiteFooter links", () => {
  it("routes internal links through the shared navigation callback", () => {
    const { footer, onSelectMenuItem } = mount();
    const internal = links(footer).filter(
      (link) => link.tagName.toLowerCase() === "button",
    );

    expect(internal.map((link) => link.textContent)).toEqual([
      "About",
      "Capture setup",
      "Shortcuts",
      "Privacy",
      "Terms",
    ]);
    expect(internal.every((link) => (link as HTMLButtonElement).type === "button")).toBe(true);
    expect(internal.every((link) => link.className === "is-link site-footer-link")).toBe(true);

    for (const link of internal) link.click();
    expect(onSelectMenuItem.mock.calls.flat()).toEqual([
      "about",
      "capture",
      "shortcuts",
      "privacy",
      "terms",
    ]);
  });

  it("opens external links in a new tab with the tabnabbing guard", () => {
    const { footer } = mount();
    const external = [...footer.querySelectorAll<HTMLAnchorElement>("a.site-footer-link")];

    expect(external.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["GitHub repository", "https://github.com/filda/sutrapad"],
      ["OpenStreetMap", "https://www.openstreetmap.org/"],
      ["Nominatim", "https://nominatim.openstreetmap.org/"],
    ]);
    // `target="_blank"` without `noopener` hands the opened page a handle on
    // this window; `noreferrer` keeps the notebook URL out of their logs.
    expect(external.every((link) => link.target === "_blank")).toBe(true);
    expect(external.every((link) => link.rel === "noopener noreferrer")).toBe(true);
  });

  it("does not navigate the SPA away for an internal link", () => {
    // An internal entry rendered as an anchor would reload the whole app and
    // drop unsaved editor state.
    const { footer } = mount();
    const about = links(footer).find((link) => link.textContent === "About");

    expect(about?.tagName.toLowerCase()).toBe("button");
    expect(about?.hasAttribute("href")).toBe(false);
  });

  it("credits both map sources it uses", () => {
    // Attribution is a licence requirement for OSM / Nominatim, not decoration.
    const { footer } = mount();
    const hrefs = [...footer.querySelectorAll("a")].map((link) => link.getAttribute("href"));

    expect(hrefs).toContain("https://www.openstreetmap.org/");
    expect(hrefs).toContain("https://nominatim.openstreetmap.org/");
  });
});

describe("buildSiteFooter base row", () => {
  it("stamps the current year next to the licence", () => {
    const { footer } = mount();

    expect(footer.querySelector(".site-footer-copy")?.textContent).toBe(
      "© 2026 Sutrapad · MIT license",
    );
  });

  it("re-resolves the year on the next render", () => {
    // A session left open across New Year's Eve flips without a reload.
    vi.setSystemTime(new Date("2027-01-01T00:30:00.000Z"));
    const { footer } = mount();

    expect(footer.querySelector(".site-footer-copy")?.textContent).toBe(
      "© 2027 Sutrapad · MIT license",
    );
  });

  it("prints the caller's build stamp verbatim as text", () => {
    const { footer } = mount();
    const stamp = footer.querySelector(".site-footer-stamp");

    expect(stamp?.textContent).toBe(STAMP);
    expect(stamp?.children).toHaveLength(0);
  });

  it("keeps the copyright before the stamp", () => {
    const { footer } = mount();

    expect(
      [...(footer.querySelector(".site-footer-base")?.children ?? [])].map((c) => c.className),
    ).toEqual(["site-footer-copy", "site-footer-stamp"]);
  });
});
