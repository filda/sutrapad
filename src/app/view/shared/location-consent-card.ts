/**
 * In-app consent card for the geolocation capture preference. Shown
 * inside the detail-view editor stage whenever the
 * `captureLocationPreference` is `"unanswered"` (the default for new
 * users), so the cold-start user makes a deliberate decision before
 * the native browser prompt ever fires.
 *
 * Two states share the same card slot:
 *
 *   - `"idle"` — Allow / Not now buttons + a link to the full Privacy
 *                page. The default for a fresh `"unanswered"`
 *                preference. Allow flips the preference to `"on"`,
 *                Not now flips it to `"off"`; either decision sinks
 *                the card on the next render via the preference
 *                changing out of `"unanswered"`. Escape / click-away
 *                does NOT count as a decision — the card reappears
 *                next render with the preference still `"unanswered"`,
 *                because dismissing without choosing is a deferral,
 *                not a `"no"`.
 *   - `"blocked"` — replacement panel shown when the user clicked
 *                Allow but the browser's site-permission for
 *                geolocation is already `"denied"`. We can't surface
 *                the native prompt at all in that state, so the panel
 *                links to "open site settings" guidance instead of
 *                re-showing the Allow button. Resets on reload.
 */
import type { MenuItemId } from "../../logic/menu";

export type LocationConsentStatus = "idle" | "blocked";

export interface LocationConsentCardOptions {
  status: LocationConsentStatus;
  onAllow: () => void;
  onDeny: () => void;
  onSelectMenuItem: (id: MenuItemId) => void;
}

export function buildLocationConsentCard({
  status,
  onAllow,
  onDeny,
  onSelectMenuItem,
}: LocationConsentCardOptions): HTMLElement {
  const card = document.createElement("section");
  card.className = "location-consent-card";
  card.setAttribute("role", "region");
  card.setAttribute(
    "aria-label",
    "Capture location on new notes",
  );
  card.dataset.consentStatus = status;

  const heading = document.createElement("h2");
  heading.className = "location-consent-heading";
  heading.textContent =
    status === "blocked"
      ? "Your browser is blocking location"
      : "Tag new notes with where you are?";
  card.append(heading);

  const description = document.createElement("p");
  description.className = "location-consent-description";
  description.textContent =
    status === "blocked"
      ? "SutraPad asked for permission, but your browser is set to deny location for this site. Open your browser's site settings to allow it, then reload SutraPad."
      : "If you allow this, new notes will quietly include a place label and approximate coordinates — useful for filtering notes by where you wrote them later. We use OpenStreetMap's Nominatim to turn coordinates into a place name. Existing notes aren't touched.";
  card.append(description);

  const actions = document.createElement("div");
  actions.className = "location-consent-actions";

  if (status === "blocked") {
    // No primary action — the user has to leave the page to fix the
    // browser setting, then reload. We just document where to go.
    const privacy = buildSecondaryButton({
      label: "Read the full Privacy page",
      className: "location-consent-blocked-privacy",
      onClick: () => onSelectMenuItem("privacy"),
    });
    actions.append(privacy);
  } else {
    const allow = buildPrimaryButton({
      label: "Allow",
      className: "location-consent-allow",
      onClick: onAllow,
    });
    const deny = buildSecondaryButton({
      label: "Not now",
      className: "location-consent-deny",
      onClick: onDeny,
    });
    const privacy = buildLinkButton({
      label: "What does SutraPad do with this?",
      className: "location-consent-privacy-link",
      onClick: () => onSelectMenuItem("privacy"),
    });
    actions.append(allow, deny, privacy);
  }

  card.append(actions);
  return card;
}

interface ButtonOptions {
  label: string;
  /** Suffix class for the button — caller picks a role-specific name so CSS / tests can target it. */
  className: string;
  onClick: () => void;
}

function buildPrimaryButton({
  label,
  className,
  onClick,
}: ButtonOptions): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button button-primary ${className}`;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function buildSecondaryButton({
  label,
  className,
  onClick,
}: ButtonOptions): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button ${className}`;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function buildLinkButton({
  label,
  className,
  onClick,
}: ButtonOptions): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `is-link ${className}`;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}
