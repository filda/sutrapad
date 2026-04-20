import { THEMES, type ThemeChoice } from "../../logic/theme";

export interface SettingsPageOptions {
  currentTheme: ThemeChoice;
  onChangeTheme: (choice: ThemeChoice) => void;
}

/**
 * Settings page. The first card groups the theme picker (per-device); any
 * future device-local preferences (font size, UI density, etc.) slot in the
 * same way — as additional cards inside the main section.
 */
export function buildSettingsPage({
  currentTheme,
  onChangeTheme,
}: SettingsPageOptions): HTMLElement {
  const section = document.createElement("section");
  section.className = "settings-page";

  const header = document.createElement("header");
  header.className = "settings-page-header";
  header.innerHTML = `
    <p class="panel-eyebrow">Settings</p>
    <h2>Appearance</h2>
  `;
  section.append(header);

  const hint = document.createElement("p");
  hint.className = "settings-page-hint";
  hint.textContent =
    "The theme is saved on this device only. Other devices keep their own choice.";
  section.append(hint);

  const grid = document.createElement("div");
  grid.className = "theme-grid";
  grid.setAttribute("role", "radiogroup");
  grid.setAttribute("aria-label", "Theme");

  for (const theme of THEMES) {
    const isSelected = theme.id === currentTheme;
    const card = document.createElement("button");
    card.type = "button";
    card.className = `theme-card${isSelected ? " is-active" : ""}`;
    card.setAttribute("role", "radio");
    card.setAttribute("aria-checked", isSelected ? "true" : "false");
    card.setAttribute("data-theme-id", theme.id);

    const swatches = document.createElement("span");
    swatches.className = "theme-swatches";
    swatches.setAttribute("aria-hidden", "true");
    for (const key of ["background", "primary", "accent"] as const) {
      const swatch = document.createElement("span");
      swatch.className = `theme-swatch theme-swatch-${key}`;
      swatch.style.background = theme.swatches[key];
      swatches.append(swatch);
    }
    card.append(swatches);

    const label = document.createElement("span");
    label.className = "theme-card-label";
    label.textContent = theme.label;
    card.append(label);

    const description = document.createElement("span");
    description.className = "theme-card-description";
    description.textContent = theme.description;
    card.append(description);

    card.addEventListener("click", () => onChangeTheme(theme.id));
    grid.append(card);
  }

  section.append(grid);

  return section;
}
