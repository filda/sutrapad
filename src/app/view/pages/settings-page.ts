import type { UserProfile } from "../../../types";
import { type PersonaPreference } from "../../logic/persona";
import { THEMES, type ThemeChoice } from "../../logic/theme";

export interface SettingsPageOptions {
  currentTheme: ThemeChoice;
  personaPreference: PersonaPreference;
  profile: UserProfile | null;
  onChangeTheme: (choice: ThemeChoice) => void;
  onChangePersonaPreference: (preference: PersonaPreference) => void;
  onLoadNotebook: () => void;
  onSaveNotebook: () => void;
  onSignIn: () => void;
}

/**
 * Settings page. Each concern lives in its own card inside the page wrapper:
 * appearance (per-device theme), notebook persona (decorative card layer),
 * and backup (manual Google Drive load/save). Further device-local or
 * account-level preferences slot in as additional cards in the same
 * container.
 */
export function buildSettingsPage({
  currentTheme,
  personaPreference,
  profile,
  onChangeTheme,
  onChangePersonaPreference,
  onLoadNotebook,
  onSaveNotebook,
  onSignIn,
}: SettingsPageOptions): HTMLElement {
  const page = document.createElement("section");
  page.className = "settings-page";

  page.append(buildAppearanceCard({ currentTheme, onChangeTheme }));
  page.append(
    buildPersonaCard({ personaPreference, onChangePersonaPreference }),
  );
  page.append(
    buildBackupCard({ profile, onLoadNotebook, onSaveNotebook, onSignIn }),
  );

  return page;
}

interface AppearanceCardOptions {
  currentTheme: ThemeChoice;
  onChangeTheme: (choice: ThemeChoice) => void;
}

function buildAppearanceCard({
  currentTheme,
  onChangeTheme,
}: AppearanceCardOptions): HTMLElement {
  const card = document.createElement("section");
  card.className = "settings-card";

  const header = document.createElement("header");
  header.className = "settings-card-header";
  header.innerHTML = `
    <p class="panel-eyebrow">Appearance</p>
    <h2>Theme</h2>
  `;
  card.append(header);

  const hint = document.createElement("p");
  hint.className = "settings-card-hint";
  hint.textContent =
    "The theme is saved on this device only. Other devices keep their own choice.";
  card.append(hint);

  const grid = document.createElement("div");
  grid.className = "theme-grid";
  grid.setAttribute("role", "radiogroup");
  grid.setAttribute("aria-label", "Theme");

  for (const theme of THEMES) {
    const isSelected = theme.id === currentTheme;
    const themeCard = document.createElement("button");
    themeCard.type = "button";
    themeCard.className = `theme-card${isSelected ? " is-active" : ""}`;
    themeCard.setAttribute("role", "radio");
    themeCard.setAttribute("aria-checked", isSelected ? "true" : "false");
    themeCard.setAttribute("data-theme-id", theme.id);

    const swatches = document.createElement("span");
    swatches.className = "theme-swatches";
    swatches.setAttribute("aria-hidden", "true");
    for (const key of ["background", "primary", "accent"] as const) {
      const swatch = document.createElement("span");
      swatch.className = `theme-swatch theme-swatch-${key}`;
      swatch.style.background = theme.swatches[key];
      swatches.append(swatch);
    }
    themeCard.append(swatches);

    const label = document.createElement("span");
    label.className = "theme-card-label";
    label.textContent = theme.label;
    themeCard.append(label);

    const description = document.createElement("span");
    description.className = "theme-card-description";
    description.textContent = theme.description;
    themeCard.append(description);

    themeCard.addEventListener("click", () => onChangeTheme(theme.id));
    grid.append(themeCard);
  }

  card.append(grid);
  return card;
}

interface PersonaCardOptions {
  personaPreference: PersonaPreference;
  onChangePersonaPreference: (preference: PersonaPreference) => void;
}

/**
 * Notebook persona card. The persona layer paints each note card with a
 * time-of-day paper palette, a small rotation, and decorative stickers —
 * it's opinionated, so it ships off by default and the user turns it on
 * here. The toggle is a pair of radio-style buttons rather than a checkbox
 * so the two states read as equally first-class choices (matching the
 * Theme card's grid below).
 */
function buildPersonaCard({
  personaPreference,
  onChangePersonaPreference,
}: PersonaCardOptions): HTMLElement {
  const card = document.createElement("section");
  card.className = "settings-card";

  const header = document.createElement("header");
  header.className = "settings-card-header";
  header.innerHTML = `
    <p class="panel-eyebrow">Notebook</p>
    <h2>Persona</h2>
  `;
  card.append(header);

  const hint = document.createElement("p");
  hint.className = "settings-card-hint";
  hint.textContent =
    "Paints each note card with a paper colour and a little rotation based on when you wrote it, plus small stickers for notes with open tasks or night-time capture. Saved per-device.";
  card.append(hint);

  const group = document.createElement("div");
  group.className = "persona-toggle";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "Notebook persona");

  const options: ReadonlyArray<{
    value: PersonaPreference;
    label: string;
    description: string;
  }> = [
    {
      value: "off",
      label: "Off",
      description: "Keep notes as plain, flat cards.",
    },
    {
      value: "on",
      label: "On",
      description: "Show paper colours, stickers, and subtle wear.",
    },
  ];

  for (const option of options) {
    const isSelected = option.value === personaPreference;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `persona-toggle-option${isSelected ? " is-active" : ""}`;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", isSelected ? "true" : "false");
    button.setAttribute("data-persona-preference", option.value);

    const label = document.createElement("span");
    label.className = "persona-toggle-label";
    label.textContent = option.label;

    const description = document.createElement("span");
    description.className = "persona-toggle-description";
    description.textContent = option.description;

    button.append(label, description);
    button.addEventListener("click", () =>
      onChangePersonaPreference(option.value),
    );
    group.append(button);
  }

  card.append(group);
  return card;
}

interface BackupCardOptions {
  profile: UserProfile | null;
  onLoadNotebook: () => void;
  onSaveNotebook: () => void;
  onSignIn: () => void;
}

/**
 * Backup card. Surfaces the manual Load/Save actions that used to live in
 * the top account bar. These are rarely needed in normal use — the workspace
 * syncs automatically for signed-in users — so the card leads with an
 * explanation of *when* you'd want to reach for these buttons instead of
 * assuming the reader knows.
 */
function buildBackupCard({
  profile,
  onLoadNotebook,
  onSaveNotebook,
  onSignIn,
}: BackupCardOptions): HTMLElement {
  const card = document.createElement("section");
  card.className = "settings-card";

  const header = document.createElement("header");
  header.className = "settings-card-header";
  header.innerHTML = `
    <p class="panel-eyebrow">Backup</p>
    <h2>Google Drive</h2>
  `;
  card.append(header);

  const intro = document.createElement("p");
  intro.className = "settings-card-hint";
  intro.textContent =
    "Your notebook is stored in this browser and, when you're signed in, synced automatically to Google Drive. You normally don't need the buttons below — they're here for the rare cases when you want to force a pull or push by hand.";
  card.append(intro);

  if (!profile) {
    const signedOutNote = document.createElement("p");
    signedOutNote.className = "settings-card-note";
    signedOutNote.textContent =
      "Sign in with Google to use manual load and save.";
    card.append(signedOutNote);

    const signInButton = document.createElement("button");
    signInButton.type = "button";
    signInButton.className = "button button-primary settings-backup-signin";
    signInButton.textContent = "Sign in with Google";
    signInButton.addEventListener("click", onSignIn);
    card.append(signInButton);

    return card;
  }

  const list = document.createElement("div");
  list.className = "settings-backup-actions";

  list.append(
    buildBackupAction({
      title: "Load from Drive",
      description:
        "Pull the notebook currently saved in Google Drive and replace what's in this browser. Useful if you've made changes on another device and want them here, or if something in this browser looks off and you want to reset to the last saved copy.",
      buttonLabel: "Load",
      buttonClass: "button",
      onClick: onLoadNotebook,
    }),
  );

  list.append(
    buildBackupAction({
      title: "Save to Drive",
      description:
        "Push the notebook in this browser up to Google Drive right now. Automatic sync usually handles this, so reach for it mostly if sync seems stuck or you want to confirm a snapshot was written before switching devices.",
      buttonLabel: "Save",
      buttonClass: "button button-primary",
      onClick: onSaveNotebook,
    }),
  );

  card.append(list);
  return card;
}

interface BackupActionOptions {
  title: string;
  description: string;
  buttonLabel: string;
  buttonClass: string;
  onClick: () => void;
}

function buildBackupAction({
  title,
  description,
  buttonLabel,
  buttonClass,
  onClick,
}: BackupActionOptions): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-backup-action";

  const text = document.createElement("div");
  text.className = "settings-backup-action-text";

  const heading = document.createElement("h3");
  heading.className = "settings-backup-action-title";
  heading.textContent = title;

  const desc = document.createElement("p");
  desc.className = "settings-backup-action-description";
  desc.textContent = description;

  text.append(heading, desc);

  const button = document.createElement("button");
  button.type = "button";
  button.className = `${buttonClass} settings-backup-action-button`;
  button.textContent = buttonLabel;
  button.addEventListener("click", onClick);

  row.append(text, button);
  return row;
}
