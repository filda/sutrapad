/**
 * The locales SutraPad ships. Two of them, and the design is deliberately not
 * built out for a third: see `docs/i18n-plan.md`.
 *
 * A locale id is a **key**, not copy. It is written to localStorage, set as
 * `<html lang>`, and handed to `Intl` — so it never gets translated, only its
 * display label does (`Messages["locale"]`).
 */
export type Locale = "en" | "cs";

/**
 * Fallback when nothing is stored and the browser asks for a language we
 * don't have. English rather than Czech because English is the source
 * language of the catalog — a missing Czech key is a compile error, but an
 * unexpected *locale* should still land on the text we author first.
 */
export const DEFAULT_LOCALE: Locale = "en";

/**
 * Every locale, in the order the Settings picker renders them. A function
 * rather than a top-level array so the nested literals don't become static
 * mutants (see `docs/development.md`).
 */
export function allLocales(): readonly Locale[] {
  return ["en", "cs"];
}

export function isLocale(value: unknown): value is Locale {
  return allLocales().includes(value as Locale);
}

/**
 * Picks the best locale for a browser's ordered language list
 * (`navigator.languages`). Matches on the primary subtag, so `cs-CZ`,
 * `cs` and `CS` all resolve to Czech, and the first entry that matches
 * anything we ship wins — a `["sk", "cs-CZ", "en"]` browser gets Czech,
 * not English, because Slovak is skipped rather than treated as a miss.
 *
 * Returns `null` when nothing matches, so the caller decides whether that
 * means "fall back to the default" or "keep what the user already chose".
 */
export function matchLocale(languages: readonly string[]): Locale | null {
  for (const language of languages) {
    const primary = language.trim().toLowerCase().split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}
