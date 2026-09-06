/**
 * App language. A device-local preference in the same class as the theme and
 * the notes view mode: persisted to `localStorage` only, never synced to
 * Drive and never written into the URL. A shared link must not force a
 * language on whoever opens it, and the workspace sync engine has no business
 * carrying a UI preference.
 *
 * First run has no stored value, so the browser decides — `navigator.
 * languages` in order, falling back to English. After that an explicit choice
 * always wins, including a choice that happens to match the browser: the
 * point of the Settings row is that it sticks.
 */
import {
  DEFAULT_LOCALE,
  isLocale,
  matchLocale,
  setActiveLocale,
  type Locale,
} from "../../lib/i18n";

const STORAGE_KEY = "sutrapad-locale";

export function loadStoredLocale(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): Locale | null {
  const raw = storage.getItem(STORAGE_KEY);
  // `isLocale(null)` is already false, so a missing key and an unknown value
  // leave through the same guard.
  return isLocale(raw) ? raw : null;
}

export function persistLocale(
  locale: Locale,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(STORAGE_KEY, locale);
}

/**
 * The slice of `navigator` this module reads. Kept tiny and injectable for
 * the same reason `theme.ts` declares `DarkSchemeMedia`: a test can hand over
 * a two-property object instead of faking a browser global.
 */
export interface LanguagePreferences {
  readonly languages?: readonly string[];
  readonly language?: string;
}

/**
 * Reads the browser's preferred languages: `navigator.languages`, falling
 * back to the single `navigator.language` on browsers that only expose that,
 * and to an empty list if neither is populated.
 *
 * No `typeof navigator === "undefined"` guard. SutraPad is a browser PWA, and
 * both test environments (node and happy-dom) provide `navigator` too — so
 * the guard's other arm was unreachable by construction, which is a mutant
 * nothing can kill rather than a safety net.
 */
export function browserLanguages(
  source: LanguagePreferences = navigator,
): readonly string[] {
  if (source.languages?.length) return source.languages;
  return source.language ? [source.language] : [];
}

/**
 * Resolves the locale to start in: an explicit stored choice first, then the
 * browser's preference, then English.
 */
export function resolveInitialLocale(
  storage?: Pick<Storage, "getItem">,
  languages: readonly string[] = browserLanguages(),
): Locale {
  return loadStoredLocale(storage) ?? matchLocale(languages) ?? DEFAULT_LOCALE;
}

/**
 * The single entry point for "the app is now in this language": points the
 * catalog accessor at the locale and syncs `<html lang>` so the browser,
 * screen readers and `:lang()` CSS agree with the text on screen.
 *
 * Mirrors `applyThemeChoice` — callers set the preference and this applies
 * it, so there is one place where the ambient state and the DOM change
 * together and no way to update one without the other.
 */
export function applyLocale(
  locale: Locale,
  root: Pick<HTMLElement, "lang"> = document.documentElement,
): void {
  setActiveLocale(locale);
  root.lang = locale;
}
