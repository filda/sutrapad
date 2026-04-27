/**
 * Tokenization for the Topic Lexicon Builder.
 *
 * The builder feeds importable text through this helper to produce a stream
 * of `(form, contextSnippet)` pairs that aggregate into the candidate queue.
 * The pipeline matches the spec in `docs/dictionary-builder.md`:
 *
 *   - Unicode NFC normalisation.
 *   - Lowercase via `toLocaleLowerCase("cs-CZ")` so ČŠŘ collate consistently.
 *   - Diacritics preserved (NOT stripped — `praze` and `Praze` collapse, but
 *     `praze` and `Praže` stay distinct on the way in).
 *   - Digits and punctuation are dropped from token boundaries; tokens only
 *     contain Unicode letter codepoints.
 *   - Tokens of length 1 or 2 are dropped (high noise / low signal).
 *   - The hardcoded Czech stoplist is dropped.
 *   - The caller may pass already-mapped forms and already-rejected forms
 *     so previously-decided forms don't reappear in the candidate queue.
 *
 * Each yielded token carries a short context snippet (~80 chars centered on
 * the token). The caller decides how many of those to keep per form — the
 * spec caps it at 1–2.
 */
import { CZECH_STOPLIST } from "./stoplist";

const CONTEXT_RADIUS = 40;
const MIN_FORM_LENGTH = 3;

export interface TokenizeOptions {
  /** Forms that already have a target — exclude from the stream. */
  readonly knownForms?: ReadonlySet<string>;
  /** Forms the user previously rejected — exclude from the stream. */
  readonly rejectedForms?: ReadonlySet<string>;
}

export interface ImportToken {
  /** Normalised form (NFC + lower-case, diacritics preserved). */
  readonly form: string;
  /** Up-to-~80-char snippet around the original occurrence. */
  readonly context: string;
}

/**
 * Walks `text` and yields one `ImportToken` per surviving occurrence.
 *
 * Implementation notes:
 *
 *   - We split on the negation of the Unicode `Letter` class so digits,
 *     punctuation, whitespace, and emoji all act as boundaries without
 *     each needing a special branch. The regex is constructed once
 *     (module scope below) and used in a `while (exec)` loop so we can
 *     read `lastIndex` and cut a context window around the original
 *     character span before normalisation.
 *   - Stoplist + length + known/rejected filtering happens *after*
 *     normalisation because the spec defines all those filters in terms
 *     of the normalised form.
 *   - The function returns a plain array — these texts are "jednotky KB
 *     až nižší desítky KB" per the spec, so a streaming generator would
 *     just complicate the caller without saving meaningful memory.
 */
export function tokenizeImport(
  text: string,
  options: TokenizeOptions = {},
): ImportToken[] {
  if (!text) return [];

  const knownForms = options.knownForms ?? new Set<string>();
  const rejectedForms = options.rejectedForms ?? new Set<string>();

  const normalised = text.normalize("NFC");
  // Build the source for the context window once, then derive each
  // snippet via slice. We don't lowercase the source because the
  // context display benefits from the user's original casing.
  const tokens: ImportToken[] = [];
  // `\p{L}` matches Unicode letters; the global+unicode flags are
  // required so the regex iterates through the whole string and
  // understands surrogate pairs.
  const wordPattern = /\p{L}+/gu;

  let match: RegExpExecArray | null;
  while ((match = wordPattern.exec(normalised)) !== null) {
    const original = match[0];
    const form = original.toLocaleLowerCase("cs-CZ");

    if (form.length < MIN_FORM_LENGTH) continue;
    if (CZECH_STOPLIST.has(form)) continue;
    if (knownForms.has(form)) continue;
    if (rejectedForms.has(form)) continue;

    const start = Math.max(0, match.index - CONTEXT_RADIUS);
    const end = Math.min(
      normalised.length,
      match.index + original.length + CONTEXT_RADIUS,
    );
    const window = normalised.slice(start, end).replace(/\s+/g, " ").trim();
    const prefix = start > 0 ? "…" : "";
    const suffix = end < normalised.length ? "…" : "";
    tokens.push({ form, context: `${prefix}${window}${suffix}` });
  }

  return tokens;
}
