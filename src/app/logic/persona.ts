/**
 * Notebook persona preference. When enabled, the notes list renders each card
 * with its derived "persona" — paper palette, rotation, stickers, patina — so
 * entries feel like loose scraps pinned to a desk. When disabled, cards keep
 * the unadorned look. This is a device-local preference: every browser/device
 * picks its own, stored in `localStorage` only (no URL sync) so sharing a link
 * never forces the decorative view on the recipient.
 *
 * Default is "off" so existing users never see a sudden visual shift; the
 * persona only turns on after an explicit opt-in via Settings.
 */
export type PersonaPreference = "on" | "off";

/**
 * Default preference on first run. Off means the notes list renders with the
 * existing flat card style until the user opts in.
 */
export const DEFAULT_PERSONA_PREFERENCE: PersonaPreference = "off";

const STORAGE_KEY = "sutrapad-persona-enabled";

const ALL_PREFERENCES: ReadonlySet<PersonaPreference> =
  new Set<PersonaPreference>(["on", "off"]);

export function isPersonaPreference(
  value: unknown,
): value is PersonaPreference {
  // `Set.has` returns false for any non-string value (null, numbers, objects)
  // so no separate `typeof value === "string"` guard is needed.
  return ALL_PREFERENCES.has(value as PersonaPreference);
}

export function loadStoredPersonaPreference(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): PersonaPreference | null {
  const raw = storage.getItem(STORAGE_KEY);
  // `isPersonaPreference(null)` already returns false, so the null-from-
  // missing-key path falls through the same guard as an unknown-value path.
  return isPersonaPreference(raw) ? raw : null;
}

export function persistPersonaPreference(
  preference: PersonaPreference,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(STORAGE_KEY, preference);
}

/**
 * Resolves the initial preference from local storage, falling back to the
 * default when nothing is stored or the stored value is no longer valid.
 */
export function resolveInitialPersonaPreference(
  storage?: Pick<Storage, "getItem">,
): PersonaPreference {
  return loadStoredPersonaPreference(storage) ?? DEFAULT_PERSONA_PREFERENCE;
}

/**
 * Convenience boolean for code paths that only care whether persona rendering
 * is active. Keeps call sites readable (`if (isPersonaEnabled(pref))`) without
 * every caller re-remembering the string literal.
 */
export function isPersonaEnabled(preference: PersonaPreference): boolean {
  return preference === "on";
}
