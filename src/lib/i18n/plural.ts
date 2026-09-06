import type { Locale } from "./locales";

/**
 * The CLDR plural categories our two locales can produce. English uses
 * `one` / `other`; Czech uses all four.
 *
 * A note on Czech, because the obvious mental model is wrong: `many` is
 * **not** "5 and up". Czech's CLDR rules are `one` for exactly 1, `few` for
 * 2-4, `many` for anything with a decimal part, and `other` for everything
 * else — including 0 and 5+. So "5 poznámek" is `other`, and `many` only
 * fires for a value like 1.5. Every counted message still has to declare it:
 * the day a count stops being an integer, the alternative to a declared form
 * is a wrong one.
 */
export type PluralCategory = "one" | "few" | "many" | "other";

/**
 * A counted message, one string per plural category. Every form is required
 * so the type system — not a runtime fallback chain — is what guarantees a
 * locale can render any count. English repeats itself across `few` / `many` /
 * `other`; that repetition *is* English's plural table, not a translation
 * gap.
 *
 * Each form may contain the token `{count}`, which `formatPlural` replaces
 * with the number.
 */
export type PluralForms = Record<PluralCategory, string>;

const COUNT_TOKEN = "{count}";

/**
 * Narrows a CLDR rule to the four categories our catalogs declare.
 *
 * `Intl.PluralRules` can also return `zero` and `two`, for locales we don't
 * ship (Arabic, Welsh). Neither `en` nor `cs` ever produces them, so this
 * exists purely so a third locale cannot make `forms[category]` undefined and
 * put the string "undefined" on screen. It is a separate exported function
 * rather than an inline guard so that fallback is reachable from a test —
 * with `Locale` narrowed to two languages, nothing else can reach it.
 */
export function toPluralCategory(rule: Intl.LDMLPluralRule): PluralCategory {
  return rule === "one" || rule === "few" || rule === "many" ? rule : "other";
}

/** Picks the plural category `count` falls into for `locale`. */
export function selectPluralCategory(locale: Locale, count: number): PluralCategory {
  return toPluralCategory(new Intl.PluralRules(locale).select(count));
}

/**
 * Renders a counted message: picks the form for `count` in `locale` and
 * substitutes every `{count}` token.
 *
 * The number is interpolated with `String(count)` rather than
 * `Intl.NumberFormat`, so a 6470-note rebuild reads "6470" in both locales.
 * Group separators here would be a separate, deliberate change — they are
 * not free (Czech groups with a non-breaking space) and nothing in the app
 * currently formats a count that way.
 */
export function formatPlural(
  locale: Locale,
  count: number,
  forms: PluralForms,
): string {
  return forms[selectPluralCategory(locale, count)].replaceAll(
    COUNT_TOKEN,
    String(count),
  );
}
