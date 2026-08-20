// @vitest-environment happy-dom
//
// First focused test for `src/app/view/shared/tag-pill.ts`. Every surface that
// shows a tag goes through this one builder — editor tag row, topbar filter
// strip, Tags-page cloud, Notes-page cloud, Home timeline, palette rows — so
// it was already executed by six suites and asserted by none of them beyond
// "the name is there". The `DEFERRED_FROM_MUTATION` reason said "asserted
// indirectly through the pills that build it", which is exactly the situation
// that hides a regression: a broken hue or a swapped element type still
// renders a pill with the right text.
//
// The three things the pill encodes, and therefore what this file pins:
//
//   1. **Class hue and symbol**, both derived from the tag string plus its
//      `kind`. They come out as the `--h` custom property and a `.tag-sym`
//      span; the CSS reads nothing else, so those two *are* the styling.
//   2. **Element type.** `<button>` when the whole pill is the interactive
//      surface, `<span>` when it is display-only or hosts an inner `×`
//      button — nesting a button inside a button would be invalid HTML and
//      would break keyboard focus.
//   3. **The modifier class list**, which is how every visual state (active,
//      muted, low-confidence, large, removable) reaches the stylesheet.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTagPill } from "../src/app/view/shared/tag-pill";
import { LOW_CONFIDENCE_THRESHOLD } from "../src/app/logic/auto-tag-confidence";

const tokens = (pill: HTMLElement): string[] => [...pill.classList];
const name = (pill: HTMLElement): string | null | undefined =>
  pill.querySelector(".tag-name")?.textContent;
const symbol = (pill: HTMLElement): string | null | undefined =>
  pill.querySelector(".tag-sym")?.textContent;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("buildTagPill classification", () => {
  it("renders a user tag as a topic pill with its hue and sigil", () => {
    const pill = buildTagPill({ tag: "praha", kind: "user" });

    expect(pill.tagName.toLowerCase()).toBe("span");
    expect(tokens(pill)).toEqual(["tag-pill", "tag-topic", "user"]);
    expect(pill.style.getPropertyValue("--h")).toBe("18");
    expect(symbol(pill)).toBe("#");
    expect(name(pill)).toBe("praha");
  });

  it("treats a missing kind as user-authored", () => {
    // Entries persisted before auto-tags existed carry no `kind`; classifying
    // them as auto would repaint an old notebook's tags in seven colours.
    const pill = buildTagPill({ tag: "praha", kind: undefined });

    expect(tokens(pill)).toContain("tag-topic");
    expect(tokens(pill)).toContain("user");
  });

  it("keeps a colon-carrying user tag on the topic class", () => {
    // `kind: "user"` is authoritative — a hand-typed `foo:bar` is not an
    // auto-tag just because it looks namespaced.
    const pill = buildTagPill({ tag: "date:today", kind: "user" });

    expect(tokens(pill)).toContain("tag-topic");
    expect(symbol(pill)).toBe("#");
  });

  it("routes each auto facet to its class token and sigil", () => {
    const rendered = [
      "date:today",
      "location:praha",
      "edit:fresh",
      "weather:rain",
      "author:filip",
      "os:windows",
    ].map((tag) => {
      const pill = buildTagPill({ tag, kind: "auto" });
      return `${tag} → ${tokens(pill).slice(1).join("+")} ${symbol(pill)}`;
    });

    // One assertion so a failure names the offending facet without a
    // per-assertion message (which this lint config disallows).
    expect(rendered).toEqual([
      "date:today → tag-when+auto ~",
      "location:praha → tag-place+auto @",
      "edit:fresh → tag-source+auto !",
      "weather:rain → tag-weather+auto ^",
      "author:filip → tag-people+auto *",
      "os:windows → tag-device+auto %",
    ]);
  });

  it("feeds each class hue into the --h custom property", () => {
    // The hue is the whole palette: border, background and text all read it.
    const hues = ["praha", "date:today", "location:praha", "edit:fresh"].map((tag, index) =>
      buildTagPill({ tag, kind: index === 0 ? "user" : "auto" }).style.getPropertyValue("--h"),
    );

    expect(hues).toEqual(["18", "260", "140", "45"]);
  });

  it("falls back to the source class for an unmapped facet", () => {
    // A new auto-tag facet shipped before this table learns about it must
    // still paint, not crash.
    const pill = buildTagPill({ tag: "mood:calm", kind: "auto" });

    expect(tokens(pill)).toContain("tag-source");
  });

  it("falls back to the source class for an auto tag with no facet at all", () => {
    const pill = buildTagPill({ tag: "bezfacetu", kind: "auto" });

    expect(tokens(pill)).toContain("tag-source");
  });

  it("shows only the value of a namespaced auto tag", () => {
    // The sigil already says "this is time-related", so reprinting `date:`
    // would be noise — and the Tags page searches on this displayed value.
    const pill = buildTagPill({ tag: "date:today", kind: "auto" });

    expect(name(pill)).toBe("today");
  });

  it("falls back to the whole string when the value half is empty", () => {
    const pill = buildTagPill({ tag: "date:", kind: "auto" });

    expect(name(pill)).toBe("date:");
  });

  it("drops the sigil when the caller asks it to", () => {
    const pill = buildTagPill({ tag: "praha", kind: "user", showSymbol: false });

    expect(pill.querySelector(".tag-sym")).toBeNull();
    expect(name(pill)).toBe("praha");
  });

  it("hides the sigil from screen readers", () => {
    // It is decoration: the class is already conveyed by the pill's own label.
    const pill = buildTagPill({ tag: "praha", kind: "user" });

    expect(pill.querySelector(".tag-sym")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("buildTagPill visual state", () => {
  it("adds one modifier token per state, and none by default", () => {
    expect(tokens(buildTagPill({ tag: "a", kind: "user" }))).toEqual([
      "tag-pill",
      "tag-topic",
      "user",
    ]);
    expect(tokens(buildTagPill({ tag: "a", kind: "user", active: true }))).toContain("active");
    expect(tokens(buildTagPill({ tag: "a", kind: "user", muted: true }))).toContain("muted");
    expect(tokens(buildTagPill({ tag: "a", kind: "user", lowConf: true }))).toContain("low-conf");
    expect(tokens(buildTagPill({ tag: "a", kind: "user", size: "lg" }))).toContain("tag-lg");
  });

  it("does not add a size token for the default size", () => {
    expect(tokens(buildTagPill({ tag: "a", kind: "user", size: "sm" }))).not.toContain("tag-lg");
  });

  it("stacks every modifier when several apply at once", () => {
    const pill = buildTagPill({
      tag: "a",
      kind: "user",
      active: true,
      muted: true,
      lowConf: true,
      size: "lg",
      onRemove: () => {},
    });

    expect(tokens(pill)).toEqual([
      "tag-pill",
      "tag-topic",
      "user",
      "tag-lg",
      "active",
      "low-conf",
      "muted",
      "removable",
    ]);
  });

  it("labels the pill for assistive tech only when asked", () => {
    expect(
      buildTagPill({ tag: "date:today", kind: "auto", ariaLabel: "when: today" }).getAttribute(
        "aria-label",
      ),
    ).toBe("when: today");
    expect(buildTagPill({ tag: "praha", kind: "user" }).hasAttribute("aria-label")).toBe(false);
  });
});

describe("buildTagPill confidence badge", () => {
  it("badges a low-confidence auto tag and dashes its border", () => {
    const pill = buildTagPill({ tag: "location:praha", kind: "auto", confidence: 0.42 });
    const badge = pill.querySelector(".tag-conf");

    expect(badge?.textContent).toBe("42%");
    expect(badge?.getAttribute("aria-label")).toBe("confidence 42 percent");
    // The badge and the dashed border are one decision: a pill never shows
    // one without the other.
    expect(tokens(pill)).toContain("low-conf");
  });

  it("rounds the percentage", () => {
    expect(
      buildTagPill({ tag: "location:praha", kind: "auto", confidence: 0.666 }).querySelector(
        ".tag-conf",
      )?.textContent,
    ).toBe("67%");
  });

  it("stays quiet at and above the threshold", () => {
    // The threshold is the boundary, not a "close enough" — a score exactly at
    // it is confident.
    const atThreshold = buildTagPill({
      tag: "location:praha",
      kind: "auto",
      confidence: LOW_CONFIDENCE_THRESHOLD,
    });

    expect(atThreshold.querySelector(".tag-conf")).toBeNull();
    expect(tokens(atThreshold)).not.toContain("low-conf");
  });

  it("badges a score just under the threshold", () => {
    const justUnder = buildTagPill({
      tag: "location:praha",
      kind: "auto",
      confidence: LOW_CONFIDENCE_THRESHOLD - 0.01,
    });

    expect(justUnder.querySelector(".tag-conf")).not.toBeNull();
  });

  it("ignores a confidence score on a user-authored tag", () => {
    // Hand-typed tags are authoritative by definition; showing "40% sure"
    // next to a word the user typed themselves would be nonsense.
    const pill = buildTagPill({ tag: "praha", kind: "user", confidence: 0.4 });

    expect(pill.querySelector(".tag-conf")).toBeNull();
    expect(tokens(pill)).not.toContain("low-conf");
  });

  it("honours an explicit lowConf without inventing a percentage", () => {
    const pill = buildTagPill({ tag: "location:praha", kind: "auto", lowConf: true });

    expect(tokens(pill)).toContain("low-conf");
    expect(pill.querySelector(".tag-conf")).toBeNull();
  });
});

describe("buildTagPill count tail", () => {
  it("renders a numeric count as-is", () => {
    const pill = buildTagPill({ tag: "praha", kind: "user", count: 12 });

    expect(pill.querySelector(".tag-count")?.textContent).toBe("12");
  });

  it("passes a pre-formatted count through untouched", () => {
    // Callers that want the separator glyph pass `"· 12"`; re-formatting here
    // would double the separator.
    const pill = buildTagPill({ tag: "praha", kind: "user", count: "· 12" });

    expect(pill.querySelector(".tag-count")?.textContent).toBe("· 12");
  });

  it("renders a zero count rather than treating it as absent", () => {
    const pill = buildTagPill({ tag: "praha", kind: "user", count: 0 });

    expect(pill.querySelector(".tag-count")?.textContent).toBe("0");
  });

  it("omits the tail when no count is given", () => {
    expect(buildTagPill({ tag: "praha", kind: "user" }).querySelector(".tag-count")).toBeNull();
  });

  it("puts the confidence badge before the count", () => {
    const pill = buildTagPill({
      tag: "location:praha",
      kind: "auto",
      confidence: 0.3,
      count: "· 4",
    });

    expect([...pill.children].map((child) => child.className)).toEqual([
      "tag-sym",
      "tag-name",
      "tag-conf mono",
      "tag-count mono",
    ]);
  });
});

describe("buildTagPill interaction surface", () => {
  it("becomes a button when the whole pill is clickable", () => {
    const onClick = vi.fn();
    const pill = buildTagPill({ tag: "praha", kind: "user", onClick });

    expect(pill.tagName.toLowerCase()).toBe("button");
    expect((pill as HTMLButtonElement).type).toBe("button");
    pill.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("stays a span and hosts an inner button when it can be removed", () => {
    // A button inside a button is invalid HTML and loses keyboard focus for
    // the inner one.
    const onRemove = vi.fn();
    const pill = buildTagPill({ tag: "praha", kind: "user", onRemove });
    const remove = pill.querySelector<HTMLButtonElement>(".tag-x");

    expect(pill.tagName.toLowerCase()).toBe("span");
    expect(remove?.type).toBe("button");
    expect(remove?.getAttribute("aria-label")).toBe("Remove");
    remove?.click();
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("names what the remove button removes when the caller says so", () => {
    const pill = buildTagPill({
      tag: "praha",
      kind: "user",
      onRemove: () => {},
      removeAriaLabel: "Remove filter praha",
    });

    expect(pill.querySelector(".tag-x")?.getAttribute("aria-label")).toBe(
      "Remove filter praha",
    );
  });

  it("keeps a remove click from reaching a clickable ancestor", () => {
    // Chips sit inside palette rows and toolbars that have their own click
    // handlers; without the stopPropagation the × both removes the tag and
    // triggers the row.
    const onRemove = vi.fn();
    const onRow = vi.fn();
    const row = document.createElement("div");
    row.addEventListener("click", onRow);
    row.append(buildTagPill({ tag: "praha", kind: "user", onRemove }));
    document.body.append(row);

    row
      .querySelector<HTMLButtonElement>(".tag-x")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onRemove).toHaveBeenCalledOnce();
    expect(onRow).not.toHaveBeenCalled();
  });

  it("draws the × as a decorative inline SVG", () => {
    const pill = buildTagPill({ tag: "praha", kind: "user", onRemove: () => {} });
    const svg = pill.querySelector(".tag-x svg");

    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 12 12");
    expect(svg?.getAttribute("width")).toBe("9");
    // A stroke-only glyph: a fill would paint the two crossing lines solid.
    expect(svg?.querySelector("path")?.getAttribute("fill")).toBe("none");
    expect(svg?.querySelector("path")?.getAttribute("d")).toBe("M3 3l6 6M9 3l-6 6");
    expect(svg?.querySelector("path")?.getAttribute("stroke")).toBe("currentColor");
    // Both nodes have to be in the SVG namespace or the browser paints
    // nothing, and the geometry attributes are what size the glyph inside the
    // 12-unit viewBox.
    expect(svg?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(svg?.querySelector("path")?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(svg?.getAttribute("height")).toBe("9");
    expect(svg?.querySelector("path")?.getAttribute("stroke-width")).toBe("1.6");
    expect(svg?.querySelector("path")?.getAttribute("stroke-linecap")).toBe("round");
    // `display: block` kills the inline-baseline gap that would push the ×
    // off-centre inside the chip.
    expect((svg as SVGElement | null)?.style.display).toBe("block");
  });

  it("refuses to be both clickable and removable", () => {
    // Ambiguous a11y semantics — is a body click a filter toggle or a remove?
    expect(() =>
      buildTagPill({ tag: "praha", kind: "user", onClick: () => {}, onRemove: () => {} }),
    ).toThrow("buildTagPill: pass either onClick or onRemove, not both.");
  });

  it("is a plain span with no listener when neither handler is given", () => {
    const pill = buildTagPill({ tag: "praha", kind: "user" });

    expect(pill.tagName.toLowerCase()).toBe("span");
    expect(pill.querySelector(".tag-x")).toBeNull();
    expect(tokens(pill)).not.toContain("removable");
  });
});
