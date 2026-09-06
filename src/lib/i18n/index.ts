/**
 * Message catalog access.
 *
 * The active locale is module state rather than a parameter threaded through
 * every builder. That is a deliberate trade: the app re-renders wholesale on
 * every state change, so a locale switch is already a full rebuild of the
 * DOM, and prop-drilling a catalog through 43 view files would swamp the
 * change that actually matters — the strings. The same shape as
 * `applyThemeChoice`'s default `document.documentElement` argument: a
 * sensible ambient default, overridable where a caller needs to be explicit.
 *
 * Every function that renders a counted message still takes its locale
 * explicitly, because `Intl.PluralRules` needs it and a stale ambient locale
 * there would be a wrong plural rather than a wrong language.
 */
import { CS } from "./cs";
import { EN, type Messages } from "./en";
import { DEFAULT_LOCALE, type Locale } from "./locales";

export type { Messages } from "./en";
export {
  allLocales,
  DEFAULT_LOCALE,
  isLocale,
  matchLocale,
  type Locale,
} from "./locales";
export {
  formatPlural,
  selectPluralCategory,
  toPluralCategory,
  type PluralCategory,
  type PluralForms,
} from "./plural";
export { EN } from "./en";
export { CS } from "./cs";

let activeLocale: Locale = DEFAULT_LOCALE;

/** The catalog for one specific locale, independent of what is active. */
export function catalogFor(locale: Locale): Messages {
  return locale === "cs" ? CS : EN;
}

/**
 * Sets the locale every subsequent `messages()` / `activeLocale()` call sees.
 * Called once at bootstrap and again whenever the user picks a language;
 * the render that follows is what actually swaps the visible text.
 */
export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
}

export function getActiveLocale(): Locale {
  return activeLocale;
}

/**
 * The active catalog. Callers capture it once per builder
 * (`const t = messages();`) rather than calling it per string.
 */
export function messages(): Messages {
  return catalogFor(activeLocale);
}
