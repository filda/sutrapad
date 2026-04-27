/**
 * Privacy page — disclosure of what data SutraPad handles, why, and
 * where it goes. Content is the in-app rendering of
 * `docs/privacy-page-draft.md`; copy lives there as the canonical
 * source of truth and is mirrored here as a typed DOM tree so the page
 * doesn't need a markdown parser at runtime.
 *
 * **All textual content is set via `textContent`** (not `innerHTML`)
 * so even though the strings are static today, a future contributor
 * dropping a user-controlled string into one of the helpers can't
 * accidentally regress the no-innerHTML invariant the rest of the view
 * layer keeps.
 *
 * **Updating copy:** keep `docs/privacy-page-draft.md` and this module
 * in lockstep. The "Sources of truth" line in the draft links back to
 * this file so the round-trip is documented.
 */

import { buildStaticPageShell } from "../chrome/static-page-shell";
import type { MenuItemId } from "../../logic/menu";

export interface PrivacyPageOptions {
  /** Threaded through to the shell's back link. */
  onSelectMenuItem: (id: MenuItemId) => void;
}

export function buildPrivacyPage({
  onSelectMenuItem,
}: PrivacyPageOptions): HTMLElement {
  const intro = buildParagraph(
    "SutraPad is a client-only app that runs in your browser. We do not operate a SutraPad backend that stores your notes on our servers. Your data stays in your browser and in your own Google Drive, depending on which feature you use.",
  );
  const introCategories = buildParagraph(
    "We group data into three categories so it is easier to understand what is required, what is optional, and what you can turn off or avoid.",
  );

  const content: Node[] = [
    intro,
    introCategories,
    buildNormalDataSection(),
    buildOptInDataSection(),
    buildOptOutDataSection(),
    buildThirdPartyServicesSection(),
    buildWhatSutrapadDoesNotDoSection(),
    buildYourChoicesSection(),
  ];

  return buildStaticPageShell({
    title: "Privacy",
    content,
    backTo: "settings",
    backLabel: "Settings",
    onSelectMenuItem,
  });
}

function buildParagraph(text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "static-paragraph";
  p.textContent = text;
  return p;
}

function buildHeading(level: 2 | 3 | 4, text: string): HTMLHeadingElement {
  // Class names mirror the level so the static-page CSS can give each
  // step in the hierarchy its own treatment (h2 = section start, h3 =
  // category name, h4 = subsection like "What we collect"). Privacy
  // is the only static page that uses h3 / h4 today; About / Terms
  // / Shortcuts stay at h2.
  const heading = document.createElement(`h${level}`);
  heading.className = `static-h${level}`;
  heading.textContent = text;
  return heading;
}

function buildBulletList(items: readonly string[]): HTMLUListElement {
  // Compact variant — Privacy lists are dense, six-to-eight short
  // bullets per category, and look better with the tighter row gap
  // than the default `.static-list` spacing About uses.
  const ul = document.createElement("ul");
  ul.className = "static-list compact";
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    ul.append(li);
  }
  return ul;
}

/**
 * Builds one "data category" entry (e.g. "Google account data") with
 * its three subsections — What we collect / Why we collect it / Where
 * it is stored. The shape is repeated five times across the page so
 * one helper saves copy-paste churn.
 */
function buildDataEntry(options: {
  title: string;
  whatWeCollect: readonly string[];
  whyWeCollect: readonly string[];
  whereItIsStored: readonly string[];
}): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.append(buildHeading(3, options.title));

  fragment.append(buildHeading(4, "What we collect"));
  fragment.append(buildBulletList(options.whatWeCollect));

  fragment.append(buildHeading(4, "Why we collect it"));
  fragment.append(buildBulletList(options.whyWeCollect));

  fragment.append(buildHeading(4, "Where it is stored"));
  fragment.append(buildBulletList(options.whereItIsStored));

  return fragment;
}

function buildNormalDataSection(): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.append(buildHeading(2, "1. Normal data"));
  fragment.append(
    buildParagraph("This is the data required for the core app experience."),
  );

  fragment.append(
    buildDataEntry({
      title: "Google account data",
      whatWeCollect: [
        "Name",
        "Email address",
        "Profile picture URL, if Google provides one",
        "Temporary Google access token for the current session",
      ],
      whyWeCollect: [
        "To sign you in",
        "To show which account is currently connected",
        "To let SutraPad save and load your notes from your Google Drive",
      ],
      whereItIsStored: [
        "In your browser local storage for session restore",
        "In Google systems as part of the Google sign-in and Google Drive flow",
      ],
    }),
  );

  fragment.append(
    buildDataEntry({
      title: "Notes and note metadata",
      whatWeCollect: [
        "Note title",
        "Note body",
        "URLs found in the note",
        "Tags",
        "Created and updated timestamps",
        "Active note selection",
      ],
      whyWeCollect: [
        "To create, edit, search, organize, and sync your notes",
        "To keep the notebook structure consistent across sessions",
      ],
      whereItIsStored: [
        "In your Google Drive as SutraPad JSON files",
        "In your browser local storage as a local workspace cache for faster restore and offline continuity",
      ],
    }),
  );

  fragment.append(
    buildDataEntry({
      title: "Local app preferences",
      whatWeCollect: [
        "Selected theme",
        "Notes view mode",
        "Visual persona preference",
      ],
      whyWeCollect: [
        "To remember how you want the app to look on the current device",
      ],
      whereItIsStored: ["In your browser local storage only"],
    }),
  );

  return fragment;
}

function buildOptInDataSection(): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.append(buildHeading(2, "2. Opt-in data"));
  fragment.append(
    buildParagraph(
      "This data is collected only when you deliberately use a feature that needs it, or when you grant browser-level permission.",
    ),
  );

  fragment.append(
    buildDataEntry({
      title: "Precise location",
      whatWeCollect: [
        "Latitude and longitude from the browser Geolocation API",
        "A human-readable place label derived from those coordinates",
      ],
      whyWeCollect: [
        "To enrich a newly created or captured note with a place label",
        "To help you remember where a note was created",
      ],
      whereItIsStored: [
        "Coordinates and place label may be saved inside the note data in Google Drive",
        "The local cache for reverse-geocoded place labels is stored in your browser local storage",
        "Reverse geocoding requests are sent from your browser to Nominatim",
      ],
    }),
  );

  fragment.append(
    buildDataEntry({
      title: "Weather derived from location",
      whatWeCollect: [
        "Approximate current weather for the note location, such as temperature, wind speed, weather code, and day/night state",
      ],
      whyWeCollect: [
        "To enrich captured note context",
        "To support note metadata and derived tags",
      ],
      whereItIsStored: [
        "Inside the note capture metadata, which may be saved in Google Drive and cached in browser local storage",
        "Weather lookups are requested from your browser to Open-Meteo",
      ],
    }),
  );

  return fragment;
}

function buildOptOutDataSection(): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.append(buildHeading(2, "3. Opt-out data"));
  fragment.append(
    buildParagraph(
      "This data supports convenience, capture context, and device-specific behavior. It is not required to write a simple note, and you can avoid it by not using the related capture flows, by signing out, or by clearing browser site data.",
    ),
  );

  fragment.append(
    buildDataEntry({
      title: "Capture context metadata",
      whatWeCollect: [
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
      ],
      whyWeCollect: [
        "To preserve context around a captured note",
        "To generate richer metadata and better automatic tags",
        "To make later recall and filtering more useful",
      ],
      whereItIsStored: [
        "Inside the note capture metadata in Google Drive",
        "In your browser local workspace cache when the workspace is cached locally",
      ],
    }),
  );

  fragment.append(
    buildDataEntry({
      title: "Browser storage and offline support",
      whatWeCollect: [
        "Cached app files through the service worker",
        "Local copies of workspace data needed for restore",
        "Cached place-label lookups",
      ],
      whyWeCollect: [
        "To make the app load faster",
        "To support offline and interrupted-session recovery",
        "To reduce repeated lookups for the same location",
      ],
      whereItIsStored: ["In your browser storage and browser cache only"],
    }),
  );

  return fragment;
}

function buildThirdPartyServicesSection(): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.append(buildHeading(2, "Third-party services"));
  fragment.append(
    buildParagraph(
      "SutraPad currently relies on third-party services only where the feature requires them:",
    ),
  );
  fragment.append(
    buildBulletList([
      "Google Identity Services for sign-in",
      "Google Drive for note storage and sync",
      "Nominatim for reverse geocoding when location-based note labels are used",
      "Open-Meteo for weather enrichment when location-based capture context is used",
    ]),
  );
  fragment.append(
    buildParagraph("These services process requests directly from your browser."),
  );
  return fragment;
}

function buildWhatSutrapadDoesNotDoSection(): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.append(buildHeading(2, "What SutraPad does not do"));
  fragment.append(
    buildBulletList([
      "SutraPad does not run its own backend for note storage.",
      "SutraPad does not store your notes on SutraPad-operated servers.",
      "SutraPad does not currently include advertising trackers or product analytics for user behavior profiling.",
      "SutraPad does not sell your note content to third parties.",
    ]),
  );
  return fragment;
}

function buildYourChoicesSection(): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.append(buildHeading(2, "Your choices"));
  fragment.append(
    buildBulletList([
      "You can use SutraPad without granting location access.",
      "You can sign out at any time.",
      "You can remove local browser data by clearing site storage in your browser.",
      "You can delete notes and related files from your Google Drive.",
      "You can avoid capture-related metadata by not using capture flows that attach extra context.",
    ]),
  );
  return fragment;
}
