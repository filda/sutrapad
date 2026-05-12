// @vitest-environment happy-dom
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

    expect(card.getAttribute("data-consent-status")).toBe("blocked");
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
    expect(idle.getAttribute("data-consent-status")).toBe("idle");
    expect(blocked.getAttribute("data-consent-status")).toBe("blocked");
  });
});
