// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildLocationConsentCard } from "../src/app/view/shared/location-consent-card";

/**
 * The card is a pure DOM builder — happy-dom env is enough; no atom /
 * store wiring is needed. We exercise both branches (idle vs. blocked)
 * and the click callbacks; the "preference flips out of unanswered ⇒
 * card disappears" path is handled by the calling render code and
 * lives in the integration layer, not here.
 */

describe("buildLocationConsentCard", () => {
  it("renders the idle state with Allow, Not now, and a Privacy link, each pinned to its exact copy", () => {
    const card = buildLocationConsentCard({
      status: "idle",
      onAllow: () => {},
      onDeny: () => {},
      onSelectMenuItem: () => {},
    });

    // Wrapper structural assertions.
    expect(card.className).toBe("location-consent-card");
    expect(card.getAttribute("role")).toBe("region");
    expect(card.getAttribute("aria-label")).toBe(
      "Capture location on new notes",
    );

    // Idle copy. Pin verbatim so any future copy edit goes through a
    // deliberate test update, and so Stryker can't silently empty out
    // a label without a survivor showing up in CI.
    const heading = card.querySelector(".location-consent-heading");
    expect(heading?.textContent).toBe("Tag new notes with where you are?");

    const description = card.querySelector(".location-consent-description");
    expect(description?.textContent).toBe(
      "If you allow this, new notes will quietly include a place label and approximate coordinates — useful for filtering notes by where you wrote them later. We use OpenStreetMap's Nominatim to turn coordinates into a place name. Existing notes aren't touched.",
    );

    const allow = card.querySelector(".location-consent-allow");
    expect(allow?.textContent).toBe("Allow");

    const deny = card.querySelector(".location-consent-deny");
    expect(deny?.textContent).toBe("Not now");

    const privacy = card.querySelector(".location-consent-privacy-link");
    expect(privacy?.textContent).toBe("What does SutraPad do with this?");

    // The buttons live inside a dedicated wrapper so CSS can lay them
    // out as a row distinct from the heading / description block.
    // Stylesheet relies on this hook, so pin it.
    expect(card.querySelector(".location-consent-actions")).not.toBeNull();
  });

  it("fires onAllow when the Allow button is clicked", () => {
    const onAllow = vi.fn();
    const card = buildLocationConsentCard({
      status: "idle",
      onAllow,
      onDeny: () => {},
      onSelectMenuItem: () => {},
    });
    card.querySelector<HTMLButtonElement>(".location-consent-allow")?.click();
    expect(onAllow).toHaveBeenCalledTimes(1);
  });

  it("fires onDeny when the Not now button is clicked", () => {
    const onDeny = vi.fn();
    const card = buildLocationConsentCard({
      status: "idle",
      onAllow: () => {},
      onDeny,
      onSelectMenuItem: () => {},
    });
    card.querySelector<HTMLButtonElement>(".location-consent-deny")?.click();
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it("routes the Privacy link to the privacy menu item via onSelectMenuItem", () => {
    const onSelectMenuItem = vi.fn();
    const card = buildLocationConsentCard({
      status: "idle",
      onAllow: () => {},
      onDeny: () => {},
      onSelectMenuItem,
    });
    card
      .querySelector<HTMLButtonElement>(".location-consent-privacy-link")
      ?.click();
    expect(onSelectMenuItem).toHaveBeenCalledWith("privacy");
  });

  it("renders the blocked state with its specific heading, description, and only the Privacy link", () => {
    // Allow doesn't make sense in this state — the browser will deny
    // any attempt immediately. The user has to leave SutraPad to fix
    // the site setting, so the card surfaces guidance and the link to
    // the full Privacy page, nothing else actionable in-card.
    const card = buildLocationConsentCard({
      status: "blocked",
      onAllow: () => {},
      onDeny: () => {},
      onSelectMenuItem: () => {},
    });

    expect(card.dataset.consentStatus).toBe("blocked");
    expect(card.querySelector(".location-consent-heading")?.textContent).toBe(
      "Your browser is blocking location",
    );
    expect(
      card.querySelector(".location-consent-description")?.textContent,
    ).toBe(
      "SutraPad asked for permission, but your browser is set to deny location for this site. Open your browser's site settings to allow it, then reload SutraPad.",
    );
    // No Allow / Not now / idle-privacy buttons.
    expect(card.querySelector(".location-consent-allow")).toBeNull();
    expect(card.querySelector(".location-consent-deny")).toBeNull();
    expect(card.querySelector(".location-consent-privacy-link")).toBeNull();
    // The blocked-state Privacy button uses its own class so it can be
    // styled / queried distinctly from the idle-state link.
    expect(
      card.querySelector(".location-consent-blocked-privacy"),
    ).not.toBeNull();
  });

  it("blocked state still surfaces a Privacy link so the user can read the full disclosure", () => {
    const onSelectMenuItem = vi.fn();
    const card = buildLocationConsentCard({
      status: "blocked",
      onAllow: () => {},
      onDeny: () => {},
      onSelectMenuItem,
    });
    const link = card.querySelector<HTMLButtonElement>(
      ".location-consent-blocked-privacy",
    );
    expect(link?.textContent).toBe("Read the full Privacy page");
    link?.click();
    expect(onSelectMenuItem).toHaveBeenCalledWith("privacy");
  });

  it("carries the idle / blocked status on a data attribute for CSS hooks", () => {
    // Useful for the CSS that paints the blocked state in a warning
    // tone. Pinning the attribute now keeps the styling stable when
    // someone adds the rule later.
    const idle = buildLocationConsentCard({
      status: "idle",
      onAllow: () => {},
      onDeny: () => {},
      onSelectMenuItem: () => {},
    });
    const blocked = buildLocationConsentCard({
      status: "blocked",
      onAllow: () => {},
      onDeny: () => {},
      onSelectMenuItem: () => {},
    });
    expect(idle.dataset.consentStatus).toBe("idle");
    expect(blocked.dataset.consentStatus).toBe("blocked");
  });
});

/*
 * Regression for the "rozsypaný" detail page bug. `.editor-stage` is a
 * two-column grid (`minmax(0, 1fr) 340px`). When the consent card is
 * appended as a sibling of the editor card and the sidebar, CSS grid
 * auto-place puts the consent card in col 1 and the editor card in col
 * 2 — shoving the editor into the 340 px sidebar slot and pushing the
 * actual sidebar onto row 2. The fix is a CSS rule that spans the
 * consent card across both columns. The test reads styles.css directly
 * because happy-dom doesn't compute grid placement (so a DOM-level
 * `getComputedStyle` check would silently pass before the fix as well).
 */
describe("editor-stage layout for the consent card", () => {
  // happy-dom rewrites globals enough that `readFile(new URL(..., import.meta.url))`
  // rejects with "URL must be of scheme file" — `import.meta.url` lands as an
  // http: URL inside the synthetic document. Resolve against `process.cwd()`
  // (= project root under vitest) so the read works regardless of the test
  // environment's URL contract.
  const stylesheetPath = resolve("src/styles.css");

  it("makes the consent card span both columns of the detail grid", async () => {
    const css = await readFile(stylesheetPath, "utf-8");
    // Slice the matching rule body, then assert the column-spanning
    // declaration is present inside it. Regex over the whole file would
    // produce a passing match even if the declaration drifted into a
    // sibling rule.
    const ruleBody = extractRuleBody(
      css,
      ".editor-stage > .location-consent-card",
    );
    expect(ruleBody).not.toBeNull();
    // `1 / -1` is the canonical "span every column" shorthand. Pin the
    // exact form so a future drift to `1 / span 2` (which silently
    // breaks the 1-column mobile layout under `@media (max-width: 900px)`
    // where the grid drops to a single column) gets caught.
    expect(ruleBody).toMatch(/grid-column:\s*1\s*\/\s*-1/);
  });

  it("ships a styled .location-consent-card surface so the section isn't unstyled HTML", () => {
    // Before this fix shipped the class only existed on the DOM element
    // — no matching rule in the stylesheet meant the section rendered
    // with default browser margins and no border / padding. Pin the
    // baseline presence of the rule + its core surface declarations so
    // a future cleanup that nukes the rule (thinking it's dead) gets
    // caught.
    return readFile(stylesheetPath, "utf-8").then((css) => {
      const ruleBody = extractRuleBody(css, ".location-consent-card");
      expect(ruleBody).not.toBeNull();
      // Three baseline declarations that turn the bare <section> into
      // an actual card surface. We don't pin the exact values (those
      // can drift with design tweaks), only that the property names
      // are present.
      expect(ruleBody).toMatch(/padding\s*:/);
      expect(ruleBody).toMatch(/border\s*:/);
      expect(ruleBody).toMatch(/background\s*:/);
    });
  });
});

/**
 * Finds the body of the first CSS rule whose selector list equals
 * `selector`. Returns null when no rule matches. Naive — assumes no
 * nested `{ }` inside the rule body, which is true for the surface
 * declarations under test. Lifted into a helper so both tests above
 * read the same way and a future fourth-test addition can reuse it.
 */
function extractRuleBody(css: string, selector: string): string | null {
  // Escape regex metacharacters in the selector so `.`, `>`, `(`, etc.
  // are treated literally. The selector we care about contains `.` and
  // `>`, both of which are regex-meta.
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    String.raw`(?:^|\}|\*\/|\n)\s*` + escaped + String.raw`\s*\{([^}]*)\}`,
    "m",
  );
  const match = pattern.exec(css);
  return match === null ? null : match[1];
}
