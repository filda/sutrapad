/**
 * Visual theme for the app. The theme is a device-local preference — every
 * browser/device picks its own. Persistence lives in `localStorage` only
 * (no URL sync) so sharing a link never forces a theme on the recipient.
 *
 * "auto" follows the OS-level `prefers-color-scheme` media query and resolves
 * to either "sand" (light) or "dark" (dark) at apply time. The literal id
 * "auto" never appears as the rendered `data-theme` attribute.
 */
export type ThemeId = "sand" | "dark" | "paper" | "forest" | "midnight";

/**
 * Full set of values the user can pick on the Settings page — including the
 * special "auto" stance that defers to the OS. This is the type stored on
 * disk; `ThemeId` is the strictly-palette subset returned from resolution.
 */
export type ThemeChoice = ThemeId | "auto";

export interface ThemeDescriptor {
  id: ThemeChoice;
  label: string;
  description: string;
  swatches: {
    primary: string;
    accent: string;
    background: string;
  };
}

/**
 * Default choice on first run. "auto" lets the OS pick light vs. dark so a new
 * device lands on something sensible without the user having to visit
 * Settings.
 */
export const DEFAULT_THEME_CHOICE: ThemeChoice = "auto";

const STORAGE_KEY = "sutrapad-theme";

/**
 * Catalogue of pickable themes. The swatch colours are plain hex strings (no
 * alpha) so the Settings page can render solid preview dots; the full palette
 * lives in styles.css keyed on `data-theme`.
 */
export const THEMES: readonly ThemeDescriptor[] = [
  {
    id: "auto",
    label: "Auto",
    description: "Follows your system light/dark preference.",
    swatches: {
      primary: "#1f2937",
      accent: "#c08457",
      background: "#f4ece0",
    },
  },
  {
    id: "sand",
    label: "Sand",
    description: "The original warm cream and terracotta palette.",
    swatches: {
      primary: "#1f2937",
      accent: "#c08457",
      background: "#f4ece0",
    },
  },
  {
    id: "paper",
    label: "Paper",
    description: "Bright neutral white with a cool slate accent.",
    swatches: {
      primary: "#111827",
      accent: "#2563eb",
      background: "#fafafa",
    },
  },
  {
    id: "forest",
    label: "Forest",
    description: "Deep pine and moss, easy on the eyes for long sessions.",
    swatches: {
      primary: "#1b3a2f",
      accent: "#2f7d5b",
      background: "#eef3ec",
    },
  },
  {
    id: "midnight",
    label: "Midnight",
    description: "Cool indigo night sky with a violet accent.",
    swatches: {
      primary: "#e5e7ff",
      accent: "#a78bfa",
      background: "#10132a",
    },
  },
  {
    id: "dark",
    label: "Dark",
    description: "Neutral dark surfaces with the warm terracotta accent.",
    swatches: {
      primary: "#f5efe6",
      accent: "#d49a6a",
      background: "#171513",
    },
  },
];

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
  root: Pick<HTMLElement, "setAttribute"> = document.documentElement,
  darkMedia?: DarkSchemeMedia | null,
): ThemeId {
  const resolved = resolveThemeId(choice, darkMedia);
  root.setAttribute("data-theme", resolved);
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
