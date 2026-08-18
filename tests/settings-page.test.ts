// @vitest-environment happy-dom
//
// DOM tests for the Settings page's Backup card, focused on the new
// "Rebuild index" action (Phase 2 notes-scaling maintenance rebuild).
// The other cards (Appearance, Persona, Tag hygiene, Privacy, Workbench)
// already have coverage via their own logic modules; this suite targets
// the Backup card's three-action layout and the rebuild status line
// specifically, since that's the surface `rebuildStatus` / `onRebuildIndex`
// actually render through.

import { describe, expect, it, vi } from "vitest";
import { buildSettingsPage, type SettingsPageOptions } from "../src/app/view/pages/settings-page";
import { THEMES } from "../src/app/logic/theme";
import type { UserProfile } from "../src/types";

const PROFILE: UserProfile = { name: "Filip", email: "filip@example.com" };

function baseOptions(
  overrides: Partial<SettingsPageOptions> = {},
): SettingsPageOptions {
  return {
    currentTheme: "auto",
    personaPreference: "off",
    captureLocationPreference: "unanswered",
    profile: PROFILE,
    tagAliasSuggestions: [],
    onChangeTheme: vi.fn(),
    onChangePersonaPreference: vi.fn(),
    onChangeCaptureLocationPreference: vi.fn(),
    onLoadNotebook: vi.fn(),
    onSaveNotebook: vi.fn(),
    rebuildStatus: { state: "idle" },
    onRebuildIndex: vi.fn(),
    onSignIn: vi.fn(),
    onMergeTagAlias: vi.fn(),
    onDismissTagAlias: vi.fn(),
    onSelectMenuItem: vi.fn(),
    ...overrides,
  };
}

function backupActionByTitle(page: HTMLElement, title: string): HTMLElement {
  const heading = Array.from(
    page.querySelectorAll(".settings-backup-action-title"),
  ).find((el) => el.textContent === title);
  if (!heading) throw new Error(`expected a backup action titled "${title}"`);
  const row = heading.closest(".settings-backup-action");
  if (!row) throw new Error("expected the heading to be inside an action row");
  return row as HTMLElement;
}

describe("buildSettingsPage — Backup card rebuild action", () => {
  it("renders three backup actions for a signed-in user, including Rebuild index", () => {
    const page = buildSettingsPage(baseOptions());
    const titles = Array.from(
      page.querySelectorAll(".settings-backup-action-title"),
    ).map((el) => el.textContent);
    expect(titles).toEqual(["Load from Drive", "Save to Drive", "Rebuild index"]);
  });

  it("does not render any backup actions for a signed-out user", () => {
    const page = buildSettingsPage(baseOptions({ profile: null }));
    expect(page.querySelectorAll(".settings-backup-action-title")).toHaveLength(0);
    expect(page.querySelector(".settings-backup-signin")).toBeInstanceOf(
      HTMLButtonElement,
    );
  });

  it("wires the Rebuild button to onRebuildIndex", () => {
    const onRebuildIndex = vi.fn();
    const page = buildSettingsPage(baseOptions({ onRebuildIndex }));
    const button = backupActionByTitle(page, "Rebuild index").querySelector(
      "button.settings-backup-action-button",
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("expected a button element");
    }
    button.click();
    expect(onRebuildIndex).toHaveBeenCalledTimes(1);
  });

  it("shows no status line and an enabled button when idle", () => {
    const page = buildSettingsPage(baseOptions({ rebuildStatus: { state: "idle" } }));
    const action = backupActionByTitle(page, "Rebuild index");
    expect(action.querySelector(".settings-backup-action-status")).toBeNull();
    const button = action.querySelector("button.settings-backup-action-button");
    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables the button and shows the running status line while rebuilding", () => {
    const page = buildSettingsPage(
      baseOptions({ rebuildStatus: { state: "running" } }),
    );
    const action = backupActionByTitle(page, "Rebuild index");
    const button = action.querySelector("button.settings-backup-action-button");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    const status = action.querySelector(".settings-backup-action-status");
    expect(status?.textContent).toContain("Rebuilding");
  });

  it("re-enables the button and shows the done count after a rebuild completes", () => {
    const page = buildSettingsPage(
      baseOptions({ rebuildStatus: { state: "done", noteCount: 6470 } }),
    );
    const action = backupActionByTitle(page, "Rebuild index");
    const button = action.querySelector("button.settings-backup-action-button");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    const status = action.querySelector(".settings-backup-action-status");
    expect(status?.textContent).toBe("Done — refreshed 6470 notes.");
  });

  it("re-enables the button and surfaces the error message when a rebuild fails", () => {
    const page = buildSettingsPage(
      baseOptions({
        rebuildStatus: { state: "error", message: "Network request failed" },
      }),
    );
    const action = backupActionByTitle(page, "Rebuild index");
    const button = action.querySelector("button.settings-backup-action-button");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    const status = action.querySelector(".settings-backup-action-status");
    expect(status?.textContent).toBe("Rebuild failed: Network request failed");
  });
});

/** The six cards, in render order, by their wrapper className. */
function cardClasses(page: HTMLElement): string[] {
  return [...page.children].map((child) => child.className);
}

function cardByTitle(page: HTMLElement, title: string): HTMLElement {
  const heading = [...page.querySelectorAll(".settings-card-header h2")].find(
    (el) => el.textContent === title,
  );
  const card = heading?.closest("section");
  if (!card) throw new Error(`expected a settings card titled "${title}"`);
  return card as HTMLElement;
}

function toggleOptions(group: Element | null | undefined): HTMLButtonElement[] {
  return [...(group?.querySelectorAll<HTMLButtonElement>(".persona-toggle-option") ?? [])];
}

describe("buildSettingsPage — page shell", () => {
  it("stacks the six cards in a stable order", () => {
    const page = buildSettingsPage(baseOptions());
    expect(page.tagName).toBe("SECTION");
    expect(page.className).toBe("settings-page");
    expect(cardClasses(page)).toEqual([
      "settings-card",
      "settings-card",
      "settings-card tag-hygiene-card",
      "settings-card",
      "settings-card settings-card-privacy",
      "settings-card settings-card-workbench",
    ]);
  });

  it("gives every titled card an eyebrow + h2 header pair", () => {
    const page = buildSettingsPage(baseOptions());
    const headers = [...page.querySelectorAll(".settings-card-header")].map((header) => [
      header.querySelector(".panel-eyebrow")?.textContent,
      header.querySelector("h2")?.textContent,
    ]);
    expect(headers).toEqual([
      ["Appearance", "Theme"],
      ["Notebook", "Persona"],
      ["Notebook", "Tag hygiene"],
      ["Backup", "Google Drive"],
      ["Workbench", "Internal tooling"],
    ]);
  });
});

describe("buildSettingsPage — Appearance card", () => {
  it("renders one radio card per theme with swatches and copy", () => {
    const page = buildSettingsPage(baseOptions({ currentTheme: "sand" }));
    const grid = cardByTitle(page, "Theme").querySelector(".theme-grid");
    expect(grid?.getAttribute("role")).toBe("radiogroup");
    expect(grid?.getAttribute("aria-label")).toBe("Theme");
    expect(
      cardByTitle(page, "Theme").querySelector(".settings-card-hint")?.textContent,
    ).toBe("The theme is saved on this device only. Other devices keep their own choice.");

    const cards = [...(grid?.querySelectorAll<HTMLElement>(".theme-card") ?? [])];
    expect(cards).toHaveLength(THEMES.length);
    expect(cards.map((card) => card.dataset.themeId)).toEqual(
      THEMES.map((theme) => theme.id),
    );
    expect(cards.map((card) => card.querySelector(".theme-card-label")?.textContent)).toEqual(
      THEMES.map((theme) => theme.label),
    );
    expect(
      cards.map((card) => card.querySelector(".theme-card-description")?.textContent),
    ).toEqual(THEMES.map((theme) => theme.description));

    // Three decorative swatches per card, hidden from the a11y tree.
    const swatchRow = cards[0].querySelector(".theme-swatches");
    expect(swatchRow?.getAttribute("aria-hidden")).toBe("true");
    expect([...(swatchRow?.children ?? [])].map((el) => el.className)).toEqual([
      "theme-swatch theme-swatch-background",
      "theme-swatch theme-swatch-primary",
      "theme-swatch theme-swatch-accent",
    ]);
  });

  it("marks the current theme active and leaves the rest alone", () => {
    const page = buildSettingsPage(baseOptions({ currentTheme: "sand" }));
    const cards = [...page.querySelectorAll<HTMLElement>(".theme-card")];
    const active = cards.filter((card) => card.classList.contains("is-active"));
    expect(active).toHaveLength(1);
    expect(active[0].dataset.themeId).toBe("sand");
    expect(active[0].getAttribute("aria-checked")).toBe("true");
    const others = cards.filter((card) => card.dataset.themeId !== "sand");
    expect(others.every((card) => card.getAttribute("aria-checked") === "false")).toBe(
      true,
    );
  });

  it("reports the clicked theme", () => {
    const onChangeTheme = vi.fn();
    const page = buildSettingsPage(baseOptions({ currentTheme: "auto", onChangeTheme }));
    page
      .querySelector<HTMLButtonElement>('.theme-card[data-theme-id="paper"]')
      ?.click();
    expect(onChangeTheme).toHaveBeenCalledWith("paper");
  });
});

describe("buildSettingsPage — Persona card", () => {
  it("renders an Off/On radio group with descriptions", () => {
    const page = buildSettingsPage(baseOptions({ personaPreference: "off" }));
    const card = cardByTitle(page, "Persona");
    expect(card.querySelector(".settings-card-hint")?.textContent).toBe(
      "Paints each note card with a paper colour and a little rotation based on when you wrote it, plus small stickers for notes with open tasks or night-time capture. Saved per-device.",
    );

    const group = card.querySelector(".persona-toggle");
    expect(group?.getAttribute("role")).toBe("radiogroup");
    expect(group?.getAttribute("aria-label")).toBe("Notebook persona");

    const buttons = toggleOptions(group);
    expect(buttons.map((b) => b.dataset.personaPreference)).toEqual(["off", "on"]);
    expect(
      buttons.map((b) => b.querySelector(".persona-toggle-label")?.textContent),
    ).toEqual(["Off", "On"]);
    expect(
      buttons.map((b) => b.querySelector(".persona-toggle-description")?.textContent),
    ).toEqual([
      "Keep notes as plain, flat cards.",
      "Show paper colours, stickers, and subtle wear.",
    ]);
  });

  it("lights up only the active preference", () => {
    const page = buildSettingsPage(baseOptions({ personaPreference: "on" }));
    const buttons = toggleOptions(cardByTitle(page, "Persona").querySelector(".persona-toggle"));
    expect(buttons.map((b) => b.className)).toEqual([
      "persona-toggle-option",
      "persona-toggle-option is-active",
    ]);
    expect(buttons.map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  });

  it("reports the clicked preference", () => {
    const onChangePersonaPreference = vi.fn();
    const page = buildSettingsPage(
      baseOptions({ personaPreference: "off", onChangePersonaPreference }),
    );
    toggleOptions(
      cardByTitle(page, "Persona").querySelector(".persona-toggle"),
    )[1].click();
    expect(onChangePersonaPreference).toHaveBeenCalledWith("on");
  });
});

describe("buildSettingsPage — Privacy card", () => {
  it("leads with the heading, the third-party summary and the full-policy link", () => {
    const page = buildSettingsPage(baseOptions());
    const card = page.querySelector(".settings-card-privacy");
    expect(card?.querySelector("h3")?.textContent).toBe("Privacy");
    expect(card?.querySelector("p")?.textContent).toContain(
      "SutraPad runs in your browser and keeps your notes in your own Google Drive.",
    );
    const link = card?.querySelector<HTMLButtonElement>(".settings-card-privacy-link");
    expect(link?.className).toBe("is-link settings-card-privacy-link");
    expect(link?.textContent).toBe("Read the full Privacy page →");
  });

  it("routes the full-policy link through onSelectMenuItem", () => {
    const onSelectMenuItem = vi.fn();
    const page = buildSettingsPage(baseOptions({ onSelectMenuItem }));
    page
      .querySelector<HTMLButtonElement>(".settings-card-privacy-link")
      ?.click();
    expect(onSelectMenuItem).toHaveBeenCalledWith("privacy");
  });

  it("labels the location toggle and explains what each side does", () => {
    const page = buildSettingsPage(baseOptions());
    const toggle = page.querySelector(".settings-card-privacy-toggle");
    expect(toggle?.querySelector(".settings-card-subheading")?.textContent).toBe(
      "Capture location on new notes",
    );
    expect(toggle?.querySelector(".settings-card-hint")?.textContent).toContain(
      "When on, creating a new note asks the browser for your current location",
    );

    const group = toggle?.querySelector(".persona-toggle");
    expect(group?.getAttribute("role")).toBe("radiogroup");
    expect(group?.getAttribute("aria-label")).toBe("Capture location on new notes");

    const buttons = toggleOptions(group);
    expect(buttons.map((b) => b.dataset.captureLocationPreference)).toEqual([
      "off",
      "on",
    ]);
    expect(
      buttons.map((b) => b.querySelector(".persona-toggle-description")?.textContent),
    ).toEqual([
      "Don't ask for location.",
      "Ask for location and add a place label.",
    ]);
  });

  it("lights up neither option while the preference is unanswered", () => {
    // First-run users resolve this in the editor consent card; the settings
    // toggle must not imply a decision they never made.
    const page = buildSettingsPage(
      baseOptions({ captureLocationPreference: "unanswered" }),
    );
    const buttons = toggleOptions(
      page.querySelector(".settings-card-privacy-toggle .persona-toggle"),
    );
    expect(buttons.every((b) => b.getAttribute("aria-checked") === "false")).toBe(true);
    expect(buttons.some((b) => b.classList.contains("is-active"))).toBe(false);
  });

  it("lights up the answered option and reports a change", () => {
    const onChangeCaptureLocationPreference = vi.fn();
    const page = buildSettingsPage(
      baseOptions({
        captureLocationPreference: "on",
        onChangeCaptureLocationPreference,
      }),
    );
    const buttons = toggleOptions(
      page.querySelector(".settings-card-privacy-toggle .persona-toggle"),
    );
    expect(buttons[1].getAttribute("aria-checked")).toBe("true");
    buttons[0].click();
    expect(onChangeCaptureLocationPreference).toHaveBeenCalledWith("off");
  });
});

describe("buildSettingsPage — Workbench card", () => {
  it("explains what the workbench is and links to the lexicon builder", () => {
    const page = buildSettingsPage(baseOptions());
    const card = page.querySelector(".settings-card-workbench");
    expect(card?.querySelector(".settings-card-hint")?.textContent).toBe(
      "Internal builders hosted inside SutraPad. They reuse the app shell and Google Drive sync, but are not part of the regular notebook flow.",
    );
    const link = card?.querySelector<HTMLButtonElement>(
      ".settings-card-workbench-link",
    );
    expect(link?.textContent).toBe("Topic Lexicon Builder →");
    expect(link?.className).toBe("is-link settings-card-workbench-link");
  });

  it("routes the workbench link to the lexicon page", () => {
    const onSelectMenuItem = vi.fn();
    const page = buildSettingsPage(baseOptions({ onSelectMenuItem }));
    page
      .querySelector<HTMLButtonElement>(".settings-card-workbench-link")
      ?.click();
    expect(onSelectMenuItem).toHaveBeenCalledWith("lexicon");
  });
});

describe("buildSettingsPage — Tag hygiene card", () => {
  const suggestion = {
    canonical: "prague",
    aliases: ["praha", "praga"],
    reason: "Near-identical spelling; case and diacritics",
  };

  it("collapses to a one-liner when there is nothing to clean up", () => {
    const page = buildSettingsPage(baseOptions({ tagAliasSuggestions: [] }));
    const card = page.querySelector(".tag-hygiene-card");
    expect(card?.querySelector(".settings-card-note")?.textContent).toBe(
      "Nothing to clean up right now.",
    );
    expect(card?.querySelector(".tag-hygiene-list")).toBeNull();
  });

  it("renders one card per suggestion with the canonical pill, arrow and count", () => {
    const page = buildSettingsPage(
      baseOptions({ tagAliasSuggestions: [suggestion] }),
    );
    const row = page.querySelector<HTMLElement>(".tag-hygiene-list .hygiene-card");
    expect(row?.tagName).toBe("ARTICLE");
    expect(row?.dataset.canonical).toBe("prague");
    expect(row?.querySelector(".hygiene-canonical")?.textContent).toContain("prague");

    const arrow = row?.querySelector(".hygiene-arrow");
    expect(arrow?.textContent).toBe("←");
    expect(arrow?.getAttribute("aria-hidden")).toBe("true");

    expect(row?.querySelector(".hygiene-candidate-count")?.textContent).toBe(
      "2 candidates",
    );
    expect(row?.querySelector(".hygiene-reason")?.textContent).toBe(suggestion.reason);
  });

  it("uses the singular for a lone candidate", () => {
    const page = buildSettingsPage(
      baseOptions({
        tagAliasSuggestions: [{ ...suggestion, aliases: ["praha"] }],
      }),
    );
    expect(
      page.querySelector(".hygiene-candidate-count")?.textContent,
    ).toBe("1 candidate");
  });

  it("gives every alias a Merge and a Keep-separate action with spoken labels", () => {
    const page = buildSettingsPage(
      baseOptions({ tagAliasSuggestions: [suggestion] }),
    );
    const rows = [...page.querySelectorAll(".hygiene-alias-row")];
    expect(rows).toHaveLength(2);

    const first = rows[0];
    const merge = first.querySelector<HTMLButtonElement>(".button-primary");
    expect(merge?.textContent).toBe("Merge");
    expect(merge?.getAttribute("aria-label")).toBe("Merge praha into prague");

    const dismiss = [...first.querySelectorAll<HTMLButtonElement>(".hygiene-action")].find(
      (button) => button.textContent === "Keep separate",
    );
    expect(dismiss?.className).toBe("button hygiene-action");
    expect(dismiss?.getAttribute("aria-label")).toBe("Keep prague and praha separate");
  });

  it("merges alias→canonical and dismisses canonical+alias in that argument order", () => {
    // The two callbacks take their arguments in opposite orders — a swap would
    // relabel every note to the alias instead of the canonical tag.
    const onMergeTagAlias = vi.fn();
    const onDismissTagAlias = vi.fn();
    const page = buildSettingsPage(
      baseOptions({
        tagAliasSuggestions: [suggestion],
        onMergeTagAlias,
        onDismissTagAlias,
      }),
    );
    const row = page.querySelector(".hygiene-alias-row");
    row?.querySelector<HTMLButtonElement>(".button-primary")?.click();
    expect(onMergeTagAlias).toHaveBeenCalledWith("praha", "prague");

    const dismiss = [...(row?.querySelectorAll<HTMLButtonElement>(".hygiene-action") ?? [])].find(
      (button) => button.textContent === "Keep separate",
    );
    dismiss?.click();
    expect(onDismissTagAlias).toHaveBeenCalledWith("prague", "praha");
  });
});

describe("buildSettingsPage — Backup card copy", () => {
  it("explains the three actions and their button styling", () => {
    const page = buildSettingsPage(baseOptions());
    const card = cardByTitle(page, "Google Drive");
    expect(card.querySelector(".settings-card-hint")?.textContent).toContain(
      "Your notebook is stored in this browser",
    );

    const titles = [...card.querySelectorAll(".settings-backup-action-title")].map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(["Load from Drive", "Save to Drive", "Rebuild index"]);

    const load = backupActionByTitle(page, "Load from Drive");
    expect(load.querySelector(".settings-backup-action-description")?.textContent).toContain(
      "Pull the notebook currently saved in Google Drive",
    );
    expect(load.querySelector("button")?.textContent).toBe("Load");
    expect(load.querySelector("button")?.className).toBe(
      "button settings-backup-action-button",
    );

    const save = backupActionByTitle(page, "Save to Drive");
    expect(save.querySelector("button")?.textContent).toBe("Save");
    // The primary action of the card — Save is the one users reach for.
    expect(save.querySelector("button")?.className).toBe(
      "button button-primary settings-backup-action-button",
    );
  });

  it("wires Load and Save to their callbacks", () => {
    const onLoadNotebook = vi.fn();
    const onSaveNotebook = vi.fn();
    const page = buildSettingsPage(baseOptions({ onLoadNotebook, onSaveNotebook }));
    backupActionByTitle(page, "Load from Drive").querySelector("button")?.click();
    backupActionByTitle(page, "Save to Drive").querySelector("button")?.click();
    expect(onLoadNotebook).toHaveBeenCalledTimes(1);
    expect(onSaveNotebook).toHaveBeenCalledTimes(1);
  });

  it("offers a sign-in button with an explanation when signed out", () => {
    const onSignIn = vi.fn();
    const page = buildSettingsPage(baseOptions({ profile: null, onSignIn }));
    const card = cardByTitle(page, "Google Drive");
    expect(card.querySelector(".settings-card-note")?.textContent).toBe(
      "Sign in with Google to use manual load and save.",
    );
    const button = card.querySelector<HTMLButtonElement>(".settings-backup-signin");
    expect(button?.textContent).toBe("Sign in with Google");
    button?.click();
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });
});

describe("buildSettingsPage — radio semantics and wrapper structure", () => {
  const suggestion = {
    canonical: "prague",
    aliases: ["praha"],
    reason: "Near-identical spelling",
  };

  it("gives every toggle option and theme card its own radio role", () => {
    const page = buildSettingsPage(baseOptions());
    const radios = [...page.querySelectorAll('[role="radio"]')];
    // 2 location + 2 persona + one per theme.
    expect(radios).toHaveLength(4 + THEMES.length);
    expect(
      [...page.querySelectorAll(".theme-card")].every(
        (card) => card.getAttribute("role") === "radio",
      ),
    ).toBe(true);
    expect(
      [...page.querySelectorAll(".persona-toggle-option")].every(
        (button) => button.getAttribute("role") === "radio",
      ),
    ).toBe(true);
  });

  it("labels both sides of the location toggle and highlights the answered one", () => {
    const page = buildSettingsPage(
      baseOptions({ captureLocationPreference: "off" }),
    );
    const buttons = toggleOptions(
      page.querySelector(".settings-card-privacy-toggle .persona-toggle"),
    );
    expect(
      buttons.map((b) => b.querySelector(".persona-toggle-label")?.textContent),
    ).toEqual(["Off", "On"]);
    expect(buttons.map((b) => b.className)).toEqual([
      "persona-toggle-option is-active",
      "persona-toggle-option",
    ]);
  });

  it("wraps the hygiene suggestion in its hed / alias-list / actions structure", () => {
    const page = buildSettingsPage(
      baseOptions({ tagAliasSuggestions: [suggestion] }),
    );
    const card = page.querySelector(".tag-hygiene-card");
    expect(card?.querySelector(".settings-card-hint")?.textContent).toBe(
      "Tags that look like different spellings of the same thing. Merging keeps every note's history — the notes just get relabeled to the canonical tag.",
    );
    const row = card?.querySelector(".hygiene-card");
    expect(row?.querySelector(".hygiene-hed")).not.toBeNull();
    expect(row?.querySelector(".hygiene-alias-list")).not.toBeNull();
    expect(
      row?.querySelector(".hygiene-alias-row .hygiene-alias-actions")?.children,
    ).toHaveLength(2);
  });

  it("wraps the backup actions in a list, each with its own text block", () => {
    const page = buildSettingsPage(baseOptions());
    const list = cardByTitle(page, "Google Drive").querySelector(
      ".settings-backup-actions",
    );
    expect(list).not.toBeNull();
    expect(list?.querySelectorAll(".settings-backup-action")).toHaveLength(3);
    expect(
      [...(list?.querySelectorAll(".settings-backup-action") ?? [])].every(
        (action) => action.querySelector(".settings-backup-action-text") !== null,
      ),
    ).toBe(true);
  });

  it("spells out what Save and Rebuild do", () => {
    const page = buildSettingsPage(baseOptions());
    expect(
      backupActionByTitle(page, "Save to Drive").querySelector(
        ".settings-backup-action-description",
      )?.textContent,
    ).toContain("Push the notebook in this browser up to Google Drive right now.");

    const rebuild = backupActionByTitle(page, "Rebuild index");
    expect(
      rebuild.querySelector(".settings-backup-action-description")?.textContent,
    ).toContain("Walks every note in Drive once and rewrites the tag, link, and ta");
    const button = rebuild.querySelector("button");
    expect(button?.textContent).toBe("Rebuild");
    // Secondary styling — the destructive-ish maintenance action isn't primary.
    expect(button?.className).toBe("button settings-backup-action-button");
  });
});
