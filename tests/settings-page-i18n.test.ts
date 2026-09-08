// @vitest-environment happy-dom
//
// The Settings page rendered in Czech — the end-to-end proof that the
// localization shape works on a real surface (step 1 of `docs/i18n-plan.md`).
//
// Two things are worth pinning here, and only one of them is "the text is
// Czech":
//
//   1. **Copy localizes.** Every card header, hint, button and aria-label the
//      page owns comes from the catalog, so switching the active locale
//      switches all of it. `tests/settings-page.test.ts` asserts the same
//      surface in English against literal strings, which is what keeps the
//      English catalog honest — if a message drifts, that suite fails.
//   2. **Keys do not.** Theme ids, preference values and locale ids are
//      persisted, compared, and written to `data-theme` / `<html lang>`.
//      Translating one corrupts stored state, and the failure is silent: the
//      UI still renders, the user's saved choice just stops matching. That is
//      the boundary `docs/i18n-plan.md` calls critical, so it gets assertions
//      of its own rather than being implied by the copy ones.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSettingsPage,
  type SettingsPageOptions,
} from "../src/app/view/pages/settings-page";
import { createEmptyDiagnostics } from "../src/app/logic/diagnostics";
import { THEMES } from "../src/app/logic/theme";
import { CS, DEFAULT_LOCALE, setActiveLocale } from "../src/lib/i18n";
import type { UserProfile } from "../src/types";

const PROFILE: UserProfile = { name: "Filip", email: "filip@example.com" };

beforeEach(() => setActiveLocale("cs"));
afterEach(() => setActiveLocale(DEFAULT_LOCALE));

function czechPage(overrides: Partial<SettingsPageOptions> = {}): HTMLElement {
  return buildSettingsPage({
    locale: "cs",
    currentTheme: "auto",
    personaPreference: "off",
    captureLocationPreference: "unanswered",
    profile: PROFILE,
    tagAliasSuggestions: [],
    onChangeLocale: vi.fn(),
    onChangeTheme: vi.fn(),
    onChangePersonaPreference: vi.fn(),
    onChangeCaptureLocationPreference: vi.fn(),
    onLoadNotebook: vi.fn(),
    onSaveNotebook: vi.fn(),
    rebuildStatus: { state: "idle" },
    diagnostics: createEmptyDiagnostics(),
    onRebuildIndex: vi.fn(),
    onSignIn: vi.fn(),
    onMergeTagAlias: vi.fn(),
    onDismissTagAlias: vi.fn(),
    onSelectMenuItem: vi.fn(),
    ...overrides,
  });
}

describe("Settings page in Czech — copy", () => {
  it("translates every card header", () => {
    const headers = [...czechPage().querySelectorAll(".settings-card-header")].map(
      (header) => [
        header.querySelector(".panel-eyebrow")?.textContent,
        header.querySelector("h2")?.textContent,
      ],
    );

    expect(headers).toEqual([
      ["Jazyk", "Jazyk aplikace"],
      ["Vzhled", "Motiv"],
      ["Zápisník", "Persona"],
      ["Zápisník", "Hygiena štítků"],
      ["Záloha", "Google Drive"],
      ["Diagnostika", "Synchronizace a výkon"],
      ["Dílna", "Interní nástroje"],
    ]);
  });

  it("translates the theme labels and descriptions", () => {
    const cards = [...czechPage().querySelectorAll<HTMLElement>(".theme-card")];

    expect(
      cards.map((card) => card.querySelector(".theme-card-label")?.textContent),
    ).toEqual(THEMES.map((theme) => CS.theme[theme.id].label));
    expect(
      cards.map((card) => card.querySelector(".theme-card-description")?.textContent),
    ).toEqual(THEMES.map((theme) => CS.theme[theme.id].description));
  });

  it("translates the backup actions and their buttons", () => {
    const page = czechPage();

    expect(
      [...page.querySelectorAll(".settings-backup-action-title")].map(
        (el) => el.textContent,
      ),
    ).toEqual(["Načíst z Drive", "Uložit na Drive", "Přestavět index"]);
    expect(
      [...page.querySelectorAll(".settings-backup-action-button")].map(
        (el) => el.textContent,
      ),
    ).toEqual(["Načíst", "Uložit", "Přestavět"]);
  });

  it("translates the privacy card, including the microphone consent card", () => {
    const page = czechPage();

    expect(page.querySelector(".settings-card-privacy h3")?.textContent).toBe(
      "Soukromí",
    );
    expect(page.querySelector(".settings-card-privacy-link")?.textContent).toBe(
      CS.settings.privacy.readFullPolicy,
    );
    expect(
      page.querySelector(".settings-card-microphone .settings-card-subheading")
        ?.textContent,
    ).toBe(CS.microphone.label);
    expect(
      page.querySelector(".settings-card-microphone-enable")?.textContent,
    ).toBe(CS.microphone.enable);
  });

  it("translates the radiogroup aria-labels, not just the visible text", () => {
    // An untranslated aria-label is invisible on screen, so nothing else in
    // this suite would notice — and it is the only label a screen-reader user
    // gets for these groups.
    const labels = [...czechPage().querySelectorAll('[role="radiogroup"]')].map(
      (group) => group.getAttribute("aria-label"),
    );

    expect(labels).toEqual([
      "Jazyk aplikace",
      "Motiv",
      "Persona zápisníku",
      "Zaznamenávat polohu u nových poznámek",
    ]);
  });

  it("translates the empty tag-hygiene state", () => {
    expect(
      czechPage().querySelector(".tag-hygiene-card .settings-card-note")
        ?.textContent,
    ).toBe("Teď není co uklízet.");
  });

  it("uses Czech plural rules for the candidate count", () => {
    // one / few / other, which is where a naive "singular vs plural" port
    // breaks: 2 and 5 need different words and neither is the 1 form.
    const aliases = ["praha", "praha-cz", "prag", "praga", "prahaa"];
    const counts = [1, 3, 5].map((n) => {
      const page = czechPage({
        tagAliasSuggestions: [
          {
            canonical: "prague",
            aliases: aliases.slice(0, n),
            reason: "Podobný zápis",
          },
        ],
      });
      return page.querySelector(".hygiene-candidate-count")?.textContent;
    });

    expect(counts).toEqual(["1 kandidát", "3 kandidáti", "5 kandidátů"]);
  });

  it("translates the rebuild status line, plural included", () => {
    const done = (noteCount: number) =>
      czechPage({ rebuildStatus: { state: "done", noteCount } }).querySelector(
        ".settings-backup-action-status",
      )?.textContent;

    expect(done(1)).toBe("Hotovo — obnovena 1 poznámka.");
    expect(done(3)).toBe("Hotovo — obnoveny 3 poznámky.");
    expect(done(9)).toBe("Hotovo — obnoveno 9 poznámek.");
  });
});

describe("Settings page in Czech — persisted keys stay untranslated", () => {
  it("keeps every theme id in the DOM as its English key", () => {
    const cards = [...czechPage().querySelectorAll<HTMLElement>(".theme-card")];

    expect(cards.map((card) => card.dataset.themeId)).toEqual([
      "auto",
      "sand",
      "paper",
      "forest",
      "midnight",
      "dark",
      "parchment",
      "parchment-dark",
    ]);
  });

  it("reports the theme key, not its Czech label, when one is picked", () => {
    const onChangeTheme = vi.fn();
    const page = czechPage({ onChangeTheme });

    page
      .querySelector<HTMLElement>('.theme-card[data-theme-id="midnight"]')
      ?.click();

    expect(onChangeTheme).toHaveBeenCalledExactlyOnceWith("midnight");
  });

  it("keeps the persona and location preference values as on/off", () => {
    const page = czechPage();

    expect(
      [...page.querySelectorAll<HTMLElement>("[data-persona-preference]")].map(
        (el) => el.dataset.personaPreference,
      ),
    ).toEqual(["off", "on"]);
    expect(
      [
        ...page.querySelectorAll<HTMLElement>("[data-capture-location-preference]"),
      ].map((el) => el.dataset.captureLocationPreference),
    ).toEqual(["off", "on"]);
  });

  it("reports the preference key when a Czech-labelled toggle is clicked", () => {
    const onChangePersonaPreference = vi.fn();
    const page = czechPage({ onChangePersonaPreference });

    const on = page.querySelector<HTMLElement>('[data-persona-preference="on"]');
    expect(on?.querySelector(".persona-toggle-label")?.textContent).toBe("Zapnuto");

    on?.click();

    expect(onChangePersonaPreference).toHaveBeenCalledExactlyOnceWith("on");
  });
});

describe("Settings page — the language picker", () => {
  it("names each language in its own language and marks the active one", () => {
    const options = [
      ...czechPage().querySelectorAll<HTMLElement>("[data-locale]"),
    ];

    expect(options.map((option) => option.dataset.locale)).toEqual(["en", "cs"]);
    expect(
      options.map((option) => option.querySelector(".persona-toggle-label")?.textContent),
    ).toEqual(["English", "Čeština"]);
    expect(options.map((option) => option.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
    ]);
  });

  it("tags each option with its own lang so a screen reader switches voice", () => {
    const options = [
      ...czechPage().querySelectorAll<HTMLElement>("[data-locale]"),
    ];

    expect(options.map((option) => option.lang)).toEqual(["en", "cs"]);
  });

  it("reports the locale key when an option is picked", () => {
    const onChangeLocale = vi.fn();
    const page = czechPage({ onChangeLocale });

    page.querySelector<HTMLElement>('[data-locale="en"]')?.click();

    expect(onChangeLocale).toHaveBeenCalledExactlyOnceWith("en");
  });

  it("leads the page, before the theme card", () => {
    // Deliberate: it is the one control a reader stuck in the wrong language
    // needs, and they cannot read the headings above it to find it.
    const page = czechPage();
    const cards = [...page.children];
    const languageCard = page.querySelector("[data-locale]")?.closest(".settings-card");

    expect(cards.indexOf(languageCard as Element)).toBe(0);
  });
});
