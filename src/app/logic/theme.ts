/**
 * Visual theme for the app. The theme is a device-local preference — every
 * browser/device picks its own. Persistence lives in `localStorage` only
 * (no URL sync) so sharing a link never forces a theme on the recipient.
 *
 * "auto" follows the OS-level `prefers-color-scheme` media query and resolves
 * to either "sand" (light) or "dark" (dark) at apply time. The literal id
 * "auto" never appears as the rendered `data-theme` attribute.
 */
import type { Messages } from "../../lib/i18n";

export type ThemeId =
  | "sand"
  | "dark"
  | "paper"
  | "forest"
  | "midnight"
  | "parchment"
  | "parchment-dark";

/**
 * Full set of values the user can pick on the Settings page — including the
 * special "auto" stance that defers to the OS. This is the type stored on
 * disk; `ThemeId` is the strictly-palette subset returned from resolution.
 */
export type ThemeChoice = ThemeId | "auto";

/**
 * The palette preview dots the Settings page renders for a theme. Plain hex
 * strings (no alpha) so a solid swatch can be painted straight from them;
 * the full palette lives in styles.css keyed on `data-theme`.
 */
export interface ThemeSwatches {
  primary: string;
  accent: string;
  background: string;
}

/**
 * A pickable theme as *data*: the id that gets persisted and written to
 * `data-theme`, plus its swatches. Deliberately carries no copy — the label
 * and description are localized, the id is not (see `describeThemes`).
 */
export interface ThemeOption {
  id: ThemeChoice;
  swatches: ThemeSwatches;
}

/** A theme with its copy resolved for one locale. What the UI renders. */
export interface ThemeDescriptor extends ThemeOption {
  label: string;
  description: string;
}

/**
 * Default choice on first run. "auto" lets the OS pick light vs. dark so a new
 * device lands on something sensible without the user having to visit
 * Settings.
 */
export const DEFAULT_THEME_CHOICE: ThemeChoice = "auto";

const STORAGE_KEY = "sutrapad-theme";

/**
 * Catalogue of pickable themes, in the order the Settings grid renders them.
 *
 * Ids only — no labels. A theme id is a key: it is persisted to localStorage
 * and set as the `data-theme` attribute, so translating one would orphan the
 * user's stored choice and unstyle the app. `describeThemes` pairs each id
 * with the copy for the active locale.
 */
export const THEMES: readonly ThemeOption[] = [
  {
    id: "auto",
    swatches: {
      primary: "#1f2937",
      accent: "#c08457",
      background: "#f4ece0",
    },
  },
  {
    id: "sand",
    swatches: {
      primary: "#1f2937",
      accent: "#c08457",
      background: "#f4ece0",
    },
  },
  {
    id: "paper",
    swatches: {
      primary: "#111827",
      accent: "#2563eb",
      background: "#fafafa",
    },
  },
  {
    id: "forest",
    swatches: {
      primary: "#1b3a2f",
      accent: "#2f7d5b",
      background: "#eef3ec",
    },
  },
  {
    id: "midnight",
    swatches: {
      primary: "#e5e7ff",
      accent: "#a78bfa",
      background: "#10132a",
    },
  },
  {
    id: "dark",
    swatches: {
      primary: "#f5efe6",
      accent: "#d49a6a",
      background: "#171513",
    },
  },
  {
    id: "parchment",
    swatches: {
      primary: "#1b1714",
      accent: "#c46a3a",
      background: "#fbf7ef",
    },
  },
  {
    id: "parchment-dark",
    swatches: {
      primary: "#f1e8d7",
      accent: "#e89a5a",
      background: "#15120f",
    },
  },
];

/**
 * Pairs every theme with its label and description from `catalog`.
 *
 * Indexing `catalog.theme` by `ThemeChoice` is what keeps the two in step:
 * adding a theme id without adding its copy to the English catalog is a
 * compile error here, and the Czech catalog then fails to satisfy
 * `Messages` until it is translated too.
 */
export function describeThemes(catalog: Messages): readonly ThemeDescriptor[] {
  return THEMES.map((theme) => ({
    ...theme,
    label: catalog.theme[theme.id].label,
    description: catalog.theme[theme.id].description,
  }));
}

const ALL_CHOICES: ReadonlySet<ThemeChoice> = new Set<ThemeChoice>(
  THEMES.map((theme) => theme.id),
);

export function isThemeChoice(value: unknown): value is ThemeChoice {
  // `Set.has` returns false for any non-string value (null, numbers, objects)
  // so no separate `typeof value === "string"` guard is needed.
  return ALL_CHOICES.has(value as ThemeChoice);
}

export function loadStoredThemeChoice(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): ThemeChoice | null {
  const raw = storage.getItem(STORAGE_KEY);
  // `isThemeChoice(null)` already returns false, so the null-from-missing-key
  // path falls through the same guard as an unknown-value path below.
  return isThemeChoice(raw) ? raw : null;
}

export function persistThemeChoice(
  choice: ThemeChoice,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(STORAGE_KEY, choice);
}

/**
 * Subset of the `MediaQueryList` surface used for dark-mode detection. Kept
 * tiny so tests can inject a stub without pulling in the full DOM type.
 */
export interface DarkSchemeMedia {
  matches: boolean;
}

/**
 * Resolves the user's selected choice to a concrete palette id. `auto` is
 * collapsed to "dark" when the OS reports a dark preference, otherwise
 * "sand" (the canonical light palette).
 */
export function resolveThemeId(
  choice: ThemeChoice,
  darkMedia: DarkSchemeMedia | null = typeof window !== "undefined" &&
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null,
): ThemeId {
  if (choice !== "auto") return choice;
  return darkMedia?.matches ? "dark" : "sand";
}

/**
 * Sets `data-theme` on the target element. Callers pass the raw choice and
 * this resolves it — so flipping between "auto" and a concrete theme both go
 * through one entry point.
 */
export function applyThemeChoice(
  choice: ThemeChoice,
  root: Pick<HTMLElement, "dataset"> = document.documentElement,
  darkMedia?: DarkSchemeMedia | null,
): ThemeId {
  const resolved = resolveThemeId(choice, darkMedia);
  root.dataset.theme = resolved;
  return resolved;
}

/**
 * Resolves the initial choice from local storage, falling back to the default
 * when nothing is stored or the stored value is no longer a known theme.
 */
export function resolveInitialThemeChoice(
  storage?: Pick<Storage, "getItem">,
): ThemeChoice {
  return loadStoredThemeChoice(storage) ?? DEFAULT_THEME_CHOICE;
}

const DARK_THEME_IDS: ReadonlySet<ThemeId> = new Set<ThemeId>([
  "dark",
  "midnight",
  "parchment-dark",
]);

/**
 * Returns `true` when the concrete palette id is a dark-mode theme. Callers
 * typically want this *after* `resolveThemeId` has collapsed "auto" to a real
 * id. The persona decorator uses it to pick the dark variant of its paper
 * palette so note cards stay legible against a dark page background.
 */
export function isDarkThemeId(id: ThemeId): boolean {
  return DARK_THEME_IDS.has(id);
}

/**
 * Subscribes to OS light/dark preference changes and re-applies the theme
 * when the user is on "auto". Extracted so callers don't have to repeat the
 * `matchMedia` null-check or rebind the handler on each re-render. Returns
 * the MediaQueryList so tests can dispatch synthetic change events.
 */
export function watchAutoTheme(
  getCurrentChoice: () => ThemeChoice,
): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener?.("change", () => {
    const choice = getCurrentChoice();
    if (choice === "auto") applyThemeChoice(choice);
  });
  return media;
}
